# Psepho — election forecast (https://psepho.socialnews.xyz/)

Jev-powered election forecast: 2 chambers + 11 Senate + 10 governor
races, refreshed every 2 hours. The live page (`index.html` + `app.js`)
only fetches `data.json`; everything that produces `data.json` lives in
`generator/`, and `php/` holds the PHP renderer for the Plesk box.

## Pipeline (runs every 2 hours)

```
chunav-odds server (Node, :3006) ──/api/forecast──> forecast.json
        │  polls: Wikipedia aggregates (lib/polls.js)
        │  markets: Polymarket Gamma API (lib/polymarket.js)
        │  decide: TypeSafe Jev (lib/jev-client.js) — LIVE only with
        │          TYPESAFE_API_KEY set, else stub
        ▼
refresh.sh ──> run_jev.py ──> live_results.json
        │  run_jev.py feeds each race's full poll+market context text to
        │  Jev via the TypeSafe skill CLI (see Dependency note below).
        │  Races with neither polls nor markets carry their previous Jev
        │  call forward — never a fabricated 50%/toss-up. A systemic
        │  market outage (markets for <20% of races) carries the whole
        │  board forward.
        ▼
compare.py ──> changes.txt (material-change gate: a call flip, or any
        Dem win probability move >= 5 points, vs prev_results.json)
        ▼
make_psepho_data.py ──> data.json (trimmed, frontend-ready)
        ▼
git add -A && git commit -qm "data refresh <UTC timestamp>" &&
  git pull --rebase -q origin main && git push -q origin main
```

The cron job does the push step on every run, material change or not;
the main-chat announcement only fires on a material change.

## Files

| File | What it is |
|---|---|
| `index.html`, `app.js`, `data.json`, `CNAME` | The static site itself. |
| `generator/refresh.sh` | Driver: starts the data server if needed, fetches `forecast.json`, runs the Jev calls, runs the change gate. Runtime paths are `$HOME/workspace/chunav-forecast` and `$HOME/workspace/chunav-odds`. |
| `generator/run_jev.py` | The 23 live-Jev calls (2 chambers + 11 Senate + 10 governor races). Reads `forecast.json`, writes `live_results.json`. |
| `generator/compare.py` | Material-change gate. Exit 0 = something moved, exit 2 = no material change. |
| `generator/make_psepho_data.py` | Builds `data.json` from `live_results.json` (+ `changes.txt` for the "Latest changes" line). |
| `generator/chunav-odds/` | The data server: `server.js` + `lib/` (`forecast.js`, `polls.js`, `polymarket.js`, `jev-client.js`, `cache.js`) + `package.json` (only dependency: `express`). Run with `node server.js` (port 3006, or `$PORT`). |
| `php/index.php` | PHP renderer for the Plesk box: fetches the live `data.json`, caches it locally 10 minutes, renders server-side, falls back to the last cached copy. Upload to `.../SocialNewsXYZ/psepho/index.php`. |

## Dependency note

`run_jev.py` shells out to the TypeSafe skill CLI at
`/home/hatch/workspace/skills/typesafe/bin/jev-decide` on the agent VM.
That CLI is not vendored here; on another machine, point `run_jev.py`'s
`CLI` at an equivalent Jev caller. The data server's own Jev mode is
separate: it reads `TYPESAFE_API_KEY` from the environment and falls
back to a stub when unset.

## Never commit

- `forecast.json`, `live_results.json`, `prev_results.json`, `changes.txt`
  (per-run outputs; `data.json` is the only published artifact)
- `generator/chunav-odds/data/cache.json` (runtime poll/market cache)
- `node_modules/`, API keys, or any credential

---
© 2026 AGK FIRE INC. All rights reserved. See LICENSE.
