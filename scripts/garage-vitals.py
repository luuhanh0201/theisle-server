#!/usr/bin/env python3
"""garage-vitals.py — READ ONLY. Every dino taken out of the garage, followed
through what happened to it next: its maxima (stomach, thirst, stamina, health)
and vitals from the 5 s snapshots, each admin Heal on it (the game's own log),
each relog. Flags a stomach / thirst max that fell (the hatchling's originals
after a Heal or a relog, the bug fixed in restore.lua 2026-10-02), and health
or blood that fell with no hit taken.

Run on the VPS (as isle):   python3 garage-vitals.py [--since <unix|hours-ago h>] [--player <name or SteamID>]
From here:                  ssh "$DEPLOY_HOST" python3 - --since 12h < scripts/garage-vitals.py
"""
import glob
import json
import re
import sys
import time
from calendar import timegm

WIN64 = "/home/isle/server/TheIsle/Binaries/Win64"
STATS = WIN64 + "/Mods/StatsLogger/Saved"
LOGS = "/home/isle/server/TheIsle/Saved/Logs"
FOLLOW_S = 2 * 3600          # how long after the redeem to follow a dino
DROP = 0.5                   # a max below half the one it came out with = fell

args = sys.argv[1:]
since = 0
who = None
for i, a in enumerate(args):
    if a == "--since" and i + 1 < len(args):
        v = args[i + 1]
        since = time.time() - float(v[:-1]) * 3600 if v.endswith("h") else float(v)
    if a == "--player" and i + 1 < len(args):
        who = args[i + 1].lower()


