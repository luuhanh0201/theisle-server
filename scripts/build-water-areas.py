#!/usr/bin/env python3
"""The water of the live maps, filled (owner's request, 2026-10-04: "tô đậm cả vùng nước
đó lên", not an outline). The map data (VulnonaMAP, gateway.json) only names the waters
(27 labels): the water itself is found here on the map image.

    bridge/public/map/water-mask.png   every inland water pixel (lakes, rivers, ponds —
                                       named or not), as the map image's size: drawn over
                                       it, filled, while the water layer is on
    bridge/public/map/water-areas.json the named waters, outlined (and a circle for a water
                                       the image does not show, filled by the maps)

The sea's shallows along the coast are the same colour as the lakes: a patch of water
lying mostly within COAST px of the sea AND wide is left out (a river is thin; it only meets
the sea at its mouth).

    python3 scripts/build-water-areas.py [--preview out.png]

Writes bridge/public/map/water-areas.json (deploy.sh ships it to the portal's /map/ too):
    { "areas": [ { "name", "kind": "poly", "pts": [[[x, y], ...]] } | { "name", "kind": "circle", "at", "r" } ] }
in map units (as gateway.json: [x down, y right]). gateway.json is left alone (it is
fetched again from the source).

How: inland water on the image is a grey-teal (green ≈ blue > red); the sea is a flat
navy. Per label: the nearest water pixel, then a flood fill —
  lakes / ponds: in the water mask with its thin parts (rivers) cut off first (an
  erosion), so a lake does not run down its river into the next one; grown back after;
  rivers / falls / the delta: along the water itself, within a reach of the label;
  swamps: the navy pockets inside the island, within a reach;
  nothing to see (under trees, too small): a small circle round the label.
Needs PIL and numpy only.
"""
import json
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw

MAP = "bridge/public/map/gateway.json"
IMG = "bridge/public/map/gateway.webp"
# bridge/public/map is the map data both the panel and the portal get (deploy.sh ships it as both).
OUT = "bridge/public/map/water-areas.json"
MASK = "bridge/public/map/water-mask.png"
SCALE = 2            # work on the image at 1/SCALE
SEARCH = 45          # px (work scale): how far from the label the water may start
CIRCLE_R = 9.0       # map units: the circle for a water the image does not show

RIVER_WORDS = ("River", "Falls", "Cascades", "Delta")
SWAMP_WORDS = ("Swamp",)


