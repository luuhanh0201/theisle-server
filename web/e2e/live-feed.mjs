// A player in game for the player site's flows: "Live Tester" (76561198000000013, a Tyrannosaurus at
// 35 %) spawns, gets a prime reading, then a snapshot and live.json every 3 s (the bridge counts a player online
// while it hears of them within 30 s). Started by local-portal.sh; stops when the bridge's pid is gone.
//   node e2e/live-feed.mjs <dir of events.ndjson> <bridge pid>
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [dir, bridgePid] = process.argv.slice(2);
process.title = 'isle-e2e-feed';
const ID = '76561198000000013';
const NAME = 'Live Tester';
const REX = '/Game/TheIsle/Core/Characters/Dinosaurs/Tyrannosaurus/BP_Tyrannosaurus.BP_Tyrannosaurus_C';
const now = () => Math.floor(Date.now() / 1000);
const line = (file, o) => appendFileSync(join(dir, file), `${JSON.stringify(o)}\n`);
const t0 = now();
line('events.ndjson', { type: 'session_start', t: t0 - 120, steamId: ID, name: NAME });
line('events.ndjson', { type: 'spawn', t: t0 - 110, steamId: ID, name: NAME, species: 'BP_Tyrannosaurus_C', classPath: REX, growth: 0.3 });
line('events.ndjson', { type: 'prime', t: t0 - 100, steamId: ID, name: NAME, elder: false, prime: false, eligible: false, elderStacks: 0,
  conditions: { 1: true, 2: true, 3: false, 4: true } });
const snap = () => line('snapshots.ndjson', {
  type: 'snapshot', t: now(), steamId: ID, name: NAME, species: 'BP_Tyrannosaurus_C', growth: 0.35,
  health: 600, stamina: 80, hunger: 20, thirst: 50, blood: 100, oxygen: 90,
  max: { health: 1000, stamina: 100, hunger: 100, thirst: 100, blood: 100, oxygen: 100 },
  loc: { x: 148697, y: 349211, z: 2000 }, yaw: 90, ping: 40,
});
// live.json (the 1 s file, replaced): the tele and the map read the player from it.
const live = () => writeFileSync(join(dir, 'live.json'), JSON.stringify({ t: now(), players: [{
  id: ID, x: 148697, y: 349211, z: 2000, yaw: 90, health: 600, stamina: 80, hunger: 20, thirst: 50, oxygen: 90, blood: 100, growth: 0.35,
}] }));
const tick = () => { snap(); live(); };
tick();
const alive = () => { try { process.kill(Number(bridgePid), 0); return true; } catch { return false; } };
const timer = setInterval(() => { if (!alive()) { clearInterval(timer); return; } tick(); }, 3000);
