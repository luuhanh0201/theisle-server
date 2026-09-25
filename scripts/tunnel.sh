#!/usr/bin/env bash
# tunnel.sh — open the admin panel on this machine through SSH, and keep it open.
#
#   ./scripts/tunnel.sh            http://127.0.0.1:8181 -> the bridge on the VPS
#   ./scripts/tunnel.sh 9000       another local port
#
# The panel never listens on the internet (the bridge binds 127.0.0.1 on the
# VPS); this forward is the way in. SSH drops now and then (Wi-Fi, sleep), so
# it reconnects by itself. Stop it with Ctrl+C (or kill the loop's PID).
# Reads DEPLOY_HOST and HTTP_PORT from .env.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$ROOT/.env" ]] && set -a && . "$ROOT/.env" && set +a

LOCAL_PORT="${1:-8181}"
REMOTE_PORT="${HTTP_PORT:-8080}"
: "${DEPLOY_HOST:?DEPLOY_HOST is not set in .env}"

echo "==> panel: http://127.0.0.1:$LOCAL_PORT  (-> $DEPLOY_HOST 127.0.0.1:$REMOTE_PORT)"
while true; do
    ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
        -o BatchMode=yes -L "127.0.0.1:$LOCAL_PORT:127.0.0.1:$REMOTE_PORT" "$DEPLOY_HOST"
    echo "==> tunnel closed ($(date +%T)), reconnecting in 3 s…" >&2
    sleep 3
done
