#!/usr/bin/env bash
# release-launcher.sh — publish a built Xóm Gáy Launcher at https://<portal>/tai/
#
#   cd launcher && npm run dist          # builds dist/ (AppImage + Windows installer)
#   ./scripts/release-launcher.sh        # uploads them to the VPS (DEPLOY_HOST in .env)
#   ./scripts/release-launcher.sh --local DIR   # copies them to DIR instead (to try /tai/ locally)
#   ./scripts/release-launcher.sh --dry-run
#
# What goes up, to /opt/isle-portal/downloads (the portal serves it as /tai/):
#   XomGay-Launcher-Setup-<v>.exe (+ .blockmap), latest.yml         Windows + its update feed
#   XomGay-Launcher-<v>.AppImage, latest-linux.yml                   Linux + its update feed
#   version.json                                                     what /tai.html and the Home button show
# Installed launchers check latest*.yml and update themselves. Older versions
# stay (a launcher mid-update may still be fetching one); the 3 newest are kept.

set -euo pipefail
cd "$(dirname "$0")/.."

LOCAL=""
DRY_RUN=0
while (( $# )); do
    case "$1" in
        --local)   LOCAL="${2:?--local needs a directory}"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
        *) echo "release-launcher.sh: unknown option $1" >&2; exit 1 ;;
    esac
done

die() { echo "release-launcher.sh: $*" >&2; exit 1; }
say() { echo "==> $*"; }

VERSION="$(node -p "require('./launcher/package.json').version")"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "odd version '$VERSION' in launcher/package.json"
DIST="launcher/dist"
WIN="XomGay-Launcher-Setup-$VERSION.exe"
LIN="XomGay-Launcher-$VERSION.AppImage"
FILES=()
for f in "$WIN" "$WIN.blockmap" latest.yml "$LIN" latest-linux.yml; do
    [[ -f "$DIST/$f" ]] || die "$DIST/$f is missing — run 'npm run dist' in launcher/ first"
    FILES+=("$DIST/$f")
done
# The feeds must name this version: a stale latest.yml would offer an old build.
grep -q "^version: $VERSION$" "$DIST/latest.yml" || die "$DIST/latest.yml is not for $VERSION"
grep -q "^version: $VERSION$" "$DIST/latest-linux.yml" || die "$DIST/latest-linux.yml is not for $VERSION"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
size() { stat -c %s "$1"; }
cat > "$STAGE/version.json" <<JSON
{
  "version": "$VERSION",
  "date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "windows": { "file": "$WIN", "size": $(size "$DIST/$WIN") },
  "linux": { "file": "$LIN", "size": $(size "$DIST/$LIN") }
}
JSON
say "launcher $VERSION: $WIN ($(( $(size "$DIST/$WIN") / 1048576 )) MB), $LIN ($(( $(size "$DIST/$LIN") / 1048576 )) MB)"

if [[ -n "$LOCAL" ]]; then
    say "copying to $LOCAL"
    (( DRY_RUN )) || { mkdir -p "$LOCAL" && cp "${FILES[@]}" "$STAGE/version.json" "$LOCAL/"; }
    exit 0
fi

set -a; [[ -f .env ]] && . ./.env; set +a
[[ -n "${DEPLOY_HOST:-}" ]] || die "DEPLOY_HOST is not set (.env)"
REMOTE="/opt/isle-portal/downloads"
RSYNC=(rsync -a --itemize-changes --chmod=D750,F640 --omit-dir-times)
(( DRY_RUN )) && RSYNC+=(--dry-run)

# Installers are served as cacheable for a year (the anti-DDoS proxy keeps
# them): a version, once out, must never change. Rebuilt? Bump the version.
for f in "$WIN" "$LIN"; do
    remote_sum="$(ssh "$DEPLOY_HOST" "sha256sum '$REMOTE/$f' 2>/dev/null | cut -d' ' -f1" || true)"
    if [[ -n "$remote_sum" && "$remote_sum" != "$(sha256sum "$DIST/$f" | cut -d' ' -f1)" ]]; then
        die "$f is already published with different content — bump \"version\" in launcher/package.json and rebuild"
    fi
done

say "uploading to $DEPLOY_HOST:$REMOTE"
(( DRY_RUN )) || ssh "$DEPLOY_HOST" "install -d -m 0750 '$REMOTE' && chgrp portal '$REMOTE'"
# Installers first, the feeds and version.json last: nobody is offered a file
# that is not there yet.
"${RSYNC[@]}" "$DIST/$WIN" "$DIST/$WIN.blockmap" "$DIST/$LIN" "$DEPLOY_HOST:$REMOTE/"
"${RSYNC[@]}" "$DIST/latest.yml" "$DIST/latest-linux.yml" "$STAGE/version.json" "$DEPLOY_HOST:$REMOTE/"
if (( ! DRY_RUN )); then
    # Readable by the portal's user; keep the 3 newest versions of each installer.
    ssh "$DEPLOY_HOST" "cd '$REMOTE' && chgrp portal ./* && \
        ls -1t XomGay-Launcher-Setup-*.exe | tail -n +4 | while read -r f; do rm -f -- \"\$f\" \"\$f.blockmap\"; done; \
        ls -1t XomGay-Launcher-*.AppImage | tail -n +4 | xargs -r rm -f --"
fi
say "done: https://${PORTAL_DOMAIN:-<portal>}/tai.html"
