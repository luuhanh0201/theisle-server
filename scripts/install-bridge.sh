#!/usr/bin/env bash
# install-bridge.sh — add the admin bridge to a server that is ALREADY running.
#
# install.sh provisions a fresh VPS and refuses to touch an existing server.
# This does only the bridge's share of it, on the VPS, as root:
#
#   sudo ./scripts/install-bridge.sh --game-root /home/isle/server --dry-run
#   sudo ./scripts/install-bridge.sh --game-root /home/isle/server
#
# Options:
#   --game-root DIR     the dedicated server install (contains TheIsle/). Required.
#   --user NAME         account the bridge runs as. Default: the owner of
#                       TheIsle/Binaries/Win64, i.e. whoever runs the game, so
#                       both processes can read and write the same files.
#   --bridge-dir DIR    where deploy.sh puts the bridge. Default: ~USER/bridge
#   --deploy-user NAME  the ssh user in DEPLOY_HOST. Default: --user
#   --with-sudoers      let --deploy-user restart the two services without a
#                       password (deploy.sh needs that). Off by default.
#   --dry-run           print what would change; change nothing (no root needed)
#
# What it does NOT do, on purpose:
#   * install or upgrade Node — it checks for Node >= 20 and stops if missing
#   * touch the game, its config, or anything that already exists under Saved/
#     (missing mod data directories are created; existing ones are only checked)
#   * start the bridge before deploy.sh has shipped its code
#
# Afterwards, from your machine: ./scripts/deploy.sh --bridge-only

set -euo pipefail

UNIT_NAME="theisle-bridge.service"
UNIT_PATH="/etc/systemd/system/$UNIT_NAME"
SUDOERS_PATH="/etc/sudoers.d/theisle-deploy"
NODE_MIN_MAJOR=20

GAME_ROOT=""
SERVICE_USER=""
BRIDGE_DIR=""
DEPLOY_USER=""
WITH_SUDOERS=0
DRY_RUN=0

die()  { echo "install-bridge.sh: $*" >&2; exit 1; }
say()  { echo "==> $*"; }
warn() { echo "    ! $*" >&2; }
ok()   { echo "    ok  $*"; }

# Every change goes through here, so --dry-run is honest.
run() {
    if (( DRY_RUN )); then
        printf '    would run:'; printf ' %q' "$@"; printf '\n'
    else
        "$@"
    fi
}

while (( $# )); do
    case "$1" in
        --game-root)    GAME_ROOT="${2:?}"; shift ;;
        --user)         SERVICE_USER="${2:?}"; shift ;;
        --bridge-dir)   BRIDGE_DIR="${2:?}"; shift ;;
        --deploy-user)  DEPLOY_USER="${2:?}"; shift ;;
        --with-sudoers) WITH_SUDOERS=1 ;;
        --dry-run)      DRY_RUN=1 ;;
        -h|--help)      sed -n '2,29p' "$0"; exit 0 ;;
        *) die "unknown option: $1 (see --help)" ;;
    esac
    shift
done

(( DRY_RUN )) || [[ $EUID -eq 0 ]] || die "run as root (or with --dry-run to preview)"
[[ -n "$GAME_ROOT" ]] || die "--game-root is required (the directory that contains TheIsle/)"
GAME_ROOT="$(cd "$GAME_ROOT" 2>/dev/null && pwd)" || die "--game-root does not exist"

BIN_DIR="$GAME_ROOT/TheIsle/Binaries/Win64"
MODS_DIR="$BIN_DIR/ue4ss/Mods"

# Run a command as the service user.
as_user() {
    if [[ "$(id -un)" == "$SERVICE_USER" ]]; then "$@"
    else runuser -u "$SERVICE_USER" -- "$@"
    fi
}

# Same, but with a clean environment and the stock PATH — what a
# non-interactive `ssh host "npm ci"` (deploy.sh) actually gets. Without this
# the lookup inherits the caller's PATH (root's, or an nvm shell) and can say
# "found" for a node that deploy.sh will never see.
DEFAULT_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
as_user_clean() {
    as_user env -i HOME="$USER_HOME" USER="$SERVICE_USER" PATH="$DEFAULT_PATH" "$@"
}

(( DRY_RUN )) && say "DRY RUN — nothing will be changed"

# --- 1. the game install -------------------------------------------------

say "checking the game install at $GAME_ROOT"
[[ -d "$BIN_DIR" ]] || die "$BIN_DIR not found — is --game-root the SteamCMD install dir?"
ok "$BIN_DIR"
if [[ -f "$BIN_DIR/UE4SS.dll" && -d "$BIN_DIR/ue4ss" ]]; then
    ok "UE4SS present"
