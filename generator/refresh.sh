#!/usr/bin/env bash
# Chunav forecast refresh: pull fresh polls+markets, then run live-Jev calls.
# Writes ~/workspace/chunav-forecast/forecast.json and live_results.json.
# Exits non-zero on any failure.
set -euo pipefail

DIR="$HOME/workspace/chunav-forecast"
APP="$HOME/workspace/chunav-odds"
mkdir -p "$DIR"

# 1. Make sure the chunav-odds data server is up.
if ! curl -s -m 5 http://localhost:3006/api/health | grep -q '"ok":true'; then
  echo "starting chunav-odds server..."
  cd "$APP"
  nohup node server.js >> "$DIR/server.log" 2>&1 &
  for i in $(seq 1 30); do
    sleep 2
    curl -s -m 5 http://localhost:3006/api/health | grep -q '"ok":true' && break
  done
fi
curl -s -m 5 http://localhost:3006/api/health | grep -q '"ok":true' \
  || { echo "server failed to start"; exit 1; }

# 2. Fresh forecast payload (uses disk cache with TTLs; first call after
#    expiry refetches Wikipedia + Polymarket, so allow up to 5 minutes).
echo "fetching forecast inputs..."
curl -s -m 300 http://localhost:3006/api/forecast -o "$DIR/forecast.json"
python3 -c "import json; d=json.load(open('$DIR/forecast.json')); print('races:',len(d['races']),'chambers:',len(d['chambers']))"

# 3. Live Jev calls.
echo "running live Jev calls..."
[ -f "$DIR/live_results.json" ] && cp "$DIR/live_results.json" "$DIR/prev_results.json"
python3 "$DIR/run_jev.py"

# 4. Material-change gate: only rebuild the page when something moved.
if python3 "$DIR/compare.py" > "$DIR/changes.txt" 2>&1; then
  echo "MATERIAL_CHANGE=1"
else
  echo "MATERIAL_CHANGE=0"
fi
cat "$DIR/changes.txt"

# 5. Snapshot for zuck-1 training stream (append-only; never affects the gate above).
SNAPDIR="$HOME/workspace/zuck-decider/snapshots"
mkdir -p "$SNAPDIR" 2>/dev/null
cp "$DIR/live_results.json" "$SNAPDIR/live_results-$(date +%Y%m%d-%H%M).json" 2>/dev/null
# keep the last 60 snapshots (~5 days at 2h cadence)
ls -t "$SNAPDIR"/live_results-*.json 2>/dev/null | tail -n +61 | xargs -r rm -f
