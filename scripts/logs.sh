#!/usr/bin/env bash
# logs.sh — tail the server logs.
#
#   ./scripts/logs.sh          both logs, prefixed
#   ./scripts/logs.sh ue4ss    UE4SS.log only  (mod loading, Lua errors)
#   ./scripts/logs.sh game     TheIsle.log only
#   ./scripts/logs.sh unit     journalctl for theisle.service
#   ./scripts/logs.sh probe    IsleProbe output only, once (docs/first-run.md)
#
# Runs on the VPS, or locally over SSH when DEPLOY_HOST is set in .env.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$ROOT/.env" ]] && set -a && . "$ROOT/.env" && set +a

GAME_ROOT="${GAME_ROOT:-/home/isle/server}"
UE4SS_LOG="$GAME_ROOT/TheIsle/Binaries/Win64/UE4SS.log"
GAME_LOG="$GAME_ROOT/TheIsle/Saved/Logs/TheIsle.log"
LINES="${LINES:-100}"

case "${1:-both}" in
    ue4ss) CMD="tail -n $LINES -F '$UE4SS_LOG'" ;;
    game)  CMD="tail -n $LINES -F '$GAME_LOG'" ;;
    unit)  CMD="journalctl -u theisle.service -n $LINES -f" ;;
    probe) CMD="grep -a -F '[isle-probe]' '$UE4SS_LOG' | tail -n 400 || echo 'no IsleProbe output yet — is IsleProbe : 1 in mods.txt?'" ;;
    both)  CMD="tail -n $LINES -F '$UE4SS_LOG' '$GAME_LOG'" ;;
    *)     echo "usage: $0 [ue4ss|game|unit|both|probe]" >&2; exit 2 ;;
esac

if [[ -n "${DEPLOY_HOST:-}" && ! -d "$GAME_ROOT" ]]; then
    exec ssh -t "$DEPLOY_HOST" "$CMD"
fi
eval "exec $CMD"
