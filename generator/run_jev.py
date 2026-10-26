#!/usr/bin/env python3
"""Run the 13 live-Jev forecast calls for the Chunav snapshot page.

Reads forecast.json (written by refresh.sh from the chunav-odds server),
feeds each chamber/race its full poll+market context text to Jev via the
TypeSafe skill CLI, and writes live_results.json.
"""
import json
import subprocess
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FORECAST = os.path.join(HERE, "forecast.json")
OUT = os.path.join(HERE, "live_results.json")
CLI = "/home/hatch/workspace/skills/typesafe/bin/jev-decide"

d = json.load(open(FORECAST))
items = ([("chamber", c) for c in d["chambers"]]
         + [("race", r) for r in d["races"]]
         + [("governor", g) for g in d.get("governors", [])])

# Data-completeness gate: never feed Jev an empty context. A race/chamber
# with neither poll aggregates nor market odds carries forward its previous
# Jev call instead of fabricating a fake 50%/toss-up that would swing the
# page (that bug caused the bogus 5:39 PM run on 2026-09-17).
prev = {}
PREV = os.path.join(HERE, "prev_results.json")
if os.path.exists(PREV):
    for r in json.load(open(PREV)):
        prev[r.get("label")] = r


def has_usable_data(entry):
    inp = entry.get("inputs") or {}
    return inp.get("marketPDem") is not None or (inp.get("pollN") or 0) > 0


def has_market(entry):
    return (entry.get("inputs") or {}).get("marketPDem") is not None


# Systemic-outage gate: if the market feed is down for nearly everything this
# run (e.g. a Polymarket outage), Jev would produce polls-only numbers that
# drift from the published forecast and register as fake material changes.
# Carry the whole board forward instead.
mkt_now = sum(1 for _, e in items if has_market(e))
mkt_prev = sum(1 for _, e in items
               if has_market({"inputs": (prev.get(e["label"]) or {}).get("inputs")}))
systemic_outage = len(items) > 0 and mkt_now / len(items) < 0.2 and mkt_prev >= len(items) / 2
if systemic_outage:
    print(f"SYSTEMIC MARKET OUTAGE: markets present for {mkt_now}/{len(items)} "
          f"(prev {mkt_prev}); carrying whole board forward", flush=True)

results = []
failed = 0
for kind, entry in items:
    label = entry["label"]
    # IMPORTANT: prefer the full poll+market context text. Feeding only the
    # bare state name makes Jev guess blind (that bug produced the way-off
    # 3:17 PM run on 2026-09-17).
    state = entry.get("context") or entry.get("state", "")
    if not state or len(state) < 20:
        print(f"SKIP (no context): {label}", flush=True)
        failed += 1
        results.append({"label": label, "kind": kind, "ok": False,
                        "error": "missing context text"})
        continue
    if systemic_outage or not has_usable_data(entry):
        carried = prev.get(label)
        if carried and carried.get("ok"):
            carried = dict(carried)
            carried["carried_forward"] = True
            carried["note"] = "no fresh poll or market data this run; kept previous Jev call"
            results.append(carried)
            print(f"CARRY (no fresh data): {label} -> {carried.get('choice')} "
                  f"{carried.get('dem_win_pct')}%", flush=True)
            continue
        print(f"SKIP (no data, no previous call): {label}", flush=True)
        failed += 1
        results.append({"label": label, "kind": kind, "ok": False,
                        "error": "no poll or market data and no previous call"})
        continue
    try:
        out = subprocess.run([CLI, "--state", state],
                             capture_output=True, text=True, timeout=120)
        res = json.loads(out.stdout)
    except Exception as e:
        res = {"ok": False, "error": str(e)}
    res["label"] = label
    res["kind"] = kind
    res["inputs"] = entry.get("inputs")
    res["context"] = state
    results.append(res)
    if res.get("ok"):
        print(f"OK: {label} -> {res.get('choice')} {res.get('dem_win_pct')}% "
              f"conf {res.get('confidence')}", flush=True)
    else:
        failed += 1
        print(f"FAIL: {label} -> {res.get('error')}", flush=True)

json.dump(results, open(OUT, "w"), indent=1)
print(f"saved {OUT} ({len(results) - failed}/{len(results)} ok)")
sys.exit(1 if failed else 0)
