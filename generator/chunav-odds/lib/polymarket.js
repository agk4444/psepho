// Public prediction-market odds via the Polymarket Gamma API.
// No key needed. https://gamma-api.polymarket.com
// outcomePrices: ["Yes price", "No price"] as strings (or already an array).

const GAMMA = 'https://gamma-api.polymarket.com';
const UA = { 'User-Agent': 'chunav-odds/1.0' };

// Retried fetch: Gamma drops connections under burst load
// ("other side closed"), so transient failures get backoff + retry.
async function getJSON(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) throw new Error(`Gamma ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

function yesPrice(market) {
  let p = market.outcomePrices;
  if (typeof p === 'string') {
    try { p = JSON.parse(p); } catch { return null; }
  }
  if (!Array.isArray(p) || p.length === 0) return null;
  const v = parseFloat(p[0]);
  return Number.isFinite(v) ? v : null;
}

// "Which party will win the Senate/House in 2026?" -> { dem, rep } probabilities.
async function getChamberControl(chamber) {
  // chamber: 'senate' | 'house'
  const other = chamber === 'senate' ? 'house' : 'senate';
  const q = encodeURIComponent(`which party will win the ${chamber} in 2026`);
  const data = await getJSON(`${GAMMA}/public-search?q=${q}`);
  const events = (data.events || []).filter((e) => {
    const t = (e.title || '').toLowerCase();
    return t.includes(chamber) && t.includes('which party will win') && !t.includes(other);
  });
  if (!events.length) return null;
  events.sort((a, b) => parseFloat(b.volume || 0) - parseFloat(a.volume || 0));
  const ev = await getJSON(`${GAMMA}/events?slug=${events[0].slug}`);
  const evt = Array.isArray(ev) ? ev[0] : ev;
  const out = { market: evt.title, url: `https://polymarket.com/event/${evt.slug}`, dem: null, rep: null, volume: evt.volume };
  for (const m of evt.markets || []) {
    const qq = (m.question || '').toLowerCase();
    const price = yesPrice(m);
    if (price == null) continue;
    if (/democrat/.test(qq) && out.dem == null) out.dem = price;
    else if (/republican/.test(qq) && out.rep == null) out.rep = price;
  }
  return out.dem != null || out.rep != null ? out : null;
}

