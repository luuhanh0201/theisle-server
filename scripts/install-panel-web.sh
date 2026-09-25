#!/usr/bin/env bash
# install-panel-web.sh — open the admin panel on the web, behind its two checks. As root.
#
#   sudo ./scripts/install-panel-web.sh --domain admin.example.com --proxy --trusted-proxies "CIDR CIDR…"
#        behind an anti-DDoS proxy (OneShield): the proxy holds the public
#        certificate; nginx answers it on 443 with a self-signed origin
#        certificate (proxy SSL mode "Full", NOT "strict") and on 80. The
#        visitor's IP is taken from the proxy's X-Forwarded-For ONLY when the
#        connection comes from one of --trusted-proxies (the proxy's own
#        addresses — the same as the portal's).
#   sudo ./scripts/install-panel-web.sh --domain admin.example.com
#        straight to this server: port 80 only; the certificate is a separate
#        step (certbot --nginx -d DOMAIN — accepting Let's Encrypt's terms).
#   … --dry-run   show the nginx site, change nothing
#
# Then, from your machine: PANEL_BASE_URL=https://DOMAIN and PANEL_ALLOWED_IPS
# in .env, and ./scripts/deploy.sh --bridge-only.
#
# What it does, and why:
#   * nginx: DOMAIN -> the bridge on 127.0.0.1:PORT, with the visitor's
#     address in X-Real-IP (nginx's own value, never the browser's). The
#     bridge lets only the allowed IPs in (check 1), then asks for a Steam
#     login of a game admin (check 2) — bridge/src/panel-auth.ts. Someone
#     who connects straight to this server's IP with a made-up
#     X-Forwarded-For is not a trusted proxy: their own address is checked.
#   * /player-api (the portal's routes on the same bridge) is not served here.
#
# Safe to run again: it writes only its own nginx site and origin certificate
# (and leaves a site certbot has already extended alone).

set -euo pipefail

DOMAIN=""
BRIDGE_PORT="8080"
PROXY=0
TRUSTED_PROXIES=""
DRY_RUN=0
SSL_DIR="/etc/nginx/isle-ssl"

die() { echo "install-panel-web.sh: $*" >&2; exit 1; }
say() { echo "==> $*"; }
run() { if (( DRY_RUN )); then echo "    [dry-run] $*"; else "$@"; fi; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain)          DOMAIN="${2:-}"; shift 2 ;;
        --port)            BRIDGE_PORT="${2:-}"; shift 2 ;;
        --proxy)           PROXY=1; shift ;;
        --trusted-proxies) TRUSTED_PROXIES="${2:-}"; shift 2 ;;
        --dry-run)         DRY_RUN=1; shift ;;
        -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
        *) die "unknown option: $1" ;;
    esac
done
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || die "--domain admin.example.com is required"
[[ "$BRIDGE_PORT" =~ ^[0-9]{2,5}$ ]] || die "--port must be a port number"
if (( PROXY )); then
    [[ -n "$TRUSTED_PROXIES" ]] || die "--proxy needs --trusted-proxies (the proxy's addresses): without them every visitor has the proxy's IP"
    for cidr in $TRUSTED_PROXIES; do
        [[ "$cidr" =~ ^[0-9a-fA-F:.]+(/[0-9]{1,3})?$ ]] || die "--trusted-proxies: '$cidr' is not an IP or CIDR"
    done
fi
(( DRY_RUN )) || [[ $EUID -eq 0 ]] || die "run as root (sudo)"
(( DRY_RUN )) || command -v nginx >/dev/null 2>&1 || die "nginx is not installed (scripts/install-portal.sh sets it up)"

LISTEN="    listen 80;
    listen [::]:80;"
REALIP=""
if (( PROXY )); then
    if [[ ! -f "$SSL_DIR/admin-panel.crt" ]]; then
        # What the anti-DDoS proxy sees when it connects on 443. Self-signed on
        # purpose: the public certificate is the proxy's.
        say "self-signed origin certificate for $DOMAIN (10 years) in $SSL_DIR"
        run install -d -m 0700 "$SSL_DIR"
        run openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=$DOMAIN" \
            -addext "subjectAltName=DNS:$DOMAIN" -keyout "$SSL_DIR/admin-panel.key" -out "$SSL_DIR/admin-panel.crt"
        run chmod 600 "$SSL_DIR/admin-panel.key"
    fi
    LISTEN="$LISTEN
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    ssl_certificate     $SSL_DIR/admin-panel.crt;
    ssl_certificate_key $SSL_DIR/admin-panel.key;"
    REALIP="    # The anti-DDoS proxy in front: the visitor's IP from its X-Forwarded-For,
    # believed only when the connection comes from the proxy itself."
    for cidr in $TRUSTED_PROXIES; do REALIP="$REALIP
    set_real_ip_from $cidr;"; done
    REALIP="$REALIP
    real_ip_header X-Forwarded-For;
    real_ip_recursive on;"
fi

SITE="# Written by install-panel-web.sh — the admin panel (the bridge) on the web.
# The bridge checks the visitor's address and asks for an admin's Steam login.
# Who connected (the proxy, before real_ip) and who the visitor is.
log_format isle_panel '\$remote_addr [\$time_local] \"\$request\" \$status peer=\$realip_remote_addr';

server {
$LISTEN
    server_name $DOMAIN;
    access_log /var/log/nginx/isle-panel.access.log isle_panel;
    client_max_body_size 256k;
$REALIP

    # The portal's routes live on the same bridge; they are not for the web.
    location /player-api/ { return 404; }

    location / {
        proxy_pass http://127.0.0.1:$BRIDGE_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        # What the bridge's IP check reads: nginx's value (after real_ip), never the browser's.
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
}"
SITE_FILE="/etc/nginx/sites-available/isle-panel.conf"
if (( DRY_RUN )); then
    echo "$SITE" | sed 's/^/    /'
elif [[ -f "$SITE_FILE" ]] && grep -q "managed by Certbot" "$SITE_FILE"; then
    say "$SITE_FILE already has certbot's HTTPS part: left as it is"
else
    printf '%s\n' "$SITE" > "$SITE_FILE"
    ln -sf ../sites-available/isle-panel.conf /etc/nginx/sites-enabled/isle-panel.conf
    nginx -t
    systemctl reload nginx
    say "nginx: $DOMAIN -> 127.0.0.1:$BRIDGE_PORT"
fi

if (( PROXY )); then
cat <<NEXT

==> panel site installed (behind the proxy). Next:
    1. in the proxy (OneShield): $DOMAIN -> this server, SSL mode "Full" (not "strict")
    2. in .env on your machine: PANEL_BASE_URL=https://$DOMAIN and PANEL_ALLOWED_IPS,
       then ./scripts/deploy.sh --bridge-only
    3. open https://$DOMAIN — log in with a Steam account that is a game admin
NEXT
else
cat <<NEXT

==> panel site installed. Next:
    1. DNS: $DOMAIN  A  <this server's IP>   (straight to this server)
    2. HTTPS: certbot --nginx -d $DOMAIN   (accepts Let's Encrypt's terms — your call)
    3. in .env on your machine: PANEL_BASE_URL=https://$DOMAIN and PANEL_ALLOWED_IPS,
       then ./scripts/deploy.sh --bridge-only
    4. open https://$DOMAIN — log in with a Steam account that is a game admin
NEXT
fi
