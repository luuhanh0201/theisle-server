#!/usr/bin/env bash
# install-portal.sh — set up the player portal (portal/) on the VPS. As root.
#
#   sudo ./scripts/install-portal.sh                   service only (reach it through an SSH tunnel)
#   sudo ./scripts/install-portal.sh --domain example.com --www --proxy
#        nginx in front of the portal, behind an anti-DDoS / CDN proxy
#        (OneShield, Cloudflare "proxied"): the proxy holds the public
#        certificate; nginx answers the proxy on 443 with a self-signed origin
#        certificate (proxy SSL mode "Full", NOT "strict") and on 80 (if the
#        proxy talks plain HTTP). --www: www.example.com redirects to it.
#        --trusted-proxies "CIDR CIDR…": the proxy's addresses, so the real
#        player IP from its X-Forwarded-For reaches the portal (rate limits).
#   sudo ./scripts/install-portal.sh --domain example.com   (no proxy)
#        nginx on port 80 only; you then add the public certificate yourself
#        (certbot --nginx -d example.com — that means accepting Let's Encrypt's
#        terms, which is your call, so this script does not do it).
#   sudo ./scripts/install-portal.sh --dry-run         show what would happen
#
# Then, from your machine: ./scripts/deploy.sh --portal-only
#
# What it does, and why:
#   * a system user "portal" with no shell and no home: the portal faces the
#     internet, so it must not be able to read the game, the bridge data or
#     the admin token. It only talks to the bridge's read-only /player-api.
#   * /opt/isle-portal, owned by the deploy user (who rsyncs the code) with
#     group portal (who reads it). The deploy user joins group portal so it can
#     hand the .env to that group.
#   * theisle-portal.service, sandboxed (read-only filesystem, no privilege
#     escalation, private /tmp) — the portal writes nothing to disk.
#   * sudoers: the deploy user may start/stop/restart this unit, nothing else.
#   * with --domain: nginx as reverse proxy (Ubuntu's package), and ufw opens
#     80/443. The portal itself keeps listening on 127.0.0.1 only. This script
#     owns /etc/nginx/sites-available/isle-portal.conf and isle-default.conf
#     (unknown host names get nothing — no default page, no portal by IP), so
#     another site (the admin panel) can sit beside them.
#
# Safe to run again: every step checks or overwrites its own files only.

set -euo pipefail

DOMAIN=""
WWW=0
PROXY=0
TRUSTED_PROXIES=""
DEPLOY_USER="isle"
PORTAL_USER="portal"
PORTAL_DIR="/opt/isle-portal"
PORTAL_PORT="8090"
DRY_RUN=0

die() { echo "install-portal.sh: $*" >&2; exit 1; }
say() { echo "==> $*"; }
run() { if (( DRY_RUN )); then echo "    (dry run) $*"; else "$@"; fi; }

while (( $# )); do
    case "$1" in
        --domain)      DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
        --www)         WWW=1; shift ;;
        --proxy)       PROXY=1; shift ;;
        --trusted-proxies) TRUSTED_PROXIES="${2:?--trusted-proxies needs CIDRs}"; shift 2 ;;
        --deploy-user) DEPLOY_USER="${2:?}"; shift 2 ;;
        --port)        PORTAL_PORT="${2:?}"; shift 2 ;;
        --dry-run)     DRY_RUN=1; shift ;;
        -h|--help)     sed -n '2,37p' "$0"; exit 0 ;;
        *) die "unknown option: $1" ;;
    esac
done

