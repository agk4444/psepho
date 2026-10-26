// Forecast assembly: public polls + public market odds -> Jev decision.
const jev = require('./jev-client');
const polls = require('./polls');
const pm = require('./polymarket');
const cache = require('./cache');

const MARKET_TTL = 900; // 15 minutes

const RACES = [
  { state: 'Georgia', wiki: '2026 United States Senate election in Georgia' },
  { state: 'North Carolina', wiki: '2026 United States Senate election in North Carolina' },
  { state: 'Michigan', wiki: '2026 United States Senate election in Michigan' },
  { state: 'Texas', wiki: '2026 United States Senate election in Texas' },
  { state: 'Maine', wiki: '2026 United States Senate election in Maine' },
  { state: 'Ohio', wiki: '2026 United States Senate election in Ohio' },
  { state: 'Florida', wiki: '2026 United States Senate election in Florida' },
  { state: 'New Hampshire', wiki: '2026 United States Senate election in New Hampshire' },
  { state: 'Minnesota', wiki: '2026 United States Senate election in Minnesota' },
  { state: 'Iowa', wiki: '2026 United States Senate election in Iowa' },
  { state: 'Alaska', wiki: '2026 United States Senate election in Alaska' },
];

// Competitive 2026 governor races (polls + Polymarket "Election Winner").
const GOVERNORS = [
  { state: 'Arizona', wiki: '2026 Arizona gubernatorial election' },
  { state: 'Georgia', wiki: '2026 Georgia gubernatorial election' },
  { state: 'Kansas', wiki: '2026 Kansas gubernatorial election' },
  { state: 'Maine', wiki: '2026 Maine gubernatorial election' },
  { state: 'Michigan', wiki: '2026 Michigan gubernatorial election' },
  { state: 'Nevada', wiki: '2026 Nevada gubernatorial election' },
  { state: 'New Mexico', wiki: '2026 New Mexico gubernatorial election' },
  { state: 'Ohio', wiki: '2026 Ohio gubernatorial election' },
  { state: 'Wisconsin', wiki: '2026 Wisconsin gubernatorial election' },
  { state: 'Florida', wiki: '2026 Florida gubernatorial election' },
];

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const t = Date.parse(dateStr.replace(/–.*$/, '').trim());
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

function latestUpdate(rows) {
  let best = null;
  for (const r of rows || []) {
    const d = daysAgo(r.updated);
    if (d != null && (best == null || d < best)) best = d;
  }
  return best;
}

function fmtVol(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return null;
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n.toFixed(0);
}

function marketPDem(mkt) {
  if (!mkt) return null;
  if (mkt.dem != null) return mkt.dem;
  if (mkt.rep != null) return 1 - mkt.rep;
  return null;
}

async function decide(label, signals, text) {
  const questions = jev.buildQuestions();
  const result = await jev.systemOne({ text, signals }, questions);
  return { label, questions, jev: result, inputs: signals, context: text };
}

async function forecastChamber(chamber) {
  // chamber: 'Senate' | 'House'
  const [ballot, mkt] = await Promise.all([
    polls.getGenericBallot().catch((e) => ({ error: String(e.message || e) })),
    pm.getChamberControl(chamber.toLowerCase()).catch((e) => ({ error: String(e.message || e) })),
  ]);
  const mPD = mkt && !mkt.error ? marketPDem(mkt) : null;
  const signals = {
    pollMarginDem: ballot && !ballot.error ? ballot.margin : null,
    pollN: ballot && !ballot.error ? ballot.n : 0,
    pollUpdatedDaysAgo: ballot && !ballot.error ? latestUpdate(ballot.rows) : null,
    marketPDem: mPD,
  };
  const bits = [`${chamber} control, 2026 midterms.`];
  if (ballot && !ballot.error)
    bits.push(`Generic ballot aggregate (${ballot.n} aggregators): D ${ballot.dem}% / R ${ballot.rep}% (D${ballot.margin >= 0 ? '+' : ''}${ballot.margin}).`);
  if (mkt && !mkt.error && mPD != null)
    bits.push(`Polymarket "${mkt.market}": P(Dem) ${Math.round(mPD * 100)}%${mkt.volume ? `, vol ${fmtVol(mkt.volume)}` : ''}.`);
  if (mkt && mkt.error) bits.push(`Market data unavailable: ${mkt.error}`);
  if (ballot && ballot.error) bits.push(`Poll data unavailable: ${ballot.error}`);
  return decide(`${chamber} control`, signals, bits.join(' '));
}

