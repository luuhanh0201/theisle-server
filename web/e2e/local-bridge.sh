#!/bin/sh
# A local bridge for the e2e flows, on fake data (never the live server's): two players who
# spawned (BP_ class names, as StatsLogger sends them, with mutations seen), four garage slots,
# a second admin for the Phân quyền flow. Prints the cookie to pass as PANEL_COOKIE.
#   sh web/e2e/local-bridge.sh /tmp/isle-e2e        (then, from web/:)
#   PANEL_URL=http://127.0.0.1:8091 PANEL_COOKIE=<printed> CHROME=<chromium> node e2e/run.mjs e2e/flows/mods.mjs
# Stop it: kill the pid it prints. Needs `npm run build` in bridge/ and web/ first.
set -e
R=${1:?usage: local-bridge.sh <empty dir>}
REPO=$(cd "$(dirname "$0")/../.." && pwd)
T=$(date +%s)
mkdir -p "$R"/Mods/DinoGarage/Saved/stored "$R"/Mods/StatsLogger/Saved "$R"/Mods/shared "$R"/Config "$R"/data
for m in PlayerCommands AIZones Flora FishControl PteraCarry ZoneGuard Prison; do mkdir -p "$R/Mods/$m/Saved"; done
printf '[/Script/TheIsle.TIGameSession]\nServerName=Test\n' > "$R/Config/Game.ini"
REX=/Game/TheIsle/Core/Characters/Dinosaurs/Tyrannosaurus/BP_Tyrannosaurus.BP_Tyrannosaurus_C
CARNO=/Game/TheIsle/Core/Characters/Dinosaurs/Carnotaurus/BP_Carnotaurus.BP_Carnotaurus_C
cat > "$R/Mods/StatsLogger/Saved/events.ndjson" <<EOF
{"type":"session_start","t":$((T-600)),"steamId":"76561198000000011","name":"Rex Tester"}
{"type":"spawn","t":$((T-590)),"steamId":"76561198000000011","name":"Rex Tester","species":"BP_Tyrannosaurus_C","classPath":"$REX","growth":0.6,"mutations":{"Slot1":"Cellular Regeneration","Slot2":"Congenital Hypoalgesia"}}
{"type":"session_start","t":$((T-500)),"steamId":"76561198000000012","name":"Carno Tester"}
{"type":"spawn","t":$((T-490)),"steamId":"76561198000000012","name":"Carno Tester","species":"BP_Carnotaurus_C","classPath":"$CARNO","growth":0.8}
EOF
for s in a b; do for p in 11 12; do
  printf '{"version":1,"slot":"%s","capturedAt":%s,"classPath":"%s","growth":0.7}\n' "$s" "$T" "$REX" > "$R/Mods/DinoGarage/Saved/stored/765611980000000${p}__$s.json"
done; done
export BACKUP_DIR="$R/backups" GARAGE_ROOT="$R/Mods/DinoGarage/Saved" EVENTS_PATH="$R/Mods/StatsLogger/Saved/events.ndjson" DATA_DIR="$R/data" GAME_CONFIG_DIR="$R/Config"
export PORTAL_PUBLIC_DIR="$REPO/portal/public" ADMIN_TOKEN=e2e-local-token SUPER_ADMIN_STEAM_ID=76561198000000001
export ADMIN_STEAM_IDS=76561198000000001,76561198000000002 HTTP_PORT=8091 SUDO=none SYSTEMCTL=true RCON_PORT=1 GAME_UNIT=none.service
cd "$REPO/bridge"
nohup node dist/index.js > "$R/bridge.log" 2>&1 &
echo "bridge pid $! (log $R/bridge.log)"
node -e "import('./dist/panel-auth.js').then((m) => console.log('PANEL_COOKIE=' + m.signSession(m.sessionSecret('e2e-local-token'), '76561198000000001', Math.floor(Date.now() / 1000) + 86400)))"
