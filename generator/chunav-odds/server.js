// Chunav Odds — server. Serves the mobile UI + /api/forecast.
const express = require('express');
const path = require('path');
const forecast = require('./lib/forecast');

const app = express();
const PORT = process.env.PORT || 3006;

app.use(express.static(path.join(__dirname, 'public')));

// Short in-memory guard so a page reload doesn't refetch everything.
let lastRun = null;
let lastRunAt = 0;

app.get('/api/forecast', async (req, res) => {
  try {
    if (lastRun && Date.now() - lastRunAt < 5 * 60 * 1000) {
      return res.json({ ...lastRun, cached: true });
    }
    const data = await forecast.forecastAll();
    lastRun = data;
    lastRunAt = Date.now();
    res.json({ ...data, cached: false });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/ballot', async (req, res) => {
  try {
    const ballot = await require('./lib/polls').getGenericBallot();
    res.json(ballot);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Chunav Odds on http://localhost:${PORT}`);
  console.log(`Jev mode: ${process.env.TYPESAFE_API_KEY ? 'LIVE (jev-latest)' : 'STUB (set TYPESAFE_API_KEY for live)'}`);
});
