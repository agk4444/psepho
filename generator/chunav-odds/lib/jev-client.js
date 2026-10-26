// Chunav Odds — Jev decision layer.
//
// Same TypeSafe System One API shape as Jai Hanuman:
//   state (text + numeric signals) + questions (Choice / Score / Noul)
//   -> answers with typed values, probability distributions, and confidence.
//
// LIVE — TYPESAFE_API_KEY is set: POST https://api.typesafe.ai/v1/systemone
//        with model "jev-latest".
// STUB — no key (TypeSafe is waitlist-gated as of Sep 2026): a transparent
//        local engine returning the SAME shapes. Flip to live by setting
//        TYPESAFE_API_KEY — no code changes needed.
//
// The stub is deliberately boring and auditable: logistic blend of the poll
// margin and the market-implied probability. Every number it uses is shown
// in the UI's "how Jev decided" trace.

const API_URL = 'https://api.typesafe.ai/v1/systemone';
const LIVE_MODEL = 'jev-latest';
const STUB_MODEL = 'jev-stub';

// --- Question builders (mirror the TypeSafe docs) ---
function Choice(instructions, criteria) {
  return { type: 'choice', instructions, criteria };
}
function Score(instructions, criteria) {
  return { type: 'score', instructions, criteria };
}
function Noul(instructions) {
  return { type: 'noul', instructions };
}

// The fixed question set Chunav asks about every race / chamber.
function buildQuestions() {
  return {
    outcome: Choice('Which party wins this race?', {
      democrat_win: 'The Democratic candidate / party wins',
      republican_win: 'The Republican candidate / party wins',
      toss_up: 'Too close to call — neither side has a clear edge',
    }),
    dem_win_probability: Score('Probability the Democrat wins, 0 to 100', [
      '0: certain Republican win',
      '50: pure toss-up',
      '100: certain Democratic win',
    ]),
    confidence: Noul('How confident is this call, given poll/market agreement and data freshness'),
  };
}

function isLive() {
  return !!process.env.TYPESAFE_API_KEY;
}

// ---------------------------------------------------------------------------
// STUB ENGINE — transparent numeric blend, same answer shapes as the real API.
// signals: { pollMarginDem, pollN, pollUpdatedDaysAgo, marketPDem }
//   pollMarginDem: poll-average margin in points, positive = Dem ahead
//   marketPDem:    prediction-market implied P(Dem win), 0..1 (null if none)
// ---------------------------------------------------------------------------
function logistic(x) {
  return 1 / (1 + Math.exp(-x));
}

function stubDecide(signals) {
  const { pollMarginDem, pollN = 0, pollUpdatedDaysAgo = 999, marketPDem = null } = signals;

  // Poll-implied probability: D+7 ≈ 73%, D+3.5 ≈ 62%, even ≈ 50%.
  const pollP = pollMarginDem == null ? null : logistic(pollMarginDem / 7);

  let combined;
  const parts = [];
  if (pollP != null && marketPDem != null) {
    // Weight markets slightly more — they aggregate polls + fundamentals.
    combined = 0.45 * pollP + 0.55 * marketPDem;
    parts.push(`polls→${Math.round(pollP * 100)}%`, `markets→${Math.round(marketPDem * 100)}%`);
  } else if (marketPDem != null) {
    combined = marketPDem;
    parts.push(`markets→${Math.round(marketPDem * 100)}% (no usable polls)`);
  } else if (pollP != null) {
    combined = pollP;
    parts.push(`polls→${Math.round(pollP * 100)}% (no market)`);
  } else {
    combined = 0.5;
    parts.push('no signal — pure toss-up');
  }

  // Choice with a simple margin-based distribution.
  const edge = combined - 0.5; // >0 favors Dem
  let choice, probabilities;
  const sharp = Math.min(1, Math.abs(edge) * 4); // how decisive
  if (combined >= 0.6) {
    choice = 'democrat_win';
    probabilities = { democrat_win: r3(0.5 + sharp * 0.45), republican_win: r3((0.5 - sharp * 0.45) * 0.6), toss_up: 0 };
    probabilities.toss_up = r3(1 - probabilities.democrat_win - probabilities.republican_win);
  } else if (combined <= 0.4) {
    choice = 'republican_win';
    probabilities = { republican_win: r3(0.5 + sharp * 0.45), democrat_win: r3((0.5 - sharp * 0.45) * 0.6), toss_up: 0 };
    probabilities.toss_up = r3(1 - probabilities.republican_win - probabilities.democrat_win);
  } else {
    choice = 'toss_up';
    probabilities = { toss_up: r3(0.45 + (1 - sharp) * 0.3), democrat_win: 0, republican_win: 0 };
    const rest = r3((1 - probabilities.toss_up) / 2);
    probabilities.democrat_win = rest;
    probabilities.republican_win = r3(1 - probabilities.toss_up - rest);
  }

  // Confidence: agreement between polls and markets + data depth + freshness.
  let confidence = 0.45;
  if (pollP != null && marketPDem != null) {
    confidence += 0.25 * (1 - Math.abs(pollP - marketPDem)); // agreement helps
  }
  confidence += 0.12 * Math.min(1, pollN / 5);                // more aggregators help
  if (pollUpdatedDaysAgo <= 3) confidence += 0.08;
  else if (pollUpdatedDaysAgo > 30) confidence -= 0.15;
  confidence = Math.max(0.05, Math.min(0.97, confidence));

  const score = Math.round(combined * 100);

  return {
    model: STUB_MODEL,
    stub: true,
    answers: {
      outcome: { type: 'choice', choice, probabilities, confidence: r3(confidence) },
      dem_win_probability: {
        type: 'score',
        score,
        legend: { 0: 'certain Republican win', 50: 'pure toss-up', 100: 'certain Democratic win' },
        confidence: r3(confidence),
      },
      confidence: { type: 'noul', noul: r3(confidence) },
    },
    usage: { input_tokens: 0, output_tokens: 0 },
    trace: {
      blend: parts.join(' blended 45/55 '),
      poll_implied_pct: pollP == null ? null : Math.round(pollP * 100),
      market_implied_pct: marketPDem == null ? null : Math.round(marketPDem * 100),
      combined_pct: score,
    },
  };
}

