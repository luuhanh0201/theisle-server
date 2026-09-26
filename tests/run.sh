#!/usr/bin/env bash
# run.sh — syntax-check every Lua file, then run the functional tests against a
# mock UE4SS. No game and no server required.
#
#   ./tests/run.sh
#
# The mocks live in harness.lua. They are deliberately thin: they model only
# what the mods actually touch, plus the one engine behaviour the restore order
# depends on (SetGrowth refilling vitals).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LUA="${LUA:-lua5.4}"
LUAC="${LUAC:-luac5.4}"

command -v "$LUA"  >/dev/null || { echo "tests: $LUA not found"  >&2; exit 1; }
command -v "$LUAC" >/dev/null || { echo "tests: $LUAC not found" >&2; exit 1; }

echo "== syntax =="
while IFS= read -r f; do
    "$LUAC" -p "$f" && echo "  ok   ${f#"$ROOT"/}"
done < <(find "$ROOT/mods" -name '*.lua' | sort)

# Mirror the deployed layout so the require paths are the real ones.
RUN="$(mktemp -d)"
trap 'rm -rf "$RUN"' EXIT

mkdir -p "$RUN/Mods/shared/isle" \
         "$RUN/Mods/DinoGarage/Saved/stored" \
         "$RUN/Mods/DinoGarage/Saved/deleted" \
         "$RUN/Mods/StatsLogger/Saved" \
         "$RUN/Mods/PlayerCommands/Saved" "$RUN/Mods/Flora/Saved" "$RUN/Mods/FishControl/Saved"
cp "$ROOT"/mods/_shared/*.lua "$RUN/Mods/shared/isle/"
for dir in "$ROOT"/mods/*/; do
    mod="$(basename "$dir")"
    [[ "$mod" == _* ]] && continue          # _shared is copied above
    mkdir -p "$RUN/Mods/$mod/Scripts"
    cp -r "$ROOT/mods/$mod/Scripts/." "$RUN/Mods/$mod/Scripts/"
done

failed=0
for test in "$ROOT"/tests/test_*.lua; do
    echo
    echo "== $(basename "$test") =="
    # Each test gets a fresh state: the mods hold module-level state and
    # register global hooks, so they must not share an interpreter.
    ( cd "$RUN" && "$LUA" \
        -e "ROOT='$ROOT' RUN='$RUN'" \
        -e "package.path='$ROOT/tests/?.lua;'..'$RUN/Mods/?.lua;'..'$RUN/Mods/DinoGarage/Scripts/?.lua;'..package.path" \
        "$test" ) || failed=1
    # DinoGarage state must not leak into the next test run.
    rm -rf "$RUN/Mods/DinoGarage/Saved" "$RUN/Mods/PlayerCommands/Saved"
    mkdir -p "$RUN/Mods/DinoGarage/Saved/stored" "$RUN/Mods/DinoGarage/Saved/deleted" "$RUN/Mods/PlayerCommands/Saved"
done

echo
if (( failed )); then echo "TESTS FAILED"; exit 1; fi
echo "all tests passed"
