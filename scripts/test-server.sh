#!/usr/bin/env bash
# test-server.sh — a second The Isle server on the same VPS, for trying mods
# without touching the live one. Run ON THE VPS as root.
#
#   ./test-server.sh setup    copy the live install (game + mods, NOT the player
#                             data), its own Wine prefix, a Game.ini with its own
#                             ports and no password, and theisle-test.service
#   ./test-server.sh start | stop | status
#
# The copy: /home/isle/test/{server,prefix}. Ports: game 7787, queue 10001,
# RCON 8889 (live: 7777 / 10000 / 8888). Its own Wine prefix = its own
# wineserver (sharing one slowed both). The service runs below the live one
# (Nice=10, at most one core), does not come back after a crash, and does not
# start with the VPS. Mods run with empty Saved/ folders: no AI zones, no garage.

set -euo pipefail

LIVE=/home/isle/server
ROOT=/home/isle/test
UNIT=/etc/systemd/system/theisle-test.service

setup() {
    systemctl stop theisle-test 2>/dev/null || true
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
    chown -R isle:isle "$ROOT"

    cat > "$UNIT" <<'EOF'
[Unit]
Description=The Isle Evrima TEST server (Wine) - mod experiments, started by hand
After=network-online.target

[Service]
Type=simple
User=isle
WorkingDirectory=/home/isle/test/server/TheIsle/Binaries/Win64
Environment=WINEPREFIX=/home/isle/test/prefix
Environment=GAME_ROOT=/home/isle/test/server
Environment=GAME_PORT=7787
Environment=WINEDEBUG=-all
ExecStart=/home/isle/bin/start.sh
# Below the live server (Nice=-5), and never more than one core.
Nice=10
CPUQuota=100%
# A crash stays down: experiments must not loop.
Restart=no
TimeoutStopSec=60
KillSignal=SIGINT
EOF
    systemctl daemon-reload
    echo "test server ready in $ROOT — start it with: $0 start"
}

case "${1:-}" in
    setup)  setup ;;
    start)  systemctl start theisle-test ;;
    stop)   systemctl stop theisle-test ;;
    status) systemctl status theisle-test --no-pager | head -5 ;;
    *) sed -n '2,15p' "$0"; exit 1 ;;
esac
