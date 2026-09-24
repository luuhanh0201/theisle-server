#!/usr/bin/env bash
# install-ue4ss.sh — install or upgrade UE4SS next to the game binary. As root.
#
#   sudo ./scripts/install-ue4ss.sh                 latest experimental build
#   sudo ./scripts/install-ue4ss.sh --url <zip-url> a specific build
#   sudo ./scripts/install-ue4ss.sh --dry-run       only show what would happen
#
# Options: --bin-dir <dir> (default /home/isle/server/TheIsle/Binaries/Win64),
#          --user <name> (default isle).
#
# Why experimental: the stable v3.0.1 release cannot find Evrima's engine
# (UE4SS.log: "Failed to find EngineVersion / GUObjectArray … PS scan timed
# out"), so no Lua mod ever loads. The experimental builds support it.
#
# Layout: FLAT, as the rest of this repo expects —
#   $BIN_DIR/dwmapi.dll  $BIN_DIR/UE4SS.dll  $BIN_DIR/UE4SS-settings.ini
#   $BIN_DIR/Mods/…      $BIN_DIR/UE4SS.log
# Experimental zips put everything but dwmapi.dll in a ue4ss/ subfolder. Its
# dwmapi.dll loads ue4ss/UE4SS.dll when that folder exists and falls back to
# UE4SS.dll next to the game otherwise, and UE4SS then uses the folder it was
# loaded from as its root. So the files are unpacked flat and a ue4ss/ folder
# must NOT exist in $BIN_DIR — it would silently win over our Mods/.
#
# Never touches: our mods, mods.txt, UE4SS-settings.ini (deploy.sh owns those),
# any Saved/ directory. The previous DLLs are kept in /home/<user>/backups/.

set -euo pipefail

SERVICE_USER="isle"
BIN_DIR=""
URL="${UE4SS_URL:-}"
DRY_RUN=0
RELEASE_API="https://api.github.com/repos/UE4SS-RE/RE-UE4SS/releases/tags/experimental-latest"

die() { echo "install-ue4ss.sh: $*" >&2; exit 1; }
say() { echo "==> $*"; }

while (( $# )); do
    case "$1" in
        --bin-dir) BIN_DIR="${2:?--bin-dir needs a value}"; shift 2 ;;
        --user)    SERVICE_USER="${2:?--user needs a value}"; shift 2 ;;
        --url)     URL="${2:?--url needs a value}"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
        *) die "unknown option: $1" ;;
    esac
done

HOME_DIR="/home/$SERVICE_USER"
BIN_DIR="${BIN_DIR:-$HOME_DIR/server/TheIsle/Binaries/Win64}"

[[ $EUID -eq 0 ]] || die "run as root"
[[ -f "$BIN_DIR/TheIsleServer-Win64-Shipping.exe" ]] \
    || die "$BIN_DIR has no TheIsleServer-Win64-Shipping.exe — wrong --bin-dir, or SteamCMD has not installed the Windows build"
for tool in curl unzip rsync python3; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed"
done
# Replacing the DLLs under a running server would leave it on the old build
# until some later restart — stop first so the result is known.
if (( ! DRY_RUN )) && systemctl is-active --quiet theisle.service 2>/dev/null; then
    die "theisle.service is running — stop it first: systemctl stop theisle"
fi

# --- 1. which build ------------------------------------------------------

if [[ -z "$URL" ]]; then
    say "looking up the latest experimental UE4SS build"
    # The release holds the user zip (UE4SS_v….zip) plus zDEV-/zCustom…/zMap…
    # extras; only the user zip is wanted.
    URL="$(curl -fsSL "$RELEASE_API" | python3 -c '
import json, re, sys
assets = json.load(sys.stdin)["assets"]
hits = [a["browser_download_url"] for a in assets if re.fullmatch(r"UE4SS_v[\w.\-]+\.zip", a["name"])]
if len(hits) != 1:
    sys.exit("expected exactly one UE4SS_v*.zip asset, found: %s" % [a["name"] for a in assets])
