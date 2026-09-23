#!/usr/bin/env bash
# install.sh — provision a FRESH VPS. Intended to run once, as root.
#
# It does NOT deploy config or mods — run ./scripts/deploy.sh from your machine
# afterwards. Read docs/architecture.md and docs/server-paths.md first.
#
#   sudo ./scripts/install.sh
#
# Refuses to run if the server directory already exists, so it can never
# clobber an installed server or its Saved/ data.

set -euo pipefail

SERVICE_USER="${SERVICE_USER:-isle}"
HOME_DIR="/home/$SERVICE_USER"
GAME_ROOT="$HOME_DIR/server"
WINEPREFIX_DIR="$HOME_DIR/prefix"
STEAM_APP_ID=412680          # The Isle dedicated server
STEAM_BRANCH=evrima          # without it SteamCMD installs the obsolete Legacy build
NODE_MIN_MAJOR=20
UE4SS_VERSION="${UE4SS_VERSION:-v3.0.1}"

die() { echo "install.sh: $*" >&2; exit 1; }
say() { echo "==> $*"; }

[[ $EUID -eq 0 ]] || die "run as root"
[[ -d "$GAME_ROOT" ]] && die "$GAME_ROOT already exists — refusing to reinstall"

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
apt-get install -y --no-install-recommends \
    wine wine64 wine32:i386 winbind xvfb \
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
sudo -u "$SERVICE_USER" "$STEAMCMD" \
    +@sSteamCmdForcePlatformType windows \
    +force_install_dir "$GAME_ROOT" \
    +login anonymous \
    +app_update "$STEAM_APP_ID" -beta "$STEAM_BRANCH" validate \
    +quit
[[ -f "$GAME_ROOT/TheIsle/Binaries/Win64/TheIsleServer-Win64-Shipping.exe" ]] || \
    die "the Windows server binary is missing after SteamCMD — check the output above"

# --- 5. UE4SS ----------------------------------------------------------

BIN_DIR="$GAME_ROOT/TheIsle/Binaries/Win64"
say "installing UE4SS $UE4SS_VERSION into $BIN_DIR"
TMP="$(mktemp -d)"
curl -fsSL -o "$TMP/ue4ss.zip" \
    "https://github.com/UE4SS-RE/RE-UE4SS/releases/download/${UE4SS_VERSION}/UE4SS_${UE4SS_VERSION}.zip"
sudo -u "$SERVICE_USER" unzip -q "$TMP/ue4ss.zip" -d "$BIN_DIR"
rm -rf "$TMP"
# 3.0+ installs a proxy (dwmapi.dll) plus the real UE4SS.dll. Both must be there.
for dll in dwmapi.dll UE4SS.dll; do
    [[ -f "$BIN_DIR/$dll" ]] || die "UE4SS did not install ($dll missing)"
done
# Mods/shared/ comes from UE4SS (Types.lua, UEHelpers/). Ours goes in shared/isle.
[[ -f "$BIN_DIR/ue4ss/Mods/shared/UEHelpers/UEHelpers.lua" ]] || \
    echo "install.sh: warning — UE4SS shared/UEHelpers not found" >&2

mkdir -p "$BIN_DIR/ue4ss/Mods/shared/isle"
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
ExecStart=$HOME_DIR/bin/start.sh
Restart=on-failure
RestartSec=15
TimeoutStopSec=60
KillSignal=SIGINT

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
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" \
    "$BIN_DIR/ue4ss/Mods/StatsLogger/Saved" \
    "$BIN_DIR/ue4ss/Mods/DinoGarage/Saved" \
    "$BIN_DIR/ue4ss/Mods/DinoGarage/Saved/stored"

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

[Install]
WantedBy=multi-user.target
UNIT

# The unit needs its env file before it can start; deploy.sh ships the code.
touch "$BRIDGE_DIR/.env"
chown "$SERVICE_USER:$SERVICE_USER" "$BRIDGE_DIR/.env"
systemctl daemon-reload
systemctl enable theisle-bridge.service

# --- 6c. deploy rights --------------------------------------------------
# deploy.sh connects as $SERVICE_USER and restarts the two services. Allow
# exactly those two commands without a password, nothing else.

say "allowing $SERVICE_USER to restart theisle and theisle-bridge (sudoers)"
SYSTEMCTL="$(command -v systemctl)"
SUDOERS_TMP="$(mktemp)"
printf '# Written by install.sh: lets deploy.sh restart exactly these units.\n%s ALL=(root) NOPASSWD: %s restart theisle.service, %s restart theisle-bridge.service\n' \
    "$SERVICE_USER" "$SYSTEMCTL" "$SYSTEMCTL" > "$SUDOERS_TMP"
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
