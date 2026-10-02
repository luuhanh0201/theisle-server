#!/usr/bin/env python3
"""Server load by number of players online, from the bridge's metrics history.

Read only. Run on the VPS:
    ssh "$DEPLOY_HOST" python3 - < scripts/load-by-players.py
    ssh "$DEPLOY_HOST" python3 - --since 2d < scripts/load-by-players.py

One row per player count (0, 1, 2 … as seen): how many 10 s samples, the
game's CPU (% of one core), the server FPS (average and the lowest), UDP
datagrams a second in / out of the machine (the game talks UDP; LiveKit voice
too when someone uses it) and the interface's kbit/s — those network columns
exist from 2026-10-02 16:00 on (bridge metrics.ts udpIn / udpOut / netInKbps /
netOutKbps).
"""
import json
import sys
import time

METRICS = "/home/isle/bridge/data/metrics.ndjson"

since_s = 7 * 86400
args = sys.argv[1:]
if "--since" in args:
    v = args[args.index("--since") + 1]
    since_s = int(v[:-1]) * {"h": 3600, "d": 86400}[v[-1]]

now = time.time()
rows = {}
first = None
with open(METRICS, encoding="utf-8") as f:
    for line in f:
        try:
            s = json.loads(line)
        except ValueError:
            continue
        if now - s.get("t", 0) > since_s or not isinstance(s.get("online"), int):
            continue
        first = s["t"] if first is None else min(first, s["t"])
        rows.setdefault(s["online"], []).append(s)


def avg(xs):
    xs = [x for x in xs if isinstance(x, (int, float))]
    return sum(xs) / len(xs) if xs else None


def pct(xs, p):
    xs = sorted(x for x in xs if isinstance(x, (int, float)))
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None


def f(v, w=7, d=0):
    return ("%*.*f" % (w, d, v)) if v is not None else " " * (w - 1) + "-"


print("since", time.strftime("%d/%m %H:%M", time.localtime(first)) if first else "-")
print("online samples | gameCpu avg  p95 | fps avg  min | udp in/s  out/s (p95 in/out) | net in kbit/s  out kbit/s")
for n in sorted(rows):
    r = rows[n]
    print("%6d %7d | %s %s | %s %s | %s %s (%s/%s) | %s %s" % (
        n, len(r),
        f(avg(s.get("gameCpu") for s in r), 6, 1), f(pct([s.get("gameCpu") for s in r], 0.95), 5, 0),
        f(avg(s.get("fps") for s in r), 5, 1), f(min((s["fps"] for s in r if isinstance(s.get("fps"), (int, float))), default=None), 4),
        f(avg(s.get("udpIn") for s in r), 8, 0), f(avg(s.get("udpOut") for s in r), 6, 0),
        f(pct([s.get("udpIn") for s in r], 0.95), 4, 0).strip(), f(pct([s.get("udpOut") for s in r], 0.95), 4, 0).strip(),
        f(avg(s.get("netInKbps") for s in r), 8, 0), f(avg(s.get("netOutKbps") for s in r), 10, 0),
    ))