def load():
    data = json.load(open(MAP))
    im = Image.open(IMG).convert("RGB")
    im = im.resize((im.width // SCALE, im.height // SCALE), Image.BILINEAR)
    return data, np.asarray(im).astype(np.int16)


def masks(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # Darker water (a shadowed gorge, the swamps) is left out: it is the colour of the forest's shade.
    teal = (r >= 30) & (r <= 115) & (g >= 70) & (g <= 145) & (b >= 65) & (b <= 140) & (g - r >= 8) & (np.abs(b - g) <= 26)
    navy = (r <= 30) & (g <= 60) & (b >= 55) & (b - g >= 25)
    return teal, navy


def shift_and(m, k):
    """Erosion by a (2k+1) square, numpy only."""
    out = m.copy()
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            out &= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


def shift_or(m, k):
    out = m.copy()
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


def nearest(mask, r, c, reach):
    h, w = mask.shape
    best = None
    for rr in range(max(0, r - reach), min(h, r + reach + 1)):
        row = mask[rr, max(0, c - reach):min(w, c + reach + 1)]
        for i in np.nonzero(row)[0]:
            cc = max(0, c - reach) + i
            d = (rr - r) ** 2 + (cc - c) ** 2
            if d <= reach * reach and (best is None or d < best[0]):
                best = (d, rr, cc)
    return None if best is None else (best[1], best[2])


def flood(mask, seed, limit):
    """Pixels of `mask` connected to `seed` within `limit` steps (geodesic)."""
    h, w = mask.shape
    out = np.zeros_like(mask)
    q = deque([(seed[0], seed[1], 0)])
    out[seed] = True
    while q:
        r, c, d = q.popleft()
        if d >= limit:
            continue
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            rr, cc = r + dr, c + dc
            if 0 <= rr < h and 0 <= cc < w and mask[rr, cc] and not out[rr, cc]:
                out[rr, cc] = True
                q.append((rr, cc, d + 1))
    return out


def outline(region):
    """The outer boundary of a region, as (row, col) points in order (square tracing)."""
    rows, cols = np.nonzero(region)
    if len(rows) == 0:
        return []
    start = (rows.min(), cols[rows == rows.min()].min())
    # Moore-neighbour tracing.
    dirs = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
    h, w = region.shape
    inside = lambda p: 0 <= p[0] < h and 0 <= p[1] < w and region[p]
    pts = [start]
    cur, back = start, 6   # came from the west
    for _ in range(200000):
        found = False
        for i in range(8):
            k = (back + 1 + i) % 8
            nxt = (cur[0] + dirs[k][0], cur[1] + dirs[k][1])
            if inside(nxt):
                back = (k + 4) % 8
                cur = nxt
                found = True
                break
        if not found or cur == start:
            break
        pts.append(cur)
    return pts


def simplify(pts, eps):
    """Ramer–Douglas–Peucker."""
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0], float), np.array(pts[-1], float)
    ab = b - a
    n = np.hypot(*ab) or 1.0
    best, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        p = np.array(pts[i], float)
        d = abs(ab[0] * (a[1] - p[1]) - ab[1] * (a[0] - p[0])) / n
        if d > best:
            best, idx = d, i
    if best > eps:
        return simplify(pts[: idx + 1], eps)[:-1] + simplify(pts[idx:], eps)
    return [pts[0], pts[-1]]


SALT = 120         # px (full image, ~34 map units): water this close to the sea is salt (coast, river mouths)
COAST = 40          # px (full image): water mostly this close to the sea is the sea's shallows


def write_mask():
    """The full-size water mask as a transparent PNG, coloured where it is water."""
    full = np.asarray(Image.open(IMG).convert("RGB")).astype(np.int16)
    teal, navy = masks(full)
    clean = shift_or(shift_and(teal, 1), 1)        # specks gone
    clean = shift_and(shift_or(clean, 2), 2)       # small holes closed
    near_sea = navy.copy()
    for _ in range(COAST):
        near_sea = shift_or(near_sea, 1)
    # Wide water (a shallow, a lake) keeps a core after this erosion; a river does not.
    wide = shift_and(clean, 4)
    # Patches by 8-connectivity; a patch mostly near the sea goes.
    h, w = clean.shape
    seen = np.zeros_like(clean)
    keep = np.zeros_like(clean)
    for r0, c0 in zip(*np.nonzero(clean)):
        if seen[r0, c0]:
            continue
        comp, q = [], deque([(r0, c0)])
        seen[r0, c0] = True
        while q:
            r, c = q.popleft()
            comp.append((r, c))
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    rr, cc = r + dr, c + dc
                    if 0 <= rr < h and 0 <= cc < w and clean[rr, cc] and not seen[rr, cc]:
                        seen[rr, cc] = True
                        q.append((rr, cc))
        rows, cols = zip(*comp)
        # Mostly by the sea AND wide: the sea's shallows. A river running to the sea stays (thin).
        if len(comp) < 30 or (near_sea[rows, cols].mean() > 0.4 and wide[rows, cols].mean() > 0.15):
            continue
        keep[rows, cols] = True
    # Salt water (owner, 2026-10-04: "vùng đó không hề có nước ngọt" — the coast, the river
    # mouths): nothing within SALT px of the sea, except the named lakes (Dam Lake sits by the
    # sea behind its dam: fresh), kept whole.
    salt = navy.copy()
    for _ in range(SALT // 4):
        salt = shift_or(salt, 4)
    data = json.load(open(MAP))
    b = data["bounds"]
    lakes = np.zeros_like(keep)
    for f in data["features"]:
        if f.get("layer") != "water" or f.get("kind") != "label" or "Lake" not in f["name"]:
            continue
        r = int((f["at"][0] - b["minX"]) / (b["maxX"] - b["minX"]) * h)
        c = int((f["at"][1] - b["minY"]) / (b["maxY"] - b["minY"]) * w)
        seed = nearest(keep, r, c, 120)
        if seed is not None:
            lakes |= flood(keep, seed, 700)
    dropped = int((keep & salt & ~lakes).sum())
    keep &= ~salt | lakes
    print(f"salt water left out: {dropped} px (within {SALT} px of the sea, named lakes kept)")
    out = np.zeros((h, w, 4), np.uint8)
    out[keep] = (255, 255, 255, 255)               # white: the map tints it with the layer's colour
    Image.fromarray(out, "RGBA").save(MASK, optimize=True)
    print(f"water mask: {int(keep.sum())} px -> {MASK}")


def main():
    write_mask()
    data, a = load()
    b = data["bounds"]
    H, W = a.shape[:2]
    teal, navy = masks(a)
    teal_core = shift_and(teal, 2)             # rivers (thin) gone, lakes kept
    areas = []
    to_px = lambda at: (int((at[0] - b["minX"]) / (b["maxX"] - b["minX"]) * H), int((at[1] - b["minY"]) / (b["maxY"] - b["minY"]) * W))
    to_map = lambda r, c: [round(r / H * (b["maxX"] - b["minX"]) + b["minX"], 2), round(c / W * (b["maxY"] - b["minY"]) + b["minY"], 2)]
    for f in data["features"]:
        if f.get("layer") != "water" or f.get("kind") != "label":
            continue
        name = f["name"]
        r, c = to_px(f["at"])
        river = any(w in name for w in RIVER_WORDS)
        swamp = any(w in name for w in SWAMP_WORDS)
        region = None
        if swamp:
            seed = nearest(navy, r, c, SEARCH)
            if seed is not None:
                region = flood(navy, seed, 90)
        elif river:
            seed = nearest(teal, r, c, SEARCH)
            if seed is not None:
                region = flood(teal, seed, 220)
        else:
            seed = nearest(teal_core, r, c, SEARCH)
            if seed is not None:
                core = flood(teal_core, seed, 400)
                region = shift_or(core, 2) & teal
            # A lake of many islands (East Lake) has no core left after the erosion: the water itself, close by.
            if region is None or region.sum() < 300:
                seed = nearest(teal, r, c, SEARCH)
                if seed is not None:
                    region = flood(teal, seed, 70)
        if region is not None and region.sum() >= 40:
            region = shift_or(shift_and(region, 1), 1) if not river else region   # smooth specks
            pts = simplify(outline(region), 1.2)
            if len(pts) >= 4:
                areas.append({"name": name, "kind": "poly", "pts": [[to_map(rr, cc) for rr, cc in pts]], "px": int(region.sum())})
                continue
        areas.append({"name": name, "kind": "circle", "at": f["at"], "r": CIRCLE_R})
    json.dump({"source": "traced from the map image (scripts/build-water-areas.py)", "areas": areas}, open(OUT, "w"), ensure_ascii=False)
    print(f"{len(areas)} waters: {sum(1 for x in areas if x['kind'] == 'poly')} outlined, {sum(1 for x in areas if x['kind'] == 'circle')} circles")
    for x in areas:
        print(f"  {x['name']:24s} {x['kind']:6s} {x.get('px', '')}")
    print("then bump WATER_V in portal/public/map.js and bridge/public/index.html (the proxy caches /map/* a week)")
    if "--preview" in sys.argv:
        out = sys.argv[sys.argv.index("--preview") + 1]
        im = Image.open(IMG).convert("RGB").resize((W, H))
        dr = ImageDraw.Draw(im, "RGBA")
        to_img = lambda p: ((p[1] - b["minY"]) / (b["maxY"] - b["minY"]) * W, (p[0] - b["minX"]) / (b["maxX"] - b["minX"]) * H)
        for x in areas:
            if x["kind"] == "poly":
                dr.polygon([to_img(p) for p in x["pts"][0]], fill=(56, 189, 248, 70), outline=(56, 189, 248, 255))
            else:
                cx, cy = to_img(x["at"]); rr = x["r"] / (b["maxX"] - b["minX"]) * H
                dr.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=(56, 189, 248, 255), width=2)
        im.save(out)


if __name__ == "__main__":
    main()