// Generic state race: Senate or Governor. cfg: { state, wiki, label, mktFn, mktPrefix }
async function forecastStateRace(cfg) {
  const mktKey = cfg.mktPrefix + cfg.state;
  const [pl, mkt] = await Promise.all([
    polls.getRacePolls(cfg.wiki).catch((e) => ({ error: String(e.message || e) })),
    (async () => {
      // Never trust a cached failure: a transient Polymarket blip must not
      // poison the market feed. Only successful results are cached.
      let hit = cache.get(mktKey, MARKET_TTL);
      if (hit && hit.error) hit = null;
      if (hit !== null) return hit;
      const v = await cfg.mktFn(cfg.state).catch((e) => ({ error: String(e.message || e) }));
      if (v && !v.error) cache.set(mktKey, v);
      return v;
    })(),
  ]);
  const okPolls = pl && !pl.error;
  const mPD = mkt && !mkt.error ? marketPDem(mkt) : null;
  const signals = {
    pollMarginDem: okPolls ? pl.margin : null,
    pollN: okPolls ? pl.n : 0,
    pollUpdatedDaysAgo: okPolls ? latestUpdate(pl.rows) : null,
    marketPDem: mPD,
  };
  const bits = [`2026 ${cfg.office} race: ${cfg.state}.`];
  if (okPolls)
    bits.push(`Poll aggregates (${pl.n} sources): ${pl.demName} (D) ${pl.dem}% vs ${pl.repName} (R) ${pl.rep}% (D${pl.margin >= 0 ? '+' : ''}${pl.margin}).`);
  else bits.push(`No general-election poll aggregate parsed${pl && pl.error ? `: ${pl.error}` : ''}.`);
  if (mkt && !mkt.error && mPD != null)
    bits.push(`Polymarket "${mkt.market}": P(Dem) ${Math.round(mPD * 100)}%${mkt.volume ? `, vol ${fmtVol(mkt.volume)}` : ''}.`);
  else if (mkt && !mkt.error) bits.push('No clean Polymarket win market found.');
  if (mkt && mkt.error) bits.push(`Market data unavailable: ${mkt.error}`);
  const d = await decide(`${cfg.state} ${cfg.office}`, signals, bits.join(' '));
  d.state = cfg.state;
  d.polls = okPolls ? pl : null;
  d.market = mkt && !mkt.error ? { ...mkt, pDem: mPD } : null;
  return d;
}

async function forecastRace(race) {
  return forecastStateRace({
    ...race, office: 'Senate',
    mktFn: (s) => pm.getSenateRaceOdds(s), mktPrefix: 'mkt:race:',
  });
}

async function forecastGovernor(gov) {
  return forecastStateRace({
    ...gov, office: 'Governor',
    mktFn: (s) => pm.getGovernorRaceOdds(s), mktPrefix: 'mkt:gov:',
  });
}

async function forecastAll() {
  const [senate, house] = await Promise.all([
    forecastChamber('Senate').catch((e) => ({ label: 'Senate control', error: String(e.message || e) })),
    forecastChamber('House').catch((e) => ({ label: 'House control', error: String(e.message || e) })),
  ]);
  const races = [];
  for (const r of RACES) {
    try {
      races.push(await forecastRace(r));
    } catch (e) {
      races.push({ state: r.state, label: r.state + ' Senate', error: String(e.message || e) });
    }
    // Stagger Wikipedia fetches: back-to-back page parses get us 429'd.
    await new Promise((res) => setTimeout(res, 1200));
  }
  const governors = [];
  for (const g of GOVERNORS) {
    try {
      governors.push(await forecastGovernor(g));
    } catch (e) {
      governors.push({ state: g.state, label: g.state + ' Governor', error: String(e.message || e) });
    }
    await new Promise((res) => setTimeout(res, 1200));
  }
  return {
    generated_at: new Date().toISOString(),
    jev_model: jev.isLive() ? 'jev-latest' : jev.STUB_MODEL,
    jev_live: jev.isLive(),
    chambers: [senate, house],
    races,
    governors,
    sources: [
      'Polls: Wikipedia 2026 election pages (aggregator tables: 270toWin, RCP, DDHQ, …)',
      'Odds: Polymarket Gamma API (public, no key)',
      'Decisions: TypeSafe Jev System One (stub until TYPESAFE_API_KEY is set)',
    ],
  };
}

module.exports = { forecastAll, forecastChamber, forecastRace, forecastGovernor, RACES, GOVERNORS };
