#!/usr/bin/env python3
"""Build the public data.json for the Psepho live site.

Reads ~/workspace/chunav-forecast/live_results.json (+ laya_bakeoff.json),
writes a trimmed, frontend-ready ~/workspace/psepho/data.json.
Run after every refresh.sh, before pushing the psepho repo.
"""
import json
import os
import re
import datetime

FORE = "/home/hatch/workspace/chunav-forecast"
SITE = "/home/hatch/workspace/psepho"

KIND_GROUP = {"chamber": "chambers", "race": "senate", "governor": "governors"}
GROUP_ORDER = ["chambers", "senate", "governors"]


def inputs_line(inp):
    if not inp:
        return "no fresh inputs this run"
    parts = []
    pm = inp.get("pollMarginDem")
    n = inp.get("pollN")
    if pm is not None:
        side = "D+%s" % pm if pm >= 0 else "R+%s" % abs(pm)
        parts.append("polls %s%s" % (side, " (%s agg)" % n if n else ""))
    mpd = inp.get("marketPDem")
    if mpd is not None:
        parts.append("market P(Dem) %d%%" % round(mpd * 100))
    return " · ".join(parts) if parts else "no fresh inputs this run"


def display_pct(choice, dem):
    if choice == "democrat_win":
        return dem
    if choice == "republican_win":
        return 100 - dem
    return 50


def format_changes():
    """Human-readable 'Latest changes' line from changes.txt, or None."""
    p = os.path.join(FORE, "changes.txt")
    try:
        with open(p) as f:
            lines = [l.strip() for l in f if l.strip()]
    except Exception:
        return None
    if not lines:
        return None
    out = []
    for line in lines[-3:]:
        m = re.match(r"(.+?):\s*(\w+)\s+(\d+)%\s*->\s*(\w+)\s+(\d+)%", line)
        if m:
            race, _c1, p1, c2, p2 = m.groups()
            wname = {"democrat_win": "Democratic",
                     "republican_win": "Republican"}.get(c2, "")
            out.append("%s moved from %s%% to %s%% %s win probability."
                       % (race, p1, p2, wname))
        else:
            out.append(line)
    return " ".join(out)


def main():
    live = json.load(open(os.path.join(FORE, "live_results.json")))
    try:
        laya = json.load(open(os.path.join(FORE, "laya_bakeoff.json")))
    except Exception:
        laya = None

    mtime = os.path.getmtime(os.path.join(FORE, "live_results.json"))
    updated_at = datetime.datetime.fromtimestamp(
        mtime, tz=datetime.timezone(datetime.timedelta(hours=-4))).isoformat()

    groups = {g: [] for g in GROUP_ORDER}
    model = None
    for r in live:
        if not r.get("ok"):
            continue
        model = model or r.get("model")
        g = KIND_GROUP.get(r.get("kind"))
        if not g:
            continue
        dem = r.get("dem_win_pct")
        groups[g].append({
            "label": r.get("label"),
            "choice": r.get("choice"),
            "display_pct": display_pct(r.get("choice"), dem),
            "confidence": r.get("confidence"),
            "inputs_line": inputs_line(r.get("inputs")),
        })

    laya_pub = None  # Laya tab removed 2026-09-29; no longer published

    out = {"updated_at": updated_at, "model": model, "groups": groups,
           "changes": format_changes()}
    os.makedirs(SITE, exist_ok=True)
    with open(os.path.join(SITE, "data.json"), "w") as f:
        json.dump(out, f, indent=1)
    n = sum(len(v) for v in groups.values())
    print("wrote %s (%d races, updated %s)"
          % (os.path.join(SITE, "data.json"), n, updated_at))


if __name__ == "__main__":
    main()
