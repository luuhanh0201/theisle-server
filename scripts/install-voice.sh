#!/usr/bin/env bash
# install-voice.sh — the proximity voice server (LiveKit) on the VPS. As root.
#
#   sudo ./scripts/install-voice.sh --domain voice.example.com
#   sudo ./scripts/install-voice.sh --domain voice.example.com --dry-run
#
# Then, from your machine: VOICE_DOMAIN + LIVEKIT_API_KEY/SECRET in .env and
# ./scripts/deploy.sh --bridge-only && ./scripts/deploy.sh --portal-only
#
# What it does, and why:
#   * livekit-server, a pinned release checked against its SHA-256, in
#     /usr/local/bin. A system user "livekit" with no shell runs it.
#   * isle-voice.service. The API keys are NOT in its config: deploy.sh
#     writes them to /home/isle/bridge/livekit.env (0600, like the bridge's
#     .env) and systemd hands them over (LIVEKIT_KEYS).
#   * signalling on 127.0.0.1:7880 only; nginx serves it as wss://DOMAIN.
#     The domain must point STRAIGHT at this server, not through the
#     anti-DDoS proxy: the audio itself is UDP 7882 (TCP 7881 as a fallback
#     for players whose network blocks UDP), which no HTTP proxy carries.
#   * nginx: DOMAIN on port 80 until it has a certificate. The certificate
#     (Let's Encrypt) is a separate step because it means accepting Let's
#     Encrypt's terms: certbot --nginx -d DOMAIN. Browsers refuse ws:// from
#     an https page, so voice works only after that.
#   * sudoers: the deploy user may restart isle-voice (new keys), nothing else.
#   * ufw (if it is on): 7881/tcp and 7882/udp.
#
# Safe to run again: every step checks or overwrites its own files only.

set -euo pipefail

VERSION="1.13.7"
SHA256="6634aeeb2fb1366b6723708ae4320b9d5408106a4c63457c5e845ae3979c90e2"   # livekit_1.13.7_linux_amd64.tar.gz
DOMAIN=""
DEPLOY_USER="isle"
KEYS_FILE="/home/isle/bridge/livekit.env"
CONF_DIR="/etc/isle-voice"
DRY_RUN=0

die() { echo "install-voice.sh: $*" >&2; exit 1; }
say() { echo "==> $*"; }
run() { if (( DRY_RUN )); then echo "    (dry run) $*"; else "$@"; fi; }

while (( $# )); do
    case "$1" in
        --domain)      DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
        --deploy-user) DEPLOY_USER="${2:?}"; shift 2 ;;
        --dry-run)     DRY_RUN=1; shift ;;
        -h|--help)     sed -n '2,28p' "$0"; exit 0 ;;
        *) die "unknown option: $1" ;;
    esac
done

[[ $EUID -eq 0 ]] || die "run as root"
[[ -n "$DOMAIN" ]] || die "--domain is required (e.g. voice.example.com)"
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "--domain '$DOMAIN' does not look like a host name"
id "$DEPLOY_USER" >/dev/null 2>&1 || die "deploy user '$DEPLOY_USER' does not exist"
[[ "$(uname -m)" == "x86_64" ]] || die "only x86_64 is set up here"

# The address players' audio goes to: this machine's own public address.
PUBLIC_IP="$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')"
[[ "$PUBLIC_IP" =~ ^[0-9.]+$ ]] || die "could not find this server's IPv4 address"
case "$PUBLIC_IP" in
    10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) die "$PUBLIC_IP is a private address: behind NAT, set rtc.use_external_ip instead" ;;
esac

# --- 1. binary ------------------------------------------------------------------

if [[ "$(/usr/local/bin/livekit-server --version 2>/dev/null || true)" != "livekit-server version $VERSION" ]]; then
    say "livekit-server $VERSION (checked against its SHA-256)"
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    run curl -fsSL -o "$TMP/lk.tgz" "https://github.com/livekit/livekit/releases/download/v$VERSION/livekit_${VERSION}_linux_amd64.tar.gz"
    if (( ! DRY_RUN )); then
        echo "$SHA256  $TMP/lk.tgz" | sha256sum -c --quiet - || die "checksum mismatch — not installing"
        tar xzf "$TMP/lk.tgz" -C "$TMP" livekit-server
        install -o root -g root -m 0755 "$TMP/livekit-server" /usr/local/bin/livekit-server
    fi
fi

# --- 2. user, config, unit ----------------------------------------------------------

if ! id livekit >/dev/null 2>&1; then
    say "creating system user livekit"
    run useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin livekit
fi