print(hits[0])')" || die "could not resolve the experimental build (GitHub API) — pass --url"
fi
say "build: ${URL##*/}"

# --- 2. download + check -------------------------------------------------

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/ue4ss.zip" "$URL" || die "download failed: $URL"
unzip -q "$TMP/ue4ss.zip" -d "$TMP/x"

if [[ -f "$TMP/x/ue4ss/UE4SS.dll" ]]; then
    SRC="$TMP/x/ue4ss"          # experimental layout
else
    SRC="$TMP/x"                # old flat layout (v3.0.x)
fi
[[ -f "$TMP/x/dwmapi.dll" && -f "$SRC/UE4SS.dll" && -d "$SRC/Mods" ]] \
    || die "unexpected zip layout (need dwmapi.dll, UE4SS.dll, Mods/) — not installing"

if (( DRY_RUN )); then
    say "DRY RUN — would install into $BIN_DIR:"
    echo "    dwmapi.dll, UE4SS.dll"
    echo "    Mods/ built-ins + Mods/shared (not mods.txt / mods.json, not our mods)"
    if [[ ! -f "$BIN_DIR/UE4SS-settings.ini" ]]; then echo "    UE4SS-settings.ini (none there yet)"; fi
    if [[ -d "$BIN_DIR/ue4ss" ]]; then echo "    and move the stray $BIN_DIR/ue4ss/ to the backup dir"; fi
    exit 0
fi

# --- 3. back up, then install flat --------------------------------------

BACKUP="$HOME_DIR/backups/ue4ss-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" "$HOME_DIR/backups" "$BACKUP"
for f in dwmapi.dll UE4SS.dll UE4SS-settings.ini ue4ss-build.txt; do
    if [[ -f "$BIN_DIR/$f" ]]; then cp -a "$BIN_DIR/$f" "$BACKUP/"; fi
done
if [[ -d "$BIN_DIR/ue4ss" ]]; then
    # A ue4ss/ folder makes dwmapi.dll load ue4ss/UE4SS.dll and ue4ss/Mods —
    # none of our mods. Moved, not deleted.
    say "moving $BIN_DIR/ue4ss out of the way (to $BACKUP/ue4ss)"
    mv "$BIN_DIR/ue4ss" "$BACKUP/ue4ss"
fi
say "previous UE4SS files backed up to $BACKUP"

say "installing UE4SS into $BIN_DIR (flat layout)"
install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0644 "$TMP/x/dwmapi.dll" "$BIN_DIR/dwmapi.dll"
install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0644 "$SRC/UE4SS.dll"    "$BIN_DIR/UE4SS.dll"
# Built-in mods and Mods/shared (Types.lua, UEHelpers/) are UE4SS's own and
# must match the DLL. mods.txt / mods.json are left alone: deploy.sh ships our
# mods.txt, and the upstream one enables console/cheat mods.
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" "$BIN_DIR/Mods"
rsync -a --chown="$SERVICE_USER:$SERVICE_USER" \
    --exclude=/mods.txt --exclude=/mods.json \
    "$SRC/Mods/" "$BIN_DIR/Mods/"
# Fresh install only: deploy.sh replaces it with ue4ss/UE4SS-settings.ini.
if [[ ! -f "$BIN_DIR/UE4SS-settings.ini" ]]; then
    install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0644 "$SRC/UE4SS-settings.ini" "$BIN_DIR/UE4SS-settings.ini"
fi
echo "${URL##*/}" > "$BIN_DIR/ue4ss-build.txt"
chown "$SERVICE_USER:$SERVICE_USER" "$BIN_DIR/ue4ss-build.txt"

say "UE4SS ${URL##*/} installed. Next:"
echo "    from your machine: ./scripts/deploy.sh --mods-only   (UE4SS-settings.ini + mods.txt, restarts the server)"
echo "    then:              ./scripts/logs.sh ue4ss            (expect: [isle] … loaded)"
