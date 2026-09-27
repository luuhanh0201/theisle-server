#!/usr/bin/env python3
"""Fetch the skin preview's 3D assets into portal/public/dino3d/ (not in git, ~50 MB).

The models, region maps, normal and RAC maps of the 21 playable species, as
IsleHub (sv1.datviet.app) serves them: registry.json lists every file with its
size and sha256; each is checked, and files already there are kept.
The portal deploy (scripts/deploy.sh --portal-only) ships the folder.

    python3 scripts/fetch-dino3d.py
"""
import hashlib
import json
import os
import sys
import time
import urllib.request

SOURCE = "https://sv1.datviet.app"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "portal", "public")


def get(path):
    req = urllib.request.Request(SOURCE + path, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main():
    registry = json.loads(get("/dino3d/registry.json"))
    os.makedirs(os.path.join(ROOT, "dino3d"), exist_ok=True)
    with open(os.path.join(ROOT, "dino3d", "registry.json"), "w") as f:
        json.dump(registry, f, indent=1)
    fetched = kept = bad = 0
    for path, meta in registry["files"].items():
        dst = os.path.normpath(ROOT + path)
        if not dst.startswith(os.path.normpath(ROOT) + os.sep):
            print("skipped (outside the folder):", path)
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.exists(dst) and hashlib.sha256(open(dst, "rb").read()).hexdigest() == meta["sha256"]:
            kept += 1
            continue
        data = get(path)
        if hashlib.sha256(data).hexdigest() != meta["sha256"]:
            print("sha256 mismatch:", path)
            bad += 1
            continue
        with open(dst, "wb") as f:
            f.write(data)
        fetched += 1
        time.sleep(0.2)
    print(f"fetched {fetched}, already there {kept}, bad {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