CONF="# Written by install-voice.sh. No secrets here: the keys come from
# $KEYS_FILE (LIVEKIT_KEYS), written by deploy.sh.
port: 7880
bind_addresses: [\"127.0.0.1\"]
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: false
  node_ip: $PUBLIC_IP
room:
  # One room for the whole server; who hears whom is decided per player.
  empty_timeout: 300
  max_participants: 250
logging:
  level: info"
say "$CONF_DIR/livekit.yaml (node_ip $PUBLIC_IP)"
if (( DRY_RUN )); then echo "$CONF" | sed 's/^/    /'; else
    install -d -o root -g root -m 0755 "$CONF_DIR"
    printf '%s\n' "$CONF" > "$CONF_DIR/livekit.yaml"
fi

UNIT="[Unit]
Description=The Isle proximity voice (LiveKit)
After=network-online.target
Wants=network-online.target
# No keys yet = nothing to serve: deploy.sh writes them, then starts it.
ConditionPathExists=$KEYS_FILE

[Service]
Type=simple
User=livekit
Group=livekit
EnvironmentFile=$KEYS_FILE
ExecStart=/usr/local/bin/livekit-server --config $CONF_DIR/livekit.yaml
Restart=on-failure
RestartSec=5
LimitNOFILE=65536
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
# The audio of a whole server is light, but it shares this machine with the
# game: never let it take more than one core.
CPUQuota=100%
MemoryMax=768M

[Install]
WantedBy=multi-user.target"
say "installing isle-voice.service"
if (( DRY_RUN )); then echo "$UNIT" | sed 's/^/    /'; else
    printf '%s\n' "$UNIT" > /etc/systemd/system/isle-voice.service
    systemctl daemon-reload
    systemctl enable isle-voice.service >/dev/null
fi

SYSTEMCTL="$(command -v systemctl)"
say "sudoers: $DEPLOY_USER may start/stop/restart isle-voice"
RULE="$DEPLOY_USER ALL=(root) NOPASSWD: $SYSTEMCTL start isle-voice.service, $SYSTEMCTL stop isle-voice.service, $SYSTEMCTL restart isle-voice.service"
if (( ! DRY_RUN )); then
    TMP_RULE="$(mktemp)"
    printf '# Written by install-voice.sh\n%s\n' "$RULE" > "$TMP_RULE"
    visudo -cf "$TMP_RULE" >/dev/null || die "generated sudoers rule failed visudo"
    install -o root -g root -m 0440 "$TMP_RULE" /etc/sudoers.d/isle-voice
    rm -f "$TMP_RULE"
fi

# --- 3. nginx: wss://DOMAIN -> 127.0.0.1:7880 ------------------------------------------

command -v nginx >/dev/null 2>&1 || die "nginx is not installed (scripts/install-portal.sh sets it up)"
SITE="# Written by install-voice.sh — voice signalling (WebSocket) for LiveKit.
# Straight to this server, never through the anti-DDoS proxy. certbot adds
# the HTTPS part to this file (certbot --nginx -d $DOMAIN).
map \$http_upgrade \$isle_voice_connection {
    default upgrade;
    ''      close;
}
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    access_log /var/log/nginx/isle-voice.access.log;
    location / {
        proxy_pass http://127.0.0.1:7880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$isle_voice_connection;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        # A voice session is one long WebSocket.
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}"
SITE_FILE="/etc/nginx/sites-available/isle-voice.conf"
if (( DRY_RUN )); then echo "$SITE" | sed 's/^/    /'
elif [[ -f "$SITE_FILE" ]] && grep -q "managed by Certbot" "$SITE_FILE"; then
    say "$SITE_FILE already has certbot's HTTPS part: left as it is"
else
    printf '%s\n' "$SITE" > "$SITE_FILE"
    ln -sf ../sites-available/isle-voice.conf /etc/nginx/sites-enabled/isle-voice.conf
    nginx -t
    systemctl reload nginx
fi

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    say "ufw: allowing 7881/tcp and 7882/udp (voice)"
    run ufw allow 7881/tcp
    run ufw allow 7882/udp
fi

if [[ -f "$KEYS_FILE" ]] && (( ! DRY_RUN )); then
    systemctl restart isle-voice.service
    say "isle-voice.service: $(systemctl is-active isle-voice.service)"
fi

cat <<NEXT

==> voice installed. Next:
    1. DNS: $DOMAIN  A  $PUBLIC_IP   (straight to this server, NOT through the anti-DDoS proxy)
    2. in .env on your machine: VOICE_DOMAIN=$DOMAIN, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
    3. ./scripts/deploy.sh --bridge-only && ./scripts/deploy.sh --portal-only   (starts the voice server)
    4. HTTPS for $DOMAIN: certbot --nginx -d $DOMAIN   (accepts Let's Encrypt's terms — your call)
    5. the hosting provider's firewall (if any): allow 7881/tcp and 7882/udp
NEXT