[[ $EUID -eq 0 ]] || die "run as root"
id "$DEPLOY_USER" >/dev/null 2>&1 || die "deploy user '$DEPLOY_USER' does not exist"
NODE="$(env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin sh -c "command -v node" || true)"
[[ -n "$NODE" ]] || die "node is not installed system-wide (see docs/HUONG-DAN-CAI-DAT.md, step 2)"
if [[ -n "$DOMAIN" && ! "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
    die "--domain '$DOMAIN' does not look like a host name"
fi
(( PROXY )) && [[ -z "$DOMAIN" ]] && die "--proxy needs --domain"
for cidr in $TRUSTED_PROXIES; do
    [[ "$cidr" =~ ^[0-9a-fA-F:.]+(/[0-9]{1,3})?$ ]] || die "--trusted-proxies: '$cidr' is not an IP or CIDR"
done

# --- 1. user and directory ------------------------------------------------

if ! id "$PORTAL_USER" >/dev/null 2>&1; then
    say "creating system user $PORTAL_USER"
    run useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$PORTAL_USER"
fi
say "adding $DEPLOY_USER to group $PORTAL_USER (to hand it the .env)"
run usermod -aG "$PORTAL_USER" "$DEPLOY_USER"
say "$PORTAL_DIR (owner $DEPLOY_USER, group $PORTAL_USER, 0750)"
run install -d -o "$DEPLOY_USER" -g "$PORTAL_USER" -m 0750 "$PORTAL_DIR"

# --- 2. systemd unit --------------------------------------------------------

say "installing theisle-portal.service"
UNIT="[Unit]
Description=The Isle player portal (public; Steam login, read-only player data)
After=network-online.target theisle-bridge.service
Wants=network-online.target

[Service]
Type=simple
User=$PORTAL_USER
Group=$PORTAL_USER
WorkingDirectory=$PORTAL_DIR
EnvironmentFile=$PORTAL_DIR/.env
ExecStart=$NODE $PORTAL_DIR/dist/index.js
Restart=on-failure
RestartSec=5
# It writes nothing and needs no privileges: lock it down.
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
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

[Install]
WantedBy=multi-user.target"
if (( DRY_RUN )); then echo "$UNIT" | sed 's/^/    /'; else
    printf '%s\n' "$UNIT" > /etc/systemd/system/theisle-portal.service
    systemctl daemon-reload
    systemctl enable theisle-portal.service >/dev/null
fi

# --- 3. the deploy user may (re)start it --------------------------------------

SYSTEMCTL="$(command -v systemctl)"
say "sudoers: $DEPLOY_USER may start/stop/restart theisle-portal"
RULE="$DEPLOY_USER ALL=(root) NOPASSWD: $SYSTEMCTL start theisle-portal.service, $SYSTEMCTL stop theisle-portal.service, $SYSTEMCTL restart theisle-portal.service"
if (( ! DRY_RUN )); then
    TMP="$(mktemp)"
    printf '# Written by install-portal.sh\n%s\n' "$RULE" > "$TMP"
    visudo -cf "$TMP" >/dev/null || die "generated sudoers rule failed visudo"
    install -o root -g root -m 0440 "$TMP" /etc/sudoers.d/theisle-portal
    rm -f "$TMP"
fi

# --- 4. nginx (only with a domain) ------------------------------------------

if [[ -z "$DOMAIN" ]]; then
    say "no --domain: the portal stays on 127.0.0.1:$PORTAL_PORT (SSH tunnel to try it)"
else
    if ! command -v nginx >/dev/null 2>&1; then
        say "installing nginx (Ubuntu package)"
        run apt-get install -y nginx
    fi
    SSL_DIR="/etc/nginx/isle-ssl"
    NAMES="$DOMAIN"; (( WWW )) && NAMES="$DOMAIN www.$DOMAIN"
    if (( PROXY )) && [[ ! -f "$SSL_DIR/origin.crt" ]]; then
        # What the anti-DDoS proxy sees when it connects on 443. Self-signed on
        # purpose: the public certificate is the proxy's.
        say "self-signed origin certificate for $NAMES (10 years) in $SSL_DIR"
        SAN="DNS:$DOMAIN"; (( WWW )) && SAN="$SAN,DNS:www.$DOMAIN"
        run install -d -m 0700 "$SSL_DIR"
        run openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=$DOMAIN" \
            -addext "subjectAltName=$SAN" -keyout "$SSL_DIR/origin.key" -out "$SSL_DIR/origin.crt"
        run chmod 600 "$SSL_DIR/origin.key"
    fi

    REALIP=""
    if [[ -n "$TRUSTED_PROXIES" ]]; then
        REALIP="    # The anti-DDoS proxy in front: take the player's IP from its X-Forwarded-For."
        for cidr in $TRUSTED_PROXIES; do REALIP="$REALIP
    set_real_ip_from $cidr;"; done
        REALIP="$REALIP
    real_ip_header X-Forwarded-For;
    real_ip_recursive on;"
    fi
    LISTEN="    listen 80;
    listen [::]:80;"
    if (( PROXY )); then LISTEN="$LISTEN
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    ssl_certificate     $SSL_DIR/origin.crt;
    ssl_certificate_key $SSL_DIR/origin.key;"; fi
    WWW_REDIRECT=""
    (( WWW )) && WWW_REDIRECT="    if (\$host = www.$DOMAIN) { return 301 https://$DOMAIN\$request_uri; }"

    SITE="# Written by install-portal.sh — the player portal. The admin panel is NOT here.
$( ((PROXY)) && echo "# Behind an anti-DDoS proxy: it holds the public certificate and reaches this
# server on 443 (self-signed origin certificate: proxy SSL mode \"Full\", not
# \"strict\") or on 80." || true )
upstream isle_portal {
    server 127.0.0.1:$PORTAL_PORT;
    keepalive 16;
}
# Who connected (the proxy, before real_ip) and what it says the player is.
log_format isle_portal '\$remote_addr [\$time_local] \"\$request\" \$status '
                       'xff=\"\$http_x_forwarded_for\" real=\"\$http_x_real_ip\" peer=\$realip_remote_addr';

server {
$LISTEN
    server_name $NAMES;
    access_log /var/log/nginx/isle-portal.access.log isle_portal;
$REALIP
$WWW_REDIRECT
    client_max_body_size 64k;
    gzip on;
    gzip_types text/css application/javascript text/javascript application/json image/svg+xml;

    location / {
        proxy_pass http://isle_portal;
        proxy_http_version 1.1;
        proxy_set_header Connection \"\";
        proxy_set_header Host \$host;
        # One address, the player's (after real_ip): the portal rate-limits on it.
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 30s;
    }
}"
    DEFAULT="# Written by install-portal.sh — any other host name (or the bare IP) gets nothing.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
$( ((PROXY)) && echo "    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    ssl_reject_handshake on;" || true )
    server_name _;
    return 444;
}"
    if (( DRY_RUN )); then printf '%s\n\n%s\n' "$SITE" "$DEFAULT" | sed 's/^/    /'; else
        printf '%s\n' "$SITE" > /etc/nginx/sites-available/isle-portal.conf
        printf '%s\n' "$DEFAULT" > /etc/nginx/sites-available/isle-default.conf
        ln -sf ../sites-available/isle-portal.conf /etc/nginx/sites-enabled/isle-portal.conf
        ln -sf ../sites-available/isle-default.conf /etc/nginx/sites-enabled/isle-default.conf
        # Ubuntu's welcome page would otherwise answer every unknown name.
        rm -f /etc/nginx/sites-enabled/default
        nginx -t
        systemctl enable --now nginx >/dev/null
        systemctl reload nginx
    fi
    if command -v ufw >/dev/null 2>&1; then
        say "ufw: allowing 80/tcp and 443/tcp"
        # A firewall that is off (or broken) must not stop the install: say so and go on.
        run ufw allow 80/tcp || say "ufw: could not add 80/tcp (is ufw working? 'ufw status')"
        run ufw allow 443/tcp || say "ufw: could not add 443/tcp"
    fi
    (( PROXY )) || say "no --proxy: nginx serves plain HTTP. For HTTPS run certbot --nginx -d $DOMAIN yourself (it accepts Let's Encrypt's terms)."
fi

cat <<NEXT

==> portal installed. Next:
    1. in .env on your machine: PORTAL_TOKEN and PORTAL_SESSION_SECRET (openssl rand -hex 32 each)${DOMAIN:+,
       PORTAL_DOMAIN=$DOMAIN}
    2. ./scripts/deploy.sh --bridge-only   (the bridge learns PORTAL_TOKEN)
    3. ./scripts/deploy.sh --portal-only
NEXT
