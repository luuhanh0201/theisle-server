#!/usr/bin/env bash
# deploy.sh — render config templates, sync to the VPS, restart the server.
#
#   ./scripts/deploy.sh --dry-run     render + check + show the diff, change nothing
#   ./scripts/deploy.sh               full deploy (RESTARTS THE SERVER)
#   ./scripts/deploy.sh --no-restart  sync only; applies on the next restart
#   ./scripts/deploy.sh --config-only
#   ./scripts/deploy.sh --mods-only
#   ./scripts/deploy.sh --bridge-only   only the Node service (no game restart)
#   ./scripts/deploy.sh --no-bridge
#
# See docs/deploy.md. `Saved/` is never synced except Saved/Config/WindowsServer.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
RESTART=1
DO_CONFIG=1
DO_MODS=1
DO_BRIDGE=1

for arg in "$@"; do
    case "$arg" in
        --dry-run)     DRY_RUN=1 ;;
        --no-restart)  RESTART=0 ;;
        --config-only) DO_MODS=0; DO_BRIDGE=0 ;;
        --mods-only)   DO_CONFIG=0; DO_BRIDGE=0 ;;
        --bridge-only) DO_CONFIG=0; DO_MODS=0 ;;
        --no-bridge)   DO_BRIDGE=0 ;;
        -h|--help)     sed -n '2,12p' "$0"; exit 0 ;;
        *) echo "deploy.sh: unknown option $arg" >&2; exit 2 ;;
    esac
done

die() { echo "deploy.sh: $*" >&2; exit 1; }
say() { echo "==> $*"; }

# --- 1. environment -----------------------------------------------------

[[ -f .env ]] || die ".env not found — copy .env.example and fill it in"
set -a; . ./.env; set +a

REQUIRED=(
    DEPLOY_HOST GAME_ROOT EVENTS_PATH GARAGE_ROOT HTTP_HOST HTTP_PORT
    SERVER_NAME MAX_PLAYERS
    RCON_PORT RCON_PASSWORD ADMIN_STEAM_IDS
    QUEUE_PORT EOS_CLIENT_ID EOS_CLIENT_SECRET
)
# May be empty on purpose (a public server has no password).
OPTIONAL=(SERVER_PASSWORD)
for key in "${REQUIRED[@]}"; do
    [[ -n "${!key:-}" ]] || die "$key is not set in .env"
done
for key in "${OPTIONAL[@]}"; do
    declare -gx "$key=${!key:-}"
done

# Derived values the templates need but .env should not have to spell out.
if [[ -n "$SERVER_PASSWORD" ]]; then SERVER_PASSWORD_ENABLED=true; else SERVER_PASSWORD_ENABLED=false; fi
# The game reads one "AdminsSteamIDs=<id>" line per admin.
ADMIN_STEAM_IDS_LINES=""
IFS=',' read -r -a _admins <<< "$ADMIN_STEAM_IDS"
for id in "${_admins[@]}"; do
    id="${id//[[:space:]]/}"
    [[ -z "$id" ]] && continue
    [[ "$id" =~ ^[0-9]{17}$ ]] || die "ADMIN_STEAM_IDS: '$id' is not a 17-digit SteamID64"
    ADMIN_STEAM_IDS_LINES+="AdminsSteamIDs=$id"$'\n'
done
ADMIN_STEAM_IDS_LINES="${ADMIN_STEAM_IDS_LINES%$'\n'}"
[[ -n "$ADMIN_STEAM_IDS_LINES" ]] || die "ADMIN_STEAM_IDS has no SteamID in it"
export SERVER_PASSWORD_ENABLED ADMIN_STEAM_IDS_LINES
TEMPLATE_VARS=("${REQUIRED[@]}" "${OPTIONAL[@]}" SERVER_PASSWORD_ENABLED ADMIN_STEAM_IDS_LINES)

BIN_DIR="$GAME_ROOT/TheIsle/Binaries/Win64"
CONFIG_DIR="$GAME_ROOT/TheIsle/Saved/Config/WindowsServer"
BACKUP_DIR="/home/isle/backups/$(date -u +%Y%m%dT%H%M%SZ)"

# --- 2. render templates ------------------------------------------------

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/config"