function r3(x) {
  return Math.round(x * 1000) / 1000;
}

async function stubSystemOne(state, questions) {
  void questions;
  return stubDecide(state.signals || {});
}

// ---------------------------------------------------------------------------
// LIVE — the real TypeSafe System One API.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// LIVE — the real TypeSafe System One API.
//
// Score-scale gotcha (verified 2026-09-17 against jev-1.13.0): the Score
// answer comes back on the CRITERIA-INDEX scale (0 to n-1), not the 0-100
// range in the instruction prose. The API echoes the criteria array back as
// a legend keyed by index {"0":..., "1":..., "2":...} and scores on that
// index scale, with a matching distribution over the indices. So we
// normalize to 0-100 here; the UI treats score as a percent either way.
// ---------------------------------------------------------------------------
function normalizeLiveScore(questions, answers) {
  const q = questions && questions.dem_win_probability;
  const a = answers && answers.dem_win_probability;
  if (!q || !a || typeof a.score !== 'number') return answers;
  const n = Array.isArray(q.criteria) ? q.criteria.length - 1 : 100;
  if (!(n > 0)) return answers;
  const raw = a.score;
  const scaled = Math.max(0, Math.min(100, Math.round((raw / n) * 100)));
  // Cross-check from the index distribution: P(Dem) = p[last] + 0.5 * p[middle…].
  // With our 3 criteria [rep win, toss-up, dem win]: p[2] + 0.5 * p[1].
  let distPDem = null;
  if (a.probabilities && typeof a.probabilities === 'object') {
    const last = Number(a.probabilities[String(n)] || 0);
    let mid = 0;
    for (let i = 1; i < n; i++) mid += Number(a.probabilities[String(i)] || 0);
    distPDem = Math.max(0, Math.min(1, last + 0.5 * mid));
  }
  return {
    ...answers,
    dem_win_probability: {
      ...a,
      raw_score: raw,
      score_scale: `0-${n} criteria-index scale, normalized to 0-100`,
      score: scaled,
      distribution_implied_dem_pct: distPDem == null ? null : Math.round(distPDem * 100),
    },
  };
}

async function liveSystemOne(state, questions) {
  const body = { state: state.text, model: LIVE_MODEL, questions: JSON.parse(JSON.stringify(questions)) };
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`TypeSafe API ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  return { model: data.model || LIVE_MODEL, answers: normalizeLiveScore(questions, data.answers), usage: data.usage || {}, stub: false };
}

// ---------------------------------------------------------------------------
async function systemOne(state, questions) {
  if (isLive()) {
    try {
      return await liveSystemOne(state, questions);
    } catch (err) {
      const fallback = await stubSystemOne(state, questions);
      fallback.degraded = String(err.message || err);
      return fallback;
    }
  }
  return stubSystemOne(state, questions);
}

module.exports = { Choice, Score, Noul, buildQuestions, systemOne, isLive, STUB_MODEL };
