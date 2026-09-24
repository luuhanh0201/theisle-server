#!/usr/bin/env bash
# deploy.sh — render config templates, sync to the VPS, restart the server.
#
#   ./scripts/deploy.sh --dry-run     render + check + show the diff, change nothing
#   ./scripts/deploy.sh               full deploy (RESTARTS THE SERVER)
#   ./scripts/deploy.sh --no-restart  sync only; applies on the next restart
#   ./scripts/deploy.sh --config-only
#   ./scripts/deploy.sh --mods-only
#   ./scripts/deploy.sh --bridge-only   only the Node service (no game restart)
#   ./scripts/deploy.sh --portal-only   only the player portal (no game restart)
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
DO_PORTAL=1

for arg in "$@"; do
    case "$arg" in
        --dry-run)     DRY_RUN=1 ;;
        --no-restart)  RESTART=0 ;;
        --config-only) DO_MODS=0; DO_BRIDGE=0; DO_PORTAL=0 ;;
        --mods-only)   DO_CONFIG=0; DO_BRIDGE=0; DO_PORTAL=0 ;;
        --bridge-only) DO_CONFIG=0; DO_MODS=0; DO_PORTAL=0 ;;
        --portal-only) DO_CONFIG=0; DO_MODS=0; DO_BRIDGE=0 ;;
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

BRIDGE_DIR="/home/isle/bridge"
# The player portal (portal/): its own directory and system user, see
# scripts/install-portal.sh. Skipped until PORTAL_TOKEN is set in .env.
PORTAL_DIR="/opt/isle-portal"
if [[ -z "${PORTAL_TOKEN:-}" ]]; then DO_PORTAL=0; fi
BRIDGE_DATA_DIR="$BRIDGE_DIR/data"

# --- 2. build the bridge ------------------------------------------------
# Needed for the bridge itself and for the config step: panel-managed Game.ini
# keys are applied by the bridge's own code (dist/cli-apply-settings.js), so
# the panel and a deploy can never render Game.ini differently.