else
    warn "UE4SS not found in $BIN_DIR — the mods (and so the bridge's data) need it"
fi

# --- 2. which user ------------------------------------------------------

if [[ -z "$SERVICE_USER" ]]; then
    SERVICE_USER="$(stat -c %U "$BIN_DIR")"
    say "bridge user: $SERVICE_USER (owner of $BIN_DIR)"
else
    say "bridge user: $SERVICE_USER"
fi
id "$SERVICE_USER" >/dev/null 2>&1 || die "user $SERVICE_USER does not exist"
[[ "$SERVICE_USER" != "root" ]] || die "the game files are owned by root; refusing to run a web service as root. Pass --user."
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"
USER_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
BRIDGE_DIR="${BRIDGE_DIR:-$USER_HOME/bridge}"
DEPLOY_USER="${DEPLOY_USER:-$SERVICE_USER}"

# --- 3. node ------------------------------------------------------------

say "checking Node >= $NODE_MIN_MAJOR for $SERVICE_USER"
# Looked up the way deploy.sh's `ssh host "npm ci"` will: stock PATH, no
# login shell, so a per-user nvm install does not count.
NODE_BIN="$(as_user_clean sh -c 'command -v node' 2>/dev/null || true)"
NPM_BIN="$(as_user_clean sh -c 'command -v npm' 2>/dev/null || true)"
if [[ -z "$NODE_BIN" || -z "$NPM_BIN" ]]; then
    die "node/npm not found on the stock PATH ($DEFAULT_PATH) for $SERVICE_USER.
       deploy.sh runs 'npm ci' over ssh with that PATH, so an nvm install in a
       home directory is not enough. Install Node $NODE_MIN_MAJOR+ system-wide, e.g.
       https://github.com/nodesource/distributions  (then re-run this script)"
fi
NODE_VERSION="$(as_user_clean "$NODE_BIN" --version)"
NODE_MAJOR="${NODE_VERSION#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
(( NODE_MAJOR >= NODE_MIN_MAJOR )) || die "Node $NODE_VERSION at $NODE_BIN is too old; need $NODE_MIN_MAJOR+"
ok "node $NODE_VERSION at $NODE_BIN"

# --- 4. mod data directories --------------------------------------------
# Lua cannot mkdir. Create what is missing; never chown or modify what exists.

say "mod data directories"
for dir in \
    "$MODS_DIR/StatsLogger/Saved" \
    "$MODS_DIR/DinoGarage/Saved" \
    "$MODS_DIR/DinoGarage/Saved/stored"
do
    if [[ -d "$dir" ]]; then
        if as_user test -w "$dir"; then ok "exists, writable: $dir"
        else warn "exists but NOT writable by $SERVICE_USER: $dir — fix its owner yourself; not changing existing data"
        fi
    else
        run install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0755 "$dir"
        (( DRY_RUN )) || ok "created $dir"
    fi
done

# --- 5. bridge directory ------------------------------------------------

say "bridge directory $BRIDGE_DIR"
if [[ -d "$BRIDGE_DIR" ]]; then
    ok "exists"
else
    run install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0750 "$BRIDGE_DIR"
fi
# deploy.sh writes the real .env; the unit needs the file to exist to start.
if [[ -e "$BRIDGE_DIR/.env" ]]; then
    ok ".env exists (deploy.sh keeps it up to date)"
else
    run install -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0600 /dev/null "$BRIDGE_DIR/.env"
fi

# --- 6. systemd unit ----------------------------------------------------

say "systemd unit $UNIT_NAME"
UNIT_CONTENT="[Unit]
Description=The Isle admin bridge (tails StatsLogger, serves the panel)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$BRIDGE_DIR
EnvironmentFile=$BRIDGE_DIR/.env
ExecStart=$NODE_BIN $BRIDGE_DIR/dist/index.js
Restart=on-failure
RestartSec=5
# The bridge only reads the event files and writes into DinoGarage/Saved.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
"
if [[ -f "$UNIT_PATH" ]] && cmp -s "$UNIT_PATH" <(printf '%s' "$UNIT_CONTENT"); then
    ok "already up to date"
