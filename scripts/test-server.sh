#!/usr/bin/env bash
# test-server.sh, a second The Isle server on the same VPS, for trying mods
# and game updates without touching the live one. Run ON THE VPS as `isle`
# (no root needed: it is a plain process, not a systemd unit).
#
#   ./test-server.sh setup    copy the live install (game + mods, NOT the player
#                             data), its own Wine prefix, a Game.ini with its own
#                             ports and NO password (rule: the test server is open)
#   ./test-server.sh start | stop | status
#
# The copy: /home/isle/test/{server,prefix}. Ports: game 7787, queue 10001,
# RCON 8889 (live: 7777 / 10000 / 8888). Its own Wine prefix = its own
# wineserver (sharing one slowed both). It runs below the live one (nice 10,
# pinned to one core: TEST_CPU, default the last one), does not come back after
# a crash, and does not start with the VPS. Mods run with empty Saved/ folders:
# no AI zones, no garage. Extra launch arguments: TEST_ARGS="-Foo -Bar".
#
# 2026-09-27: the in-game list showed "[TEST] …" with the live server's player
# count, and joining it landed on the LIVE server (the listing carried port
# 7777). Being re-checked 2026-10-01, see docs/NHAT-KY-VAN-HANH.md.

set -euo pipefail

LIVE=/home/isle/server
ROOT=/home/isle/test
PIDFILE="$ROOT/server.pid"
CONSOLE="$ROOT/console.log"
# The test copy's own start.sh when there is one (so a change for the test
# server never touches the live server's /home/isle/bin/start.sh).
START_SH=/home/isle/bin/start.sh
[[ -x "$ROOT/start.sh" ]] && START_SH="$ROOT/start.sh"

running() { [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

setup() {
    if running; then echo "test server is running, stop it first: $0 stop" >&2; exit 1; fi
    mkdir -p "$ROOT/server"
    # Everything but the player data (TheIsle/Saved) and each mod's Saved/.
    rsync -a --delete --exclude 'TheIsle/Saved/' --exclude 'Binaries/Win64/Mods/*/Saved/' --exclude '*.log' \
        "$LIVE/" "$ROOT/server/"
    rsync -a --delete /home/isle/prefix/ "$ROOT/prefix/"
    local mods="$ROOT/server/TheIsle/Binaries/Win64/Mods"
    for m in "$mods"/*/; do [[ -d "$m/Scripts" ]] && mkdir -p "$m/Saved"; done
    mkdir -p "$mods/DinoGarage/Saved/stored" "$mods/DinoGarage/Saved/deleted"

    local cfg="$ROOT/server/TheIsle/Saved/Config/WindowsServer"
    mkdir -p "$cfg"
    cp "$LIVE/TheIsle/Saved/Config/WindowsServer/Engine.ini" "$cfg/"
    # No password on the test server (the admin's rule, 2026-10-01): testers
    # join it straight from the list.
    python3 - "$LIVE/TheIsle/Saved/Config/WindowsServer/Game.ini" "$cfg/Game.ini" "$(openssl rand -hex 8)" <<'EOF'
import re, sys
src, dst, rcon = sys.argv[1:4]
s = open(src).read()
def setk(s, k, v): return re.sub(r"(?m)^%s=.*$" % re.escape(k), "%s=%s" % (k, v), s)
for k, v in (("ServerName", "[TEST] XG EVO - server thu nghiem"), ("bServerPassword", "false"),
             ("ServerPassword", ""), ("RconPort", "8889"), ("QueuePort", "10001"),
             ("RconPassword", rcon), ("MaxPlayerCount", "10")):
    s = setk(s, k, v)
open(dst, "w").write(s)
EOF
    echo "test server ready in $ROOT (no password), start it with: $0 start"
}

start() {
    if running; then echo "already running (pid $(cat "$PIDFILE"))"; return; fi
    local cpu="${TEST_CPU:-$(( $(nproc) - 1 ))}"
    # shellcheck disable=SC2086  # TEST_ARGS is a list of words on purpose
    WINEPREFIX="$ROOT/prefix" GAME_ROOT="$ROOT/server" GAME_PORT="${TEST_PORT:-7787}" WINEDEBUG=-all \
        setsid nohup nice -n 10 taskset -c "$cpu" "$START_SH" ${TEST_ARGS:-} >"$CONSOLE" 2>&1 </dev/null &
    echo $! > "$PIDFILE"
    echo "started (pid $!, cpu $cpu, port ${TEST_PORT:-7787}); console: $CONSOLE"
}

stop() {
    if running; then
        kill -INT "$(cat "$PIDFILE")" 2>/dev/null || true
        for _ in $(seq 1 30); do running || break; sleep 1; done
    fi
    # Only the test prefix's own wineserver: the live one is a different prefix.
    WINEPREFIX="$ROOT/prefix" wineserver -k 2>/dev/null || true
    rm -f "$PIDFILE"
    echo "stopped"
}

case "${1:-}" in
    setup)  setup ;;
    start)  start ;;
    stop)   stop ;;
    status) if running; then echo "running (pid $(cat "$PIDFILE"))"; else echo "stopped"; fi ;;
    *) sed -n '2,17p' "$0"; exit 1 ;;
esac