def lines(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    yield json.loads(line)
                except ValueError:
                    pass
    except OSError:
        return


# --- events: redeems, lives, sessions, hits --------------------------------------
redeems, ends, hits, names = [], {}, {}, {}
for e in lines(STATS + "/events.ndjson"):
    t, ty, sid = e.get("t", 0), e.get("type"), e.get("steamId")
    if sid and e.get("name"):
        names[sid] = e["name"]
    if ty == "garage_redeem" and e.get("ok") and t >= since:
        redeems.append(e)
    elif ty in ("spawn", "death", "session_start", "session_end", "garage_store") and sid:
        ends.setdefault(sid, []).append((t, ty))
    elif ty == "damage" and e.get("victim") not in (None, "ai"):
        hits.setdefault(e["victim"], []).append(t)

# --- the admins' Heals, from the game's log (UTC times) ---------------------------
HEAL = re.compile(r"^\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):\d{3}\]\[\s*\d+\]LogTheIsleCommandData: \[[^\]]*\] (.+?) \[(\d{17})\] used command: (Heal|SetHunger|SetThirst|SetHealth|SetBlood|Grow) at: (.*?), \[(\d{17})\]")
heals = {}
for path in sorted(glob.glob(LOGS + "/*.log")):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                if "used command:" not in line:
                    continue
                m = HEAL.match(line)
                if m:
                    t = timegm(tuple(int(x) for x in m.groups()[:6]) + (0, 0, 0))
                    heals.setdefault(m.group(11), []).append((t, m.group(9), m.group(7)))
    except OSError:
        pass

# --- the snapshots of the players who took a dino out ------------------------------
wanted = {r["steamId"] for r in redeems}
snaps = {}
for path in sorted(glob.glob(STATS + "/snapshots.ndjson*")):
    for e in lines(path):
        sid = e.get("steamId")
        if sid in wanted:
            snaps.setdefault(sid, []).append(e)
for v in snaps.values():
    v.sort(key=lambda e: e.get("t", 0))


def fmt(t):
    return time.strftime("%d/%m %H:%M:%S", time.localtime(t))


def short(cls):
    return (cls or "?").split(".")[-1].replace("BP_", "").replace("_C", "")


total = flagged = 0
for r in redeems:
    sid, t0 = r["steamId"], r["t"]
    name = names.get(sid, sid)
    if who and who not in name.lower() and who != sid:
        continue
    # The life ends at the next spawn / death of that player (a new dino).
    # …or when it goes back into the garage (the store sets its health to 0: not a death).
    stop = min([t for t, ty in ends.get(sid, []) if ty in ("spawn", "death", "garage_store") and t > t0 + 5] + [t0 + FOLLOW_S])
    rows = [s for s in snaps.get(sid, []) if t0 <= s.get("t", 0) <= stop and s.get("max")]
    # A new dino (died, respawned, the snapshot before its spawn event): its max health is a hatchling's.
    if rows:
        h0 = (rows[0].get("max") or {}).get("health") or 0
        for i, s in enumerate(rows):
            if h0 and ((s.get("max") or {}).get("health") or 0) < h0 * 0.3:
                rows = rows[:i]
                break
    total += 1
    head = f"{fmt(t0)}  {name} ({sid})  {short(r.get('species'))} {round((r.get('growth') or 0) * 100)}%  slot {r.get('slot')}"
    if not rows:
        print(head + "\n    no snapshot after it (offline?)\n")
        continue
    first = rows[0]
    base = first["max"]
    marks = [(t, "Heal" if c == "Heal" else c, by) for t, c, by in heals.get(sid, []) if t0 <= t <= stop]
    marks += [(t, ty, "") for t, ty in ends.get(sid, []) if t0 < t <= stop and ty in ("session_end", "session_start")]
    marks.sort()
    problems = []
    for s in rows[1:]:
        m = s["max"]
        for k in ("hunger", "thirst"):
            if base.get(k) and m.get(k) is not None and m[k] < base[k] * DROP:
                cause = [f"{c}{' by ' + by if by else ''} {fmt(t)}" for t, c, by in marks if t <= s["t"]]
                problems.append(f"{fmt(s['t'])} max {k} {base[k]:.0f} -> {m[k]:.0f}  after: {cause[-1] if cause else 'nothing logged'}")
                base = dict(base, **{k: m[k]})   # report each fall once
    # What a relog changed: the maxima just before and just after it.
    for t, c, _ in marks:
        if c != "session_start":
            continue
        before = [s for s in rows if s["t"] < t]
        after = [s for s in rows if s["t"] >= t]
        if not before or not after:
            continue
        b, a = before[-1]["max"], after[0]["max"]
        changed = [f"{k} {b[k]:.0f}->{a[k]:.0f}" for k in ("health", "hunger", "thirst", "stamina")
                   if b.get(k) and a.get(k) is not None and abs(a[k] - b[k]) > b[k] * 0.05]
        if changed:
            problems.append(f"{fmt(t)} relog changed the maxima: {', '.join(changed)}")
    # Health / blood lower than when it came out, with no hit taken since.
    took_hit = any(t0 <= h <= stop for h in hits.get(sid, []))
    low = min(rows, key=lambda s: (s.get("health") or 0) / max(1, (s.get("max") or {}).get("health") or 1))
    hp0 = (first.get("health") or 0) / max(1, base.get("health") or 1)
    hp1 = (low.get("health") or 0) / max(1, (low.get("max") or {}).get("health") or 1)
    if not took_hit and hp1 < hp0 - 0.05:
        problems.append(f"{fmt(low['t'])} health {hp0 * 100:.0f}% -> {hp1 * 100:.0f}% with no hit taken")
    end = rows[-1]
    print(head)
    print(f"    came out: health {first.get('health', 0):.0f}/{first['max'].get('health', 0):.0f}"
          f"  stomach {first.get('hunger', 0):.0f}/{first['max'].get('hunger', 0):.0f}"
          f"  thirst {first.get('thirst', 0):.0f}/{first['max'].get('thirst', 0):.0f}"
          f"  blood {first.get('blood', 0):.0f}/{first['max'].get('blood', 0):.0f}")
    for t, c, by in marks:
        print(f"    {fmt(t)}  {c}{' by ' + by if by else ''}")
    print(f"    last ({fmt(end['t'])}): health {end.get('health', 0):.0f}/{end['max'].get('health', 0):.0f}"
          f"  stomach {end.get('hunger', 0):.0f}/{end['max'].get('hunger', 0):.0f}"
          f"  thirst {end.get('thirst', 0):.0f}/{end['max'].get('thirst', 0):.0f}")
    if problems:
        flagged += 1
        for p in problems:
            print("    !! " + p)
    else:
        print("    OK")
    print()
print(f"{total} dinos taken out, {flagged} with a problem")
if "--summary" in args:
    pass
