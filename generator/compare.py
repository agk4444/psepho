#!/usr/bin/env python3
"""Material-change gate for the Chunav refresh.

Compares live_results.json against prev_results.json.
Prints the changes and exits 0 when something material moved:
  - any race flipped its call (Dem win / GOP win / Toss-up), or
  - any Dem win probability moved by >= 5 points.
Otherwise prints 'no material change' and exits 2.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PREV = os.path.join(HERE, "prev_results.json")
CUR = os.path.join(HERE, "live_results.json")

if not os.path.exists(PREV):
    print("no previous run to compare against; treating as changed")
    sys.exit(0)

prev = {r["label"]: r for r in json.load(open(PREV))}
cur = json.load(open(CUR))

changes = []
for r in cur:
    label = r["label"]
    p = prev.get(label)
    if not p or not p.get("ok"):
        changes.append(f"{label}: new/previously failed -> "
                       f"{r.get('choice')} {r.get('dem_win_pct')}%")
        continue
    if not r.get("ok"):
        changes.append(f"{label}: Jev call failed this run")
        continue
    dp = abs((r.get("dem_win_pct") or 0) - (p.get("dem_win_pct") or 0))
    flip = p.get("choice") != r.get("choice")
    if flip or dp >= 5:
        changes.append(f"{label}: {p.get('choice')} {p.get('dem_win_pct')}% "
                       f"-> {r.get('choice')} {r.get('dem_win_pct')}%")

if changes:
    print("\n".join(changes))
    sys.exit(0)
print("no material change")
sys.exit(2)
