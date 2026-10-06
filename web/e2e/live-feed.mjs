// A player in game for the player site's flows: "Live Tester" (76561198000000013, a Tyrannosaurus at
// 35 %) spawns, gets a prime reading, then a snapshot and live.json every 3 s (the bridge counts a player online
// while it hears of them within 30 s). Started by local-portal.sh; stops when the bridge's pid is gone.
// It also plays DinoGarage for the web garage: it reads the bridge's inbox.json and answers as the mod
// would (portal_command, then garage_store_result): a store's odd tries fail (moved), the even ones
// succeeds and the dino lands in a new slot; a redeem starts ("Restoring ..."). Other commands: unanswered.
//   node e2e/live-feed.mjs <dir of events.ndjson> <bridge pid> <DinoGarage Saved dir>
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [dir, bridgePid, garage] = process.argv.slice(2);
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
// --- the fake DinoGarage ---------------------------------------------------------------------
let lastId = 0;
let stores = 0;
const event = (o) => line('events.ndjson', { t: now(), ...o });
function game() {
  if (!garage) return;
  let inbox;
  try { inbox = JSON.parse(readFileSync(join(garage, 'inbox.json'), 'utf8')); } catch { return; }
  for (const c of inbox.commands ?? []) {
    if (typeof c.id !== 'number' || c.id <= lastId) continue;
    lastId = c.id;
    writeFileSync(join(garage, 'inbox.ack.json'), JSON.stringify({ lastId }));
    if (c.type === 'store') {
      event({ type: 'portal_command', id: c.id, steamId: c.steamId, action: 'store', ok: true, messages: ['Đứng yên 30 giây để cất dino.'] });
      // Odd tries fail (moved), even ones succeed: the same steps on the old page and the new one.
      const ok = ++stores % 2 === 0;
      setTimeout(() => {
        if (ok) {
          writeFileSync(join(garage, 'stored', `${c.steamId}__${stores}.json`),
            JSON.stringify({ version: 1, slot: String(stores), capturedAt: now(), classPath: REX, growth: 0.35 }));
        }
        event({ type: 'garage_store_result', id: c.id, steamId: c.steamId, ok, ...(ok ? { slot: String(stores) } : { reason: 'moved' }) });
      }, 2000);
    } else if (c.type === 'redeem') {
      event({ type: 'portal_command', id: c.id, steamId: c.steamId, action: 'redeem', ok: true, slot: c.slot, messages: [`Restoring '${c.slot}'. Stand still.`] });
    }
  }
}
setInterval(game, 500);

const alive = () => { try { process.kill(Number(bridgePid), 0); return true; } catch { return false; } };
setInterval(() => { if (!alive()) process.exit(0); tick(); }, 3000);
