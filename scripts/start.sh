#!/usr/bin/env bash
# start.sh — the one and only place the Wine launch command lives.
# Runs ON THE VPS, normally via systemd (theisle.service).
#
# If you need to change how the server starts, change it here. Do not paste a
# variant into the systemd unit or into a shell on the server.

set -euo pipefail

# --- paths (keep in sync with docs/server-paths.md) ---------------------
export WINEPREFIX="${WINEPREFIX:-/home/isle/prefix}"
GAME_ROOT="${GAME_ROOT:-/home/isle/server}"
BIN_DIR="$GAME_ROOT/TheIsle/Binaries/Win64"
EXE="TheIsleServer-Win64-Shipping.exe"

# --- map + port -----------------------------------------------------------
# Evrima serves game and query traffic on the same UDP port (7777 by default);
# the join queue (QueuePort in Game.ini, 10000) is separate.
MAP="${MAP:-/Game/TheIsle/Maps/Game/Gateway/Gateway}"
GAME_PORT="${GAME_PORT:-7777}"

# --- wine ---------------------------------------------------------------
export WINEARCH=win64
export WINEDEBUG="${WINEDEBUG:--all}"          # Wine noise drowns out UE4SS.log
export WINEDLLOVERRIDES="dwmapi=n,b"           # load the UE4SS proxy DLL
export DISPLAY=""                              # headless

if [[ ! -f "$BIN_DIR/$EXE" ]]; then
    echo "start.sh: $BIN_DIR/$EXE not found — is the server installed?" >&2
    exit 1
fi

# UE4SS 3.0+ is two files: dwmapi.dll is only the proxy that loads UE4SS.dll.
for dll in dwmapi.dll UE4SS.dll; do
    [[ -f "$BIN_DIR/$dll" ]] || \
        echo "start.sh: warning — $dll missing, UE4SS will NOT load" >&2
done

# The Wine launcher. `wine` runs a 64-bit .exe with the 64-bit loader on every
# packaging we know of. `wine64` is NOT on PATH with Ubuntu 24.04's own wine
# (it lives in /usr/lib/wine/), and calling it made every start exit 127.
WINE_BIN="${WINE_BIN:-}"
if [[ -z "$WINE_BIN" ]]; then
    for candidate in wine wine64 /usr/lib/wine/wine64; do
        if command -v "$candidate" >/dev/null 2>&1; then WINE_BIN="$candidate"; break; fi
    done
fi
[[ -n "$WINE_BIN" ]] || { echo "start.sh: no Wine found (tried wine, wine64, /usr/lib/wine/wine64)" >&2; exit 1; }
echo "start.sh: launching $EXE with $(command -v "$WINE_BIN") ($("$WINE_BIN" --version 2>/dev/null || echo 'version unknown'))"

cd "$BIN_DIR"

exec "$WINE_BIN" "$EXE" \
    "${MAP}?Port=${GAME_PORT}" \
    -log \
    -nosound \
    "$@"