else
    if [[ -f "$UNIT_PATH" ]]; then
        warn "replacing an existing $UNIT_PATH (backed up), diff:"
        diff -u "$UNIT_PATH" <(printf '%s' "$UNIT_CONTENT") | sed 's/^/      /' || true
        run cp -a "$UNIT_PATH" "$UNIT_PATH.bak.$(date -u +%Y%m%dT%H%M%SZ)"
    fi
    if (( DRY_RUN )); then
        echo "    would write $UNIT_PATH:"; printf '%s' "$UNIT_CONTENT" | sed 's/^/      /'
    else
        printf '%s' "$UNIT_CONTENT" > "$UNIT_PATH"
        chmod 0644 "$UNIT_PATH"
        ok "written"
    fi
    run systemctl daemon-reload
fi
run systemctl enable "$UNIT_NAME"

# --- 7. can deploy.sh restart things? ----------------------------------

say "restart permissions for deploy user $DEPLOY_USER"
id "$DEPLOY_USER" >/dev/null 2>&1 || die "deploy user $DEPLOY_USER does not exist (pass --deploy-user)"
SYSTEMCTL="$(command -v systemctl)"

if systemctl cat theisle.service >/dev/null 2>&1; then
    ok "game unit theisle.service exists (deploy.sh restarts it by that name)"
else
    warn "no theisle.service: your game runs under another unit or none. deploy.sh restarts"
    warn "'theisle.service' after --mods-only / a full deploy — use --no-restart and restart"
    warn "the game yourself, or name your unit theisle.service."
fi

CAN_RESTART=0
if (( ! DRY_RUN )) || [[ $EUID -eq 0 ]]; then
    if sudo -n -l -U "$DEPLOY_USER" 2>/dev/null | grep -q "$UNIT_NAME\|(ALL.*) NOPASSWD: ALL"; then
        CAN_RESTART=1
        ok "$DEPLOY_USER can already restart $UNIT_NAME without a password"
    fi
else
    warn "(dry run without root: cannot check sudo rights)"
fi

if (( ! CAN_RESTART )); then
    SUDOERS_LINE="$DEPLOY_USER ALL=(root) NOPASSWD: $SYSTEMCTL restart $UNIT_NAME, $SYSTEMCTL restart theisle.service"
    if (( WITH_SUDOERS && DRY_RUN )); then
        echo "    would install $SUDOERS_PATH (0440, checked with visudo -c):"
        echo "      $SUDOERS_LINE"
    elif (( WITH_SUDOERS )); then
        TMP_SUDO="$(mktemp)"
        printf '# Written by install-bridge.sh: lets deploy.sh restart exactly these units.\n%s\n' \
            "$SUDOERS_LINE" > "$TMP_SUDO"
        visudo -cf "$TMP_SUDO" >/dev/null || { rm -f "$TMP_SUDO"; die "generated sudoers rule failed visudo — not installed"; }
        install -o root -g root -m 0440 "$TMP_SUDO" "$SUDOERS_PATH"
        rm -f "$TMP_SUDO"
        ok "installed $SUDOERS_PATH"
    else
        warn "$DEPLOY_USER cannot restart $UNIT_NAME without a password, so deploy.sh"
        warn "cannot restart the bridge after shipping new code. Either re-run with"
        warn "--with-sudoers, or add this line yourself (visudo -f $SUDOERS_PATH):"
        warn "  $SUDOERS_LINE"
    fi
fi

# --- 8. start only when there is something to run -----------------------

say "service state"
if [[ -f "$BRIDGE_DIR/dist/index.js" && -s "$BRIDGE_DIR/.env" ]]; then
    run systemctl restart "$UNIT_NAME"
    (( DRY_RUN )) || { sleep 2; systemctl is-active --quiet "$UNIT_NAME" && ok "running" \
        || warn "did not stay up — journalctl -u $UNIT_NAME -n 50"; }
else
    ok "not started yet: the code and .env arrive with deploy.sh"
fi

cat <<NEXT

==> done$( (( DRY_RUN )) && echo " (dry run — nothing changed)" ). Next, from your machine:
    1. in .env:  DEPLOY_HOST=$DEPLOY_USER@<this host>   GAME_ROOT=$GAME_ROOT
                 EVENTS_PATH=$MODS_DIR/StatsLogger/Saved/events.ndjson
                 GARAGE_ROOT=$MODS_DIR/DinoGarage/Saved
    2. ./scripts/deploy.sh --bridge-only --dry-run
    3. ./scripts/deploy.sh --bridge-only        # ships the code, starts the bridge
    4. panel:  ssh -L 8181:127.0.0.1:<HTTP_PORT> $DEPLOY_USER@<this host>
               then open http://127.0.0.1:8181
NEXT
