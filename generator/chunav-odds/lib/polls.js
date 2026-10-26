// Public poll data via the Wikipedia API (no key).
// - Generic congressional ballot: "2026 United States House of Representatives
//   elections", section "Generic congressional ballot aggregate polls".
// - Senate races: per-state 2026 election pages, general-election
//   "Aggregate polls" tables (Dem (D) vs Rep (R) columns detected by header).
// Aggregator tables only (270toWin, RCP, DDHQ, …) — not individual polls.

const WIKI = 'https://en.wikipedia.org/w/api.php';
const UA = { 'User-Agent': 'chunav-odds/1.0 (contact: local demo)' };
// Polls move slowly: 2h TTL keeps us well under Wikipedia's rate limit
// (the cron refreshes every 2h anyway).
const POLL_TTL = 7200; // 2 hours

const cache = require('./cache');

// Retried fetch: one transient blip must not wipe a race's poll feed.
// 429 (rate limited) gets a longer backoff than other errors.
async function wikiParse(params, tries = 4) {
  const url = `${WIKI}?${params}&format=json`;
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.status === 429) {
        last = new Error('Wikipedia 429 (rate limited)');
        await new Promise((r) => setTimeout(r, 6000));
        continue;
      }
      if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw last;
}

// --- tiny HTML helpers -------------------------------------------------------
function stripTags(s) {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tables(html) {
  const out = [];
  const re = /<table class="wikitable[^"]*"([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

function rows(tableHtml) {
  const out = [];
  const re = /<tr>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(tableHtml))) {
    const cells = [];
    const cre = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while ((c = cre.exec(m[1]))) cells.push(stripTags(c[1]));
    if (cells.length) out.push(cells);
  }
  return out;
}

function pct(s) {
  const m = /(-?[\d.]+)\s*%/.exec(s || '');
  return m ? parseFloat(m[1]) : null;
}

function avg(nums) {
  const v = nums.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// --- generic ballot ----------------------------------------------------------
async function getGenericBallot() {
  const hit = cache.get('genericBallot', POLL_TTL);
  if (hit) return hit;

  // Section index can drift; find it by title first.
  const secData = await wikiParse(
    'action=parse&page=2026_United_States_House_of_Representatives_elections&prop=sections'
  );
  const secs = secData.parse.sections || [];
  const sec = secs.find((s) => /generic congressional ballot/i.test(s.line));
  if (!sec) throw new Error('generic ballot section not found');
  const data = await wikiParse(
    `action=parse&page=2026_United_States_House_of_Representatives_elections&section=${sec.index}&prop=text`
  );
  const tb = tables(data.parse.text['*'])[0];
  if (!tb) throw new Error('generic ballot table not found');
  const rs = rows(tb);
  const head = rs[0].map((h) => h.toLowerCase());
  const repI = head.findIndex((h) => h.includes('republican'));
  const demI = head.findIndex((h) => h.includes('democrat'));
  const updI = head.findIndex((h) => h.includes('updated'));
  if (repI < 0 || demI < 0) throw new Error('generic ballot columns not found');

  const parsed = [];
  for (const r of rs.slice(1)) {
    const dem = pct(r[demI]);
    const rep = pct(r[repI]);
    if (dem == null || rep == null) continue;
    parsed.push({ source: r[0], updated: updI >= 0 ? r[updI] : '', dem, rep });
  }
  const dem = avg(parsed.map((p) => p.dem));
  const rep = avg(parsed.map((p) => p.rep));
  const value = {
    dem: round1(dem), rep: round1(rep), margin: round1(dem - rep),
    n: parsed.length, rows: parsed,
    source: 'Wikipedia — 2026 US House elections, generic ballot aggregate polls',
  };
  cache.set('genericBallot', value);
  return value;
}

// --- senate race polls ---------------------------------------------------------
async function getRacePolls(pageTitle) {
  const key = 'race:' + pageTitle;
  const hit = cache.get(key, POLL_TTL);
  if (hit) return hit;

  const data = await wikiParse(`action=parse&page=${encodeURIComponent(pageTitle)}&prop=text&redirects=1`);
  const cands = [];
  for (const tb of tables(data.parse.text['*'])) {
    const rs = rows(tb);
    if (!rs.length) continue;
    const head0 = rs[0][0].toLowerCase();
    if (!head0.includes('source of poll') || !head0.includes('aggregation')) continue;
    const head = rs[0];
    const demI = head.findIndex((h) => /\(d\)/i.test(h));
    const repI = head.findIndex((h) => /\(r\)/i.test(h));
    if (demI < 0 || repI < 0) continue; // primary or nonpartisan table
    const demName = head[demI].replace(/\s*\(D\)\s*/i, '').trim();
    const repName = head[repI].replace(/\s*\(R\)\s*/i, '').trim();
    const updI = head.findIndex((h) => h.toLowerCase().includes('updated'));
    const parsed = [];
    for (const r of rs.slice(1)) {
      const dem = pct(r[demI]);
      const rep = pct(r[repI]);
      if (dem == null || rep == null) continue;
      parsed.push({ source: r[0], updated: updI >= 0 ? r[updI] : '', dem, rep });
    }
    if (parsed.length) cands.push({ demName, repName, rows: parsed });
  }
  if (!cands.length) {
    cache.set(key, null);
    return null;
  }
  // Most-covered matchup wins (usually the likely general election pairing).
  cands.sort((a, b) => b.rows.length - a.rows.length);
  const best = cands[0];
  const dem = avg(best.rows.map((p) => p.dem));
  const rep = avg(best.rows.map((p) => p.rep));
  const value = {
    demName: best.demName, repName: best.repName,
    dem: round1(dem), rep: round1(rep), margin: round1(dem - rep),
    n: best.rows.length, rows: best.rows,
    source: `Wikipedia — ${pageTitle}, general-election aggregate polls`,
  };
  cache.set(key, value);
  return value;
}

function round1(x) {
  return x == null ? null : Math.round(x * 10) / 10;
}

module.exports = { getGenericBallot, getRacePolls, POLL_TTL };
