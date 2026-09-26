#!/usr/bin/env bash
# install.sh — provision a FRESH VPS. Intended to run once, as root.
#
# It does NOT deploy config or mods — run ./scripts/deploy.sh from your machine
# afterwards. Read docs/architecture.md and docs/server-paths.md first.
#
#   sudo ./scripts/install.sh
#   sudo ./scripts/install.sh --resume     finish an install that stopped part-way
#
# Refuses to run if the server directory already exists, so it can never
# clobber an installed server or its Saved/ data — unless --resume is given.
# Every step after the check is safe to repeat: SteamCMD "validate" only
# re-checks files, UE4SS is reinstalled (install-ue4ss.sh), units/sudoers are rewritten.

set -euo pipefail

SERVICE_USER="${SERVICE_USER:-isle}"
HOME_DIR="/home/$SERVICE_USER"
GAME_ROOT="$HOME_DIR/server"
WINEPREFIX_DIR="$HOME_DIR/prefix"
STEAM_APP_ID=412680          # The Isle DEDICATED SERVER (376210 is the game client — not installable anonymously)
STEAM_BRANCH=evrima          # without it SteamCMD installs the obsolete Legacy build
NODE_MIN_MAJOR=20

die() { echo "install.sh: $*" >&2; exit 1; }
say() { echo "==> $*"; }

RESUME=0
case "${1:-}" in
    --resume) RESUME=1 ;;
    "") ;;
    *) die "unknown option: $1 (only --resume)" ;;
esac

[[ $EUID -eq 0 ]] || die "run as root"
if [[ -d "$GAME_ROOT" ]] && (( ! RESUME )); then
    die "$GAME_ROOT already exists — refusing to reinstall (use --resume to finish a partial install)"
fi

# --- 1. packages --------------------------------------------------------

# Node comes from NodeSource, not apt: Ubuntu's nodejs is too old for the
# bridge (it needs 20+). Install it first — docs/HUONG-DAN-CAI-DAT.md, step 2.
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    die "Node $NODE_MIN_MAJOR+ is not installed. Install it system-wide first (NodeSource), then re-run."
fi
node_major="$(node --version | sed 's/^v//; s/\..*//')"
(( node_major >= NODE_MIN_MAJOR )) || die "Node $(node --version) is too old; need $NODE_MIN_MAJOR+"

say "installing packages"
dpkg --add-architecture i386
# steamcmd lives in multiverse (Ubuntu) and asks to accept the Steam licence.
# Running this script accepts it on your behalf.
if command -v add-apt-repository >/dev/null 2>&1; then
    add-apt-repository -y multiverse
fi
echo "steam steam/question select I AGREE" | debconf-set-selections
echo "steam steam/license note ''"         | debconf-set-selections
apt-get update
# WineHQ (docs/HUONG-DAN-WINE.md section 7) replaces Ubuntu's wine packages and
# conflicts with them; keep whichever Wine is already there.
WINE_PKGS=(wine wine64 wine32:i386)
for pkg in winehq-stable winehq-staging winehq-devel; do
    if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed'; then
        say "$pkg is installed; not installing Ubuntu's wine packages"
        WINE_PKGS=()
        break
    fi
done
apt-get install -y --no-install-recommends \
    "${WINE_PKGS[@]}" winbind xvfb \
    steamcmd \
    rsync curl unzip ca-certificates gettext-base lua5.4

# --- 2. service user ----------------------------------------------------

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    say "creating user $SERVICE_USER"
    useradd -m -s /bin/bash "$SERVICE_USER"
fi

# --- 3. wine prefix -----------------------------------------------------

say "creating wine prefix at $WINEPREFIX_DIR"
sudo -u "$SERVICE_USER" env \
    WINEPREFIX="$WINEPREFIX_DIR" WINEARCH=win64 WINEDEBUG=-all \
    wineboot --init
sudo -u "$SERVICE_USER" env WINEPREFIX="$WINEPREFIX_DIR" wineserver -w