if (( DO_PORTAL )); then
    [[ ${#PORTAL_TOKEN} -ge 16 ]] || die "PORTAL_TOKEN must be at least 16 characters (openssl rand -hex 32)"
    [[ ${#PORTAL_SESSION_SECRET} -ge 32 ]] || die "PORTAL_SESSION_SECRET must be at least 32 characters (openssl rand -hex 32)"
    say "building portal"
    ( cd portal && npm ci --silent && npm test )
fi

if (( DO_CONFIG || DO_BRIDGE )); then
    say "building bridge"
    # npm test = tsc + the bridge tests; a failing test stops the deploy.
    ( cd bridge && npm ci --silent && npm test )
fi

# --- 2b. render templates -----------------------------------------------

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

if (( DO_CONFIG )); then
    # The keys the admin panel owns (Server tab) live on the VPS, not in the
    # repo. Fetch them and put them into the rendered Game.ini — otherwise
    # every deploy would silently undo what admins set in the panel.
    # If the VPS cannot be asked, STOP: rendering without them loses them.
    say "fetching panel-managed settings from the VPS"
    ssh "$DEPLOY_HOST" "f='$BRIDGE_DATA_DIR/game-settings.json'; if [ -f \"\$f\" ]; then cat \"\$f\"; fi" \
        > "$STAGE/panel-settings.json" \
        || die "could not read panel settings from $DEPLOY_HOST — refusing to overwrite Game.ini without them"
    node bridge/dist/cli-apply-settings.js "$STAGE/config/Game.ini" "$STAGE/panel-settings.json" \
        > "$STAGE/config/Game.ini.panel" || die "applying panel settings to Game.ini failed"
    mv "$STAGE/config/Game.ini.panel" "$STAGE/config/Game.ini"
    [[ -s "$STAGE/panel-settings.json" ]] && say "  applied $(tr -cd ',' < "$STAGE/panel-settings.json" | wc -c | awk '{print $1+1}') panel setting(s)" \
        || say "  no panel settings yet — template defaults"
fi

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
    # The launcher is part of the game side: without this, a fix to start.sh
    # would never leave the repo (install.sh only copies it once).
    say "start.sh -> /home/isle/bin/start.sh"
    "${RSYNC[@]}" --chmod=F755 scripts/start.sh "$DEPLOY_HOST:/home/isle/bin/start.sh"

    say "ue4ss settings + mods.txt -> $BIN_DIR"
    "${RSYNC[@]}" ue4ss/UE4SS-settings.ini "$DEPLOY_HOST:$BIN_DIR/"
    "${RSYNC[@]}" ue4ss/mods.txt           "$DEPLOY_HOST:$BIN_DIR/Mods/"

    # UE4SS owns Mods/shared/ — it ships Types.lua and UEHelpers/ there.
    # Our helpers go in a subfolder of their own, and this sync must NEVER
    # use --delete or it would wipe UEHelpers out from under BPModLoaderMod.
    say "shared helpers -> $BIN_DIR/Mods/shared/isle"
    rsync -az --itemize-changes $( ((DRY_RUN)) && echo --dry-run ) --exclude 'README.md' \
        mods/_shared/ "$DEPLOY_HOST:$BIN_DIR/Mods/shared/isle/"

    for mod in mods/*/; do
        name="$(basename "$mod")"
        [[ "$name" == _* ]] && continue
        say "mod $name -> $BIN_DIR/Mods/$name"
        # Saved/ is the mod's RUNTIME data: stored dinos, the event stream.
        # It does not exist in this repo, so --delete would wipe it. Excluding
        # it here is the difference between a deploy and a data loss.
        "${RSYNC[@]}" --exclude 'Saved/' \
            "$mod" "$DEPLOY_HOST:$BIN_DIR/Mods/$name/"
    done
fi

# --- 4b. bridge ---------------------------------------------------------
# The bridge is a plain Node service. We build locally and ship dist/ plus the
# production deps, so the VPS needs node but no toolchain.

if (( DO_BRIDGE )); then
    say "bridge -> $BRIDGE_DIR"
    "${RSYNC[@]}" --exclude 'node_modules' \
        bridge/dist/ "$DEPLOY_HOST:$BRIDGE_DIR/dist/"
    "${RSYNC[@]}" bridge/public/ "$DEPLOY_HOST:$BRIDGE_DIR/public/"
    "${RSYNC[@]}" bridge/package.json bridge/package-lock.json \
        "$DEPLOY_HOST:$BRIDGE_DIR/"

    # systemd reads this via EnvironmentFile. Only the keys the bridge needs go
    # in — not the whole .env (no EOS secret, no server password). It does hold
    # the RCON password (the bridge speaks RCON on 127.0.0.1), so it is 0600.
    cat > "$STAGE/bridge.env" <<ENV
EVENTS_PATH=$EVENTS_PATH
GARAGE_ROOT=$GARAGE_ROOT
ADMIN_TOKEN=${ADMIN_TOKEN:-}
HTTP_HOST=$HTTP_HOST
HTTP_PORT=$HTTP_PORT
POLL_MS=${POLL_MS:-1000}
FEED_SIZE=${FEED_SIZE:-500}
OFFLINE_AFTER_SECONDS=${OFFLINE_AFTER_SECONDS:-30}
DATA_DIR=$BRIDGE_DATA_DIR
GAME_UNIT=theisle.service
GAME_CONFIG_DIR=$CONFIG_DIR
RCON_HOST=127.0.0.1
RCON_PORT=$RCON_PORT
RCON_PASSWORD=$RCON_PASSWORD
PORTAL_TOKEN=${PORTAL_TOKEN:-}
ENV
    "${RSYNC[@]}" --no-perms --chmod=F600 --omit-dir-times \
        "$STAGE/bridge.env" "$DEPLOY_HOST:$BRIDGE_DIR/.env"

    if (( ! DRY_RUN )); then
        ssh "$DEPLOY_HOST" "cd '$BRIDGE_DIR' && chmod 600 .env && npm ci --omit=dev --silent"
        # Restarting the bridge does not touch the game server or disconnect
        # anyone, but it must not fail silently: a bridge that was not
        # restarted keeps serving the OLD code. -n: never hang on a password.
        if ! ssh "$DEPLOY_HOST" "sudo -n systemctl restart theisle-bridge.service"; then
            echo "    ! could not restart theisle-bridge.service — the bridge is still" >&2
            echo "      running the previous code. Give the deploy user the right with" >&2
            echo "      scripts/install-bridge.sh --with-sudoers, or restart it on the VPS." >&2
        fi
    fi
fi

if (( DO_PORTAL )); then
    say "portal -> $PORTAL_DIR"
    "${RSYNC[@]}" --exclude 'node_modules' portal/dist/ "$DEPLOY_HOST:$PORTAL_DIR/dist/"
    # The map (image + places) is the bridge's copy (bridge/src/cli-fetch-map.ts);
    # map/ is left out of the --delete sync above it and shipped on its own.
    "${RSYNC[@]}" --exclude 'map/' portal/public/ "$DEPLOY_HOST:$PORTAL_DIR/public/"
    "${RSYNC[@]}" bridge/public/map/ "$DEPLOY_HOST:$PORTAL_DIR/public/map/"
    "${RSYNC[@]}" portal/package.json portal/package-lock.json "$DEPLOY_HOST:$PORTAL_DIR/"

    # Only what the portal needs. Never ADMIN_TOKEN, RCON or EOS: the portal
    # faces the internet and talks to the bridge's read-only /player-api only.
    if [[ -n "${PORTAL_DOMAIN:-}" ]]; then PORTAL_BASE_URL="https://$PORTAL_DOMAIN"; else PORTAL_BASE_URL="http://127.0.0.1:${PORTAL_PORT:-8090}"; fi
    cat > "$STAGE/portal.env" <<ENV
PORTAL_BASE_URL=$PORTAL_BASE_URL
PORTAL_HOST=127.0.0.1
PORTAL_PORT=${PORTAL_PORT:-8090}
BRIDGE_URL=http://127.0.0.1:$HTTP_PORT
PORTAL_TOKEN=$PORTAL_TOKEN
PORTAL_SESSION_SECRET=$PORTAL_SESSION_SECRET
PORTAL_TRUST_PROXY=1
ENV
    "${RSYNC[@]}" --no-perms --chmod=F640 --omit-dir-times "$STAGE/portal.env" "$DEPLOY_HOST:$PORTAL_DIR/.env"

    if (( ! DRY_RUN )); then
        # 0640, group portal: the service user reads it, nobody else.
        ssh "$DEPLOY_HOST" "cd '$PORTAL_DIR' && chgrp portal .env && chmod 640 .env && npm ci --omit=dev --silent"
        if ! ssh "$DEPLOY_HOST" "sudo -n systemctl restart theisle-portal.service"; then
            echo "    ! could not restart theisle-portal.service — run scripts/install-portal.sh on the VPS first" >&2
        fi
    fi
fi

# --- 5. restart ---------------------------------------------------------

if (( DRY_RUN )); then
    say "dry run — nothing was changed"
    exit 0
fi

if (( ! DO_CONFIG && ! DO_MODS )); then
    # --bridge-only / --portal-only: nothing the game reads changed.
    say "game server not touched"
elif (( RESTART )); then
    say "restarting theisle.service (players will be disconnected)"
    # -n: fail instead of hanging on a password prompt (install.sh grants this).
    ssh "$DEPLOY_HOST" "sudo -n systemctl restart theisle.service" \
        || die "could not restart theisle.service — does $DEPLOY_HOST have the sudoers rule from install.sh?"
    # "activating" after a restart usually means the process exited and systemd
    # is about to retry (Restart=on-failure) — a crash loop, not a slow start.
    # Watch a little so a broken launch is reported here, not discovered later.
    sleep 20
    # Parse Key=Value lines: `systemctl show --value` prints values in systemd's
    # own property order, not the order of the -p flags.
    active="" sub="" restarts=""
    while IFS='=' read -r key value; do
        case "$key" in
            ActiveState) active="$value" ;;
            SubState)    sub="$value" ;;
            NRestarts)   restarts="$value" ;;
        esac
    done < <(ssh "$DEPLOY_HOST" "systemctl show theisle.service -p ActiveState -p SubState -p NRestarts")
    if [[ "$active" == "active" && "$sub" == "running" && "${restarts:-0}" == "0" ]]; then
        say "theisle.service is running"
    else
        echo "    ! theisle.service is NOT running steadily: ActiveState=$active SubState=$sub restarts=$restarts" >&2
        echo "      The game process keeps exiting. As root on the VPS:" >&2
        echo "        journalctl -u theisle.service -n 50 --no-pager" >&2
    fi
else
    say "not restarting — changes apply on the next restart"
fi

say "done. verify with: ./scripts/logs.sh ue4ss"