// A 2026 Senate race in `stateName`, e.g. "Georgia".
// Handles two market styles:
//   1. Binary "Democratic candidate wins" / "Republican candidate wins".
//   2. Margin-of-victory buckets ("Democratic Party candidate win ... by X%"):
//      P(Dem win) = sum of Dem-bucket Yes prices (same for Rep).
// Returns { dem, rep, market, url, volume, kind } or null.
async function getSenateRaceOdds(stateName) {
  const q = encodeURIComponent(`${stateName} senate 2026`);
  const data = await getJSON(`${GAMMA}/public-search?q=${q}`);
  const st = stateName.toLowerCase();
  const events = (data.events || []).filter((e) => {
    const t = (e.title || '').toLowerCase();
    const d = (e.description || '').toLowerCase();
    // state-specific Senate event, not chamber-wide ("2026" often only in body)
    // 2026-10-06: also exclude primary-election markets — a candidate-specific
    // primary market ("Jasmine Crockett Texas Senate Race Result", P(Dem)=0%)
    // out-volumed the real race market and was misread as the party's odds,
    // printing a bogus 69%->49% Texas swing. The regex targets "primary
    // election/race/vote" specifically: a bare /primary/ also matches
    // "primary resolution source" in legitimate market descriptions.
    // Same exclusion idea the governor resolver already applies to titles.
    const isPrimaryMarket = /primary\s+(election|race|vote)/i.test(t) ||
      /primary\s+(election|race|vote)/i.test(d);
    return /senate/.test(t) && t.includes(st) && (/2026/.test(t) || /2026/.test(d)) &&
      !isPrimaryMarket;
  });
  if (!events.length) return null;
  events.sort((a, b) => parseFloat(b.volume || 0) - parseFloat(a.volume || 0));

  for (const cand of events.slice(0, 4)) {
    const ev = await getJSON(`${GAMMA}/events?slug=${cand.slug}`);
    const evt = Array.isArray(ev) ? ev[0] : ev;
    if (!evt || !evt.markets) continue;
    const base = { market: evt.title, url: `https://polymarket.com/event/${evt.slug}`, volume: evt.volume };

    // Style 1: binary win markets (skip margin-bucket questions — style 2).
    const bin = { dem: null, rep: null };
    for (const m of evt.markets) {
      const qq = (m.question || '').toLowerCase();
      if (/by \d|or more|margin of victory/i.test(qq)) continue;
      const price = yesPrice(m);
      if (price == null) continue;
      if (/democrat/.test(qq) && /win|nominee|seat/i.test(qq) && bin.dem == null) bin.dem = price;
      else if (/republican/.test(qq) && /win|nominee|seat/i.test(qq) && bin.rep == null) bin.rep = price;
    }
    if (bin.dem != null || bin.rep != null) return { ...base, ...bin, kind: 'binary' };

    // Style 2: margin-of-victory buckets. Sum of Dem-bucket Yes prices ≈ P(Dem win).
    let demSum = 0, repSum = 0, buckets = 0;
    for (const m of evt.markets) {
      const qq = (m.question || '').toLowerCase();
      if (!/by \d/.test(qq) && !/or more/.test(qq)) continue;
      const price = yesPrice(m);
      if (price == null) continue;
      if (/democratic/.test(qq) && /win/.test(qq)) { demSum += price; buckets++; }
      else if (/republican/.test(qq) && /win/.test(qq)) { repSum += price; buckets++; }
    }
    if (buckets >= 4 && demSum + repSum > 0.2) {
      const clamp = (x) => Math.max(0.01, Math.min(0.99, r3(x)));
      const total = demSum + repSum;
      // Illiquid bucket markets can misprice (sums far above 1): then use
      // relative shares; otherwise raw sums ≈ P(win).
      const dem = total > 1.3 ? demSum / total : demSum;
      const rep = total > 1.3 ? repSum / total : repSum;
      return { ...base, dem: clamp(dem), rep: clamp(rep), kind: 'margin-buckets' };
    }
  }
  return null;
}

// A 2026 governor race in `stateName`, e.g. "Arizona".
// Uses the binary "<state> Governor Election Winner" event
// ("Will the Democrats/Republicans win ... ?"). Skips primary and
// county-level markets. Returns { dem, rep, market, url, volume, kind }.
async function getGovernorRaceOdds(stateName) {
  const q = encodeURIComponent(`${stateName} governor 2026`);
  const data = await getJSON(`${GAMMA}/public-search?q=${q}`);
  const st = stateName.toLowerCase();
  const events = (data.events || []).filter((e) => {
    const t = (e.title || '').toLowerCase();
    const d = (e.description || '').toLowerCase();
    return /governor/.test(t) && t.includes(st) && /election winner/.test(t) &&
      !/primary|county|lieutenant/i.test(t) && (/2026/.test(t) || /2026/.test(d));
  });
  if (!events.length) return null;
  events.sort((a, b) => parseFloat(b.volume || 0) - parseFloat(a.volume || 0));
  const ev = await getJSON(`${GAMMA}/events?slug=${events[0].slug}`);
  const evt = Array.isArray(ev) ? ev[0] : ev;
  if (!evt || !evt.markets) return null;
  const base = { market: evt.title, url: `https://polymarket.com/event/${evt.slug}`, volume: evt.volume };
  const bin = { dem: null, rep: null };
  for (const m of evt.markets) {
    const qq = (m.question || '').toLowerCase();
    const price = yesPrice(m);
    if (price == null) continue;
    if (/democrat/.test(qq) && /win/.test(qq) && bin.dem == null) bin.dem = price;
    else if (/republican/.test(qq) && /win/.test(qq) && bin.rep == null) bin.rep = price;
  }
  return bin.dem != null || bin.rep != null ? { ...base, ...bin, kind: 'binary' } : null;
}

function r3(x) { return Math.round(x * 1000) / 1000; }

module.exports = { getChamberControl, getSenateRaceOdds, getGovernorRaceOdds };