# --- 4. game server -----------------------------------------------------

# Evrima ships a native Linux server too, and SteamCMD on Linux would fetch
# that. UE4SS only works with the Windows build (under Wine), so force it.
say "downloading the dedicated server (app $STEAM_APP_ID, branch $STEAM_BRANCH, Windows build)"
STEAMCMD="$(command -v steamcmd || echo /usr/games/steamcmd)"
SERVER_EXE="$GAME_ROOT/TheIsle/Binaries/Win64/TheIsleServer-Win64-Shipping.exe"
# A fresh SteamCMD often fails its first app_update with "Missing
# configuration" while it is still fetching its own config; a retry works.
for attempt in 1 2 3; do
    if sudo -u "$SERVICE_USER" "$STEAMCMD" \
        +@sSteamCmdForcePlatformType windows \
        +force_install_dir "$GAME_ROOT" \
        +login anonymous \
        +app_update "$STEAM_APP_ID" -beta "$STEAM_BRANCH" validate \
        +quit && [[ -f "$SERVER_EXE" ]]; then
        break
    fi
    (( attempt < 3 )) || die "SteamCMD failed 3 times — see the output above"
    say "SteamCMD did not finish (attempt $attempt/3) — retrying in 10s"
    sleep 10
done
[[ -f "$SERVER_EXE" ]] || die "the Windows server binary is missing after SteamCMD — check the output above"

# --- 5. UE4SS ----------------------------------------------------------

BIN_DIR="$GAME_ROOT/TheIsle/Binaries/Win64"
# Latest experimental build, unpacked flat (the stable v3.0.1 cannot find
# Evrima's engine). Set UE4SS_URL to pin a specific zip. See install-ue4ss.sh.
bash "$(dirname "$0")/install-ue4ss.sh" --bin-dir "$BIN_DIR" --user "$SERVICE_USER" \
    ${UE4SS_URL:+--url "$UE4SS_URL"}
# Mods/shared/ comes from UE4SS (Types.lua, UEHelpers/). Ours goes in shared/isle.
[[ -f "$BIN_DIR/Mods/shared/UEHelpers/UEHelpers.lua" ]] || \
    echo "install.sh: warning — UE4SS shared/UEHelpers not found" >&2

mkdir -p "$BIN_DIR/Mods/shared/isle"
chown -R "$SERVICE_USER:$SERVICE_USER" "$HOME_DIR"

# --- 6. systemd ---------------------------------------------------------

say "installing theisle.service"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" "$HOME_DIR/bin" "$HOME_DIR/backups"
install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 \
    "$(dirname "$0")/start.sh" "$HOME_DIR/bin/start.sh"

cat > /etc/systemd/system/theisle.service <<UNIT
[Unit]
Description=The Isle Evrima dedicated server (Wine)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$BIN_DIR
Environment=WINEPREFIX=$WINEPREFIX_DIR
Environment=GAME_ROOT=$GAME_ROOT
Environment=WINEDEBUG=-all
# Put the admin panel's Game.ini settings back before every start: the game
# saves its in-memory config over Game.ini (e.g. after an RCON setting change),
# which can undo a panel save. "-": never blocks the start (bridge not deployed yet).
ExecStartPre=-/usr/bin/node $HOME_DIR/bridge/dist/cli-apply-settings.js --in-place $GAME_ROOT/TheIsle/Saved/Config/WindowsServer/Game.ini $HOME_DIR/bridge/data/game-settings.json
ExecStart=$HOME_DIR/bin/start.sh
Restart=on-failure
RestartSec=15
TimeoutStopSec=60
KillSignal=SIGINT
# The game's work sits on ONE thread (GameThread): it goes first whenever
# anything else on the box wants that core (bridge/portal run at Nice=10).
Nice=-5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable theisle.service

# --- 6b. bridge service -------------------------------------------------