say "rendering config"
for src in config/*.template; do
    out="$STAGE/config/$(basename "$src" .template)"
    # Only substitute the variables we declared; leave anything else alone.
    envsubst "$(printf '${%s}' "${TEMPLATE_VARS[@]}")" < "$src" > "$out"
    if grep -q '\${' "$out"; then
        grep -n '\${' "$out" >&2
        die "$(basename "$out") still has unsubstituted placeholders"
    fi
done
for src in config/*.ini; do
    [[ -e "$src" ]] || continue
    cp "$src" "$STAGE/config/"
done

# --- 3. check Lua -------------------------------------------------------

if (( DO_MODS )); then
    if command -v lua5.4 >/dev/null 2>&1 && command -v luac5.4 >/dev/null 2>&1; then
        say "running the Lua test suite"
        ./tests/run.sh
    elif command -v luac >/dev/null 2>&1; then
        say "syntax-checking Lua (install lua5.4 to run the tests)"
        find mods -name '*.lua' -print0 | xargs -0 -r -n1 luac -p
    else
        echo "    (lua not installed — mods NOT checked)" >&2
    fi
fi

# --- 4. sync ------------------------------------------------------------

RSYNC=(rsync -az --delete --itemize-changes)
(( DRY_RUN )) && RSYNC+=(--dry-run)

if (( DO_CONFIG )); then
    say "config -> $CONFIG_DIR"
    if (( DRY_RUN )); then
        ssh "$DEPLOY_HOST" "test -d '$CONFIG_DIR'" \
            || echo "    (would create $CONFIG_DIR — the server has not run yet)"
    else
        # On a fresh install the game has not run yet, so Saved/Config does not
        # exist. Creating the directory is all we do under Saved/ besides it.
        ssh "$DEPLOY_HOST" "mkdir -p '$CONFIG_DIR' '$BACKUP_DIR/config' && \
            cp -a '$CONFIG_DIR/.' '$BACKUP_DIR/config/' 2>/dev/null || true"
        say "backed up previous config to $BACKUP_DIR/config"
    fi
    # NO --delete here: the game writes its own .ini files into this directory
    # too. We overwrite exactly the files rendered above and leave the rest.
    rsync -az --itemize-changes $( ((DRY_RUN)) && echo --dry-run ) --no-perms --omit-dir-times \
        "$STAGE/config/" "$DEPLOY_HOST:$CONFIG_DIR/"
fi

if (( DO_MODS )); then
    say "ue4ss -> $BIN_DIR/ue4ss"
    "${RSYNC[@]}" ue4ss/UE4SS-settings.ini "$DEPLOY_HOST:$BIN_DIR/ue4ss/"
    "${RSYNC[@]}" ue4ss/mods.txt           "$DEPLOY_HOST:$BIN_DIR/ue4ss/Mods/"

    # UE4SS owns Mods/shared/ — it ships Types.lua and UEHelpers/ there.
    # Our helpers go in a subfolder of their own, and this sync must NEVER
    # use --delete or it would wipe UEHelpers out from under BPModLoaderMod.
    say "shared helpers -> $BIN_DIR/ue4ss/Mods/shared/isle"
    rsync -az --itemize-changes $( ((DRY_RUN)) && echo --dry-run ) --exclude 'README.md' \
        mods/_shared/ "$DEPLOY_HOST:$BIN_DIR/ue4ss/Mods/shared/isle/"

    for mod in mods/*/; do
        name="$(basename "$mod")"
        [[ "$name" == _* ]] && continue
        say "mod $name -> $BIN_DIR/ue4ss/Mods/$name"
        # Saved/ is the mod's RUNTIME data: stored dinos, the event stream.
        # It does not exist in this repo, so --delete would wipe it. Excluding
        # it here is the difference between a deploy and a data loss.
        "${RSYNC[@]}" --exclude 'Saved/' \
            "$mod" "$DEPLOY_HOST:$BIN_DIR/ue4ss/Mods/$name/"
    done
fi

# --- 4b. bridge ---------------------------------------------------------
# The bridge is a plain Node service. We build locally and ship dist/ plus the
# production deps, so the VPS needs node but no toolchain.

BRIDGE_DIR="/home/isle/bridge"

if (( DO_BRIDGE )); then
    say "building bridge"
    # npm test = tsc + the store tests; a failing test stops the deploy.
    ( cd bridge && npm ci --silent && npm test )

    say "bridge -> $BRIDGE_DIR"
    "${RSYNC[@]}" --exclude 'node_modules' \
        bridge/dist/ "$DEPLOY_HOST:$BRIDGE_DIR/dist/"
    "${RSYNC[@]}" bridge/public/ "$DEPLOY_HOST:$BRIDGE_DIR/public/"
    "${RSYNC[@]}" bridge/package.json bridge/package-lock.json \
        "$DEPLOY_HOST:$BRIDGE_DIR/"

    # systemd reads this via EnvironmentFile. Only the bridge's own keys go in
    # it — never the whole .env, which holds the RCON password.
    cat > "$STAGE/bridge.env" <<ENV
EVENTS_PATH=$EVENTS_PATH
GARAGE_ROOT=$GARAGE_ROOT
ADMIN_TOKEN=${ADMIN_TOKEN:-}
HTTP_HOST=$HTTP_HOST
HTTP_PORT=$HTTP_PORT
POLL_MS=${POLL_MS:-1000}
FEED_SIZE=${FEED_SIZE:-500}
OFFLINE_AFTER_SECONDS=${OFFLINE_AFTER_SECONDS:-30}
ENV
    "${RSYNC[@]}" --no-perms --omit-dir-times \
        "$STAGE/bridge.env" "$DEPLOY_HOST:$BRIDGE_DIR/.env"

    if (( ! DRY_RUN )); then
        ssh "$DEPLOY_HOST" "cd '$BRIDGE_DIR' && npm ci --omit=dev --silent"
        # The bridge only reads a file and serves HTTP: restarting it is safe
        # and does not touch the game server or disconnect anyone.
        # Restarting the bridge is safe (it only reads files and serves HTTP),
        # but it must not fail silently: a bridge that was not restarted keeps
        # serving the OLD code. sudo -n: never hang on a password prompt.
        if ! ssh "$DEPLOY_HOST" "sudo -n systemctl restart theisle-bridge.service"; then
            echo "    ! could not restart theisle-bridge.service — the bridge is still" >&2
            echo "      running the previous code. Give the deploy user the right with" >&2
            echo "      scripts/install-bridge.sh --with-sudoers, or restart it on the VPS." >&2
        fi
    fi
fi

# --- 5. restart ---------------------------------------------------------

if (( DRY_RUN )); then
    say "dry run — nothing was changed"
    exit 0
fi

if (( RESTART )); then
    say "restarting theisle.service (players will be disconnected)"
    # -n: fail instead of hanging on a password prompt (install.sh grants this).
    ssh "$DEPLOY_HOST" "sudo -n systemctl restart theisle.service" \
        || die "could not restart theisle.service — does $DEPLOY_HOST have the sudoers rule from install.sh?"
    sleep 5
    ssh "$DEPLOY_HOST" "systemctl is-active theisle.service"
else
    say "not restarting — changes apply on the next restart"
fi

say "done. verify with: ./scripts/logs.sh ue4ss"
