#!/bin/sh
# The player site on fake data for the e2e flows: the local bridge (local-bridge.sh, port 8091) with
# its /player-api open to a local portal server (port 8092), logged in as "Rex Tester"
# (76561198000000011, not in game): Trang chủ's rewards open (below). Prints the cookie to pass as PANEL_COOKIE,
# and LIVE_COOKIE for "Live Tester" (76561198000000013), in game (live-feed.mjs):
#   sh web/e2e/local-portal.sh /tmp/isle-portal-e2e        (then, from web/:)
#   PANEL_URL=http://127.0.0.1:8092 COOKIE_NAME=isle_session PANEL_COOKIE=<printed> CHROME=<chromium> node e2e/run.mjs e2e/flows/portal-frame.mjs
# The React pages are at /next/ (npm run build in web/), the site before React at /.
# Needs `npm run build` in bridge/, portal/ and web/ first. Stop: kill the two pids it prints.
set -e
R=${1:?usage: local-portal.sh <empty dir>}
REPO=$(cd "$(dirname "$0")/../.." && pwd)
export PORTAL_TOKEN=e2e-local-portal-token-0123456789
# Trang chủ's parts open to everyone (Hổ phách NEW, the shop SVip-first: shown locked to Rex), the
# check-in ready after 1 minute played, one quest done (1 minute played) and one not, the starter gift.
T=$(date +%s)
mkdir -p "$R/data"
printf '{"players":[],"features":{"bag":"all","starter":"all","amber":"all","quests":"all","shop":"testing","tele":"all","friends":"all"},"released":{"amber":%s}}\n' "$T" > "$R/data/svip.json"
printf '{"checkinMinutes":1,"checkinRewards":[10,20,30,40,50,60,0],"checkinBonusItem":null}\n' > "$R/data/economy-settings.json"
printf '{"perDay":2,"defs":[{"id":"play1","kind":"play","label":"Chơi 1 phút","target":1,"reward":25,"diet":"all","period":"day","enabled":true},{"id":"walk99","kind":"distance","label":"Đi 99 km","target":99,"reward":500,"diet":"all","period":"day","enabled":true},{"id":"week-play","kind":"play","label":"Chơi 10 giờ trong tuần","target":600,"reward":400,"diet":"all","period":"week","enabled":true}]}\n' > "$R/data/quests-settings.json"
printf '{"offered":{"76561198000000011":%s},"claimed":{}}\n' "$T" > "$R/data/starter.json"
sh "$REPO/web/e2e/local-bridge.sh" "$R" | grep -v '^PANEL_COOKIE=' | tee "$R/bridge.out"
# "Live Tester" in game (a snapshot every 3 s, live-feed.mjs, which also answers the web garage's commands as
# DinoGarage would) for the in-game flows: its cookie is LIVE_COOKIE.
BRIDGE_PID=$(sed -n 's/^bridge pid \([0-9]*\).*/\1/p' "$R/bridge.out")
nohup node "$REPO/web/e2e/live-feed.mjs" "$R/Mods/StatsLogger/Saved" "$BRIDGE_PID" "$R/Mods/DinoGarage/Saved" > "$R/feed.log" 2>&1 &
echo "feed pid $! (stops with the bridge)"
SECRET=e2e-local-portal-session-secret-0123456789
mkdir -p "$R/downloads"
# The map's picture and places: the bridge's copy, as the portal deploy ships it (portal/public/map/ is gitignored).
[ -f "$REPO/portal/public/map/gateway.json" ] || cp -r "$REPO/bridge/public/map" "$REPO/portal/public/map"
# No 3D models in a local copy (portal/public/dino3d/ is gitignored): an empty model list, as a server without them.
# Without it the 404's JSON is taken for the list and skin3d.js throws in the old page's renderGame every second.
[ -f "$REPO/portal/public/dino3d/registry.json" ] || { mkdir -p "$REPO/portal/public/dino3d"; printf '{"species":{},"files":{}}\n' > "$REPO/portal/public/dino3d/registry.json"; }
# The launcher's version file (Trang chủ's download button reads it).
printf '{"version":"2.8.1","windows":{"file":"XomGay-Launcher-Setup-2.8.1.exe","size":104857600}}\n' > "$R/downloads/version.json"
cd "$REPO/portal"
PORTAL_PORT=8092 PORTAL_BASE_URL=http://127.0.0.1:8092 BRIDGE_URL=http://127.0.0.1:8091 PORTAL_SESSION_SECRET=$SECRET \
  PORTAL_TRUST_PROXY=0 PORTAL_DOWNLOADS_DIR="$R/downloads" nohup node dist/index.js > "$R/portal.log" 2>&1 &
echo "portal pid $! (log $R/portal.log)"
node -e "import('./dist/session.js').then((m) => { const exp = Math.floor(Date.now() / 1000) + 86400;
  console.log('PANEL_COOKIE=' + m.sign('$SECRET', '76561198000000011', exp)); console.log('LIVE_COOKIE=' + m.sign('$SECRET', '76561198000000013', exp)); })"