say "installing theisle-bridge.service"
BRIDGE_DIR="$HOME_DIR/bridge"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" "$BRIDGE_DIR"
# Runtime data directories. Lua cannot mkdir, so these must exist before the
# mods first try to write, and deploy.sh deliberately never touches them.
# Every level is listed: `install -d -o` only chowns the LAST component, so
# "Mods/DinoGarage/Saved" alone would leave Mods/DinoGarage owned by root —
# and deploy.sh (running as $SERVICE_USER) could then not create Scripts/ in it.
# On --resume this also repairs the ownership of those directories.
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" \
    "$BIN_DIR/Mods" \
    "$BIN_DIR/Mods/StatsLogger" \
    "$BIN_DIR/Mods/StatsLogger/Saved" \
    "$BIN_DIR/Mods/DinoGarage" \
    "$BIN_DIR/Mods/DinoGarage/Saved" \
    "$BIN_DIR/Mods/DinoGarage/Saved/stored" \
    "$BIN_DIR/Mods/DinoGarage/Saved/deleted" \
    "$BIN_DIR/Mods/PlayerCommands" \
    "$BIN_DIR/Mods/PlayerCommands/Saved"

cat > /etc/systemd/system/theisle-bridge.service <<UNIT
[Unit]
Description=The Isle admin bridge (tails StatsLogger, serves the panel)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$BRIDGE_DIR
EnvironmentFile=$BRIDGE_DIR/.env
ExecStart=/usr/bin/node $BRIDGE_DIR/dist/index.js
Restart=on-failure
RestartSec=5
# Below the game (Nice=-5): never takes the GameThread's core.
Nice=10

[Install]
WantedBy=multi-user.target
UNIT

# The unit needs its env file before it can start; deploy.sh ships the code.
touch "$BRIDGE_DIR/.env"
chown "$SERVICE_USER:$SERVICE_USER" "$BRIDGE_DIR/.env"
systemctl daemon-reload
systemctl enable theisle-bridge.service

# --- 6c. service rights -------------------------------------------------
# deploy.sh (over ssh) and the bridge (the panel's Server tab) both run as
# $SERVICE_USER. Allow exactly these commands without a password, nothing else:
# start/stop/restart the game, restart the bridge.

say "allowing $SERVICE_USER to start/stop/restart theisle and restart theisle-bridge (sudoers)"
SYSTEMCTL="$(command -v systemctl)"
SUDOERS_TMP="$(mktemp)"
printf '# Written by install.sh: deploy.sh and the admin panel manage exactly these units.\n%s ALL=(root) NOPASSWD: %s start theisle.service, %s stop theisle.service, %s restart theisle.service, %s restart theisle-bridge.service\n' \
    "$SERVICE_USER" "$SYSTEMCTL" "$SYSTEMCTL" "$SYSTEMCTL" "$SYSTEMCTL" > "$SUDOERS_TMP"
visudo -cf "$SUDOERS_TMP" >/dev/null || die "generated sudoers rule failed visudo"
install -o root -g root -m 0440 "$SUDOERS_TMP" /etc/sudoers.d/theisle-deploy
rm -f "$SUDOERS_TMP"

# --- 7. firewall --------------------------------------------------------

if command -v ufw >/dev/null 2>&1; then
    say "opening game ports (RCON is intentionally left closed)"
    ufw allow 7777:7779/udp     # game + query
    ufw allow 10000/tcp         # join queue (bQueueEnabled)
    echo "    RCON: open it only to your admin IP, e.g."
    echo "      ufw allow from <your.ip> to any port 8888 proto tcp"
    echo "    Panel: bound to 127.0.0.1 — put it behind a reverse proxy with"
    echo "      auth. Do NOT open port 8080 to the internet."
fi

cat <<'NEXT'

==> install complete. Next (docs/HUONG-DAN-CAI-DAT.md, from step 5):
    1. from your machine: ./scripts/deploy.sh --dry-run
    2. then:              ./scripts/deploy.sh      (renders config, ships mods + bridge, starts the server)
    3. on the VPS:        sudo systemctl status theisle theisle-bridge
NEXT
