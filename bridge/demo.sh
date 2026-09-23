#!/usr/bin/env bash
# demo.sh — run the panel against generated data, with no game server.
#
#   ./bridge/demo.sh            http://127.0.0.1:8080
#   PORT=9000 ./bridge/demo.sh
#
# Everything lands in a temp directory that is removed on exit. Use this to
# look at the UI, not to test the game integration.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
PORT="${PORT:-8080}"

[[ -d node_modules ]] || npm install --no-audit --no-fund --silent
npx tsc

DEMO="$(mktemp -d)"
trap 'rm -rf "$DEMO"' EXIT
mkdir -p "$DEMO/garage/stored"

# One simulator, two modes: "history" writes the past ten minutes in one go,
# "live" keeps appending every 3 seconds so the panel shows a moving server.
cat > "$DEMO/sim.mjs" <<'NODE'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [demo, mode] = process.argv.slice(2);
const EVENTS = join(demo, 'events.ndjson');
const SNAPS = join(demo, 'snapshots.ndjson');

const id = (n) => `765611980000000${String(n).padStart(2, '0')}`;
const roster = [
  { steamId: id(1), name: 'Rồng Đất',   species: 'BP_Carnotaurus_C',       growth: 1 },
  { steamId: id(2), name: 'tenon_boi',  species: 'BP_Tenontosaurus_C',     growth: 0.82 },
  { steamId: id(3), name: 'DiloQueen',  species: 'BP_Dilophosaurus_C',     growth: 0.2 },
  { steamId: id(4), name: 'Pachy<b>',   species: 'BP_Pachycephalosaurus_C', growth: 1 },
];
const chatLines = ['ai đi săn không', 'ở hồ trung tâm có rex', 'gg', '!garage', 'lag quá', 'nest ở bắc'];

// Same format StatsLogger reports from GetFullName(), and the slot files use.
const classPathOf = (sp) => `BlueprintGeneratedClass /Game/Dino/${sp.slice(0, -2)}.${sp}`;
// In-game FNames are the display names ("Reniculate Kidneys"), with a few
// internal variants ("PhotosyntheticTissueStatAdder"); "Mystery Gene" stands in
// for a name the reference table does not know.
const MUTS = ['Hematophagy', 'Enlarged Meniscus', 'Reinforced Tendons', 'Efficient Digestion',
              'Increased Inspiratory Capacity', 'Cellular Regeneration', 'Featherweight',
              'Hypermetabolic Inanition', 'PhotosyntheticTissueStatAdder', 'Traumatic Thrombosis', 'Mystery Gene'];

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const round = Math.round;

// Positions in UE units (cm), roughly a few km apart.
for (const p of roster) {
  p.hp = 100; p.spawnedAt = 0;
  p.loc = { x: round(rnd(-200000, 200000)), y: round(rnd(-200000, 200000)), z: round(rnd(0, 8000)) };
  p.heading = rnd(0, Math.PI * 2);
}

function step(t, out, snaps) {
  // Everyone wanders a little.
  for (const p of roster) {
    p.heading += rnd(-0.5, 0.5);
    p.loc.x = round(p.loc.x + Math.cos(p.heading) * rnd(500, 2500));
    p.loc.y = round(p.loc.y + Math.sin(p.heading) * rnd(500, 2500));
  }

  // One fight per step.
  const a = pick(roster);
  const b = pick(roster.filter((p) => p !== a));
  const amount = round(rnd(6, 34));
  b.hp = Math.max(0, b.hp - amount);
  out.push({ t, type: 'damage', attacker: a.steamId, attackerName: a.name, attackerSpecies: a.species,
             victim: b.steamId, victimName: b.name, victimSpecies: b.species, amount, loc: { ...b.loc } });

  // Growth ticks up; the juvenile crosses milestones.
  for (const p of roster) {
    const before = p.growth;
    p.growth = Math.min(1, +(p.growth + 0.01).toFixed(3));
    for (const m of [0.25, 0.5, 0.75, 1]) {
      if (before < m && p.growth >= m) {
        out.push({ t, type: 'growth', steamId: p.steamId, name: p.name, species: p.species,
                   milestone: m, growth: p.growth, lifeSeconds: t - p.spawnedAt });
      }
    }
  }

  if (Math.random() < 0.15) {
    const p = pick(roster);
    out.push({ t, type: 'mutation', steamId: p.steamId, name: p.name, species: p.species,
               slot: pick(['Slot2', 'Slot3', 'Slot4']), to: pick(MUTS), growth: p.growth });
  }

  if (Math.random() < 0.25) {
    const p = pick(roster);
    out.push({ t, type: 'chat', steamId: p.steamId, name: p.name, message: pick(chatLines) });
  }


  if (b.hp === 0) {
    out.push({ t, type: 'death', steamId: b.steamId, name: b.name, species: b.species,
               growth: b.growth, loc: { ...b.loc }, lifeSeconds: t - b.spawnedAt, attributed: true,
               killer: a.steamId, killerName: a.name, killerSpecies: a.species,
               killerGrowth: a.growth, lastHit: amount });
    b.hp = 100;
    b.spawnedAt = t;
    b.loc = { x: round(rnd(-200000, 200000)), y: round(rnd(-200000, 200000)), z: 0 };
    out.push({ t, type: 'spawn', steamId: b.steamId, name: b.name, species: b.species, classPath: classPathOf(b.species), mutations: { Slot1: pick(MUTS), ParentSlot1: pick(MUTS) },
               growth: b.growth, loc: { ...b.loc } });
  }

  // Last, as the mod does: a snapshot taken in the same poll as a respawn
  // already shows the new body.
  for (const p of roster) {
    snaps.push({ t, type: 'snapshot', steamId: p.steamId, name: p.name, species: p.species,
                 health: p.hp, stamina: round(rnd(30, 95)), hunger: round(rnd(20, 90)),
                 thirst: round(rnd(20, 90)), oxygen: 100, blood: round(rnd(60, 100)),
                 growth: p.growth, loc: { ...p.loc }, yaw: round(rnd(-180, 180)) });
  }
}

const write = (file, lines, append) => {
  const text = lines.map((e) => JSON.stringify(e)).join('\n') + '\n';
  (append ? appendFileSync : writeFileSync)(file, text);
};

const now = Math.floor(Date.now() / 1000);

if (mode === 'history') {
  const out = [], snaps = [];
  const t0 = now - 600;
  out.push({ t: t0, type: 'mod_loaded', mod: 'StatsLogger' }, { t: t0, type: 'mod_loaded', mod: 'DinoGarage' });
  for (const p of roster) {
    p.spawnedAt = t0 + 2;
    out.push({ t: t0 + 1, type: 'session_start', steamId: p.steamId, name: p.name });
    out.push({ t: t0 + 2, type: 'spawn', steamId: p.steamId, name: p.name, species: p.species, classPath: classPathOf(p.species), mutations: { Slot1: pick(MUTS), ParentSlot1: pick(MUTS) },
               growth: p.growth, loc: { ...p.loc } });
  }
  // A player who came and went.
  out.push({ t: t0 + 30, type: 'session_start', steamId: id(5), name: 'khách_qua_đường' });
  out.push({ t: t0 + 290, type: 'session_end', steamId: id(5), name: 'khách_qua_đường', duration: 260 });

  for (let i = 0; i < 100; i++) step(t0 + 5 + i * 5, out, snaps);

  // An unattributed death: fall damage, which Lua cannot see the cause of.
  const pachy = roster[3];
  out.push({ t: now - 120, type: 'death', steamId: pachy.steamId, name: pachy.name,
             species: pachy.species, growth: 1, attributed: false, lifeSeconds: 480, loc: { ...pachy.loc } });
  out.push({ t: now - 110, type: 'spawn', steamId: pachy.steamId, name: pachy.name,
             species: pachy.species, growth: 0.1, loc: { ...pachy.loc } });
  out.push({ t: now - 60, type: 'growth_set', steamId: pachy.steamId, name: pachy.name,
             species: pachy.species, from: 0.1, to: 1 });

  // A garage round trip, including the SetHealth(0) the panel must not count.
  const carno = roster[0];
  out.push({ t: now - 90, type: 'garage_store', steamId: carno.steamId, slot: 'default', species: carno.species, growth: 1 });
  out.push({ t: now - 86, type: 'death', steamId: carno.steamId, name: carno.name, species: carno.species,
             growth: 1, attributed: false });
  // The player respawns as the same species, then redeems onto the juvenile.
  out.push({ t: now - 60, type: 'spawn', steamId: carno.steamId, name: carno.name, species: carno.species, classPath: classPathOf(carno.species), mutations: { Slot1: pick(MUTS), ParentSlot1: pick(MUTS) },
             growth: 0.1, loc: { ...carno.loc } });
  out.push({ t: now - 40, type: 'garage_redeem', steamId: carno.steamId, slot: 'default', species: carno.species, growth: 1, ok: true });

  out.sort((x, y) => x.t - y.t);
  write(EVENTS, out, false);
  write(SNAPS, snaps, false);

  // Stored dinos in the flat layout and the full version-1 schema the Lua
  // mod writes, so the panel's detail cards have something to show.
  const slot = (steamId, name, classPath, ago, extra) => writeFileSync(
    join(demo, 'garage', 'stored', `${steamId}__${name}.json`),
    JSON.stringify({
      version: 1, slot: name, capturedAt: now - ago, classPath,
      health: 950, stamina: 88, hunger: 70, thirst: 62, oxygen: 100, blood: 96,
      food: 45, waterLevel: 38, lockedDamage: 0, rottenValue: 0,
      maxHunger: 100, maxFoodValue: 100, maxThirst: 100, maxStamina: 100,
      growth: 1, isFemale: true, elderStacks: 2,
      mutations: {
        Slot1: 'Hematophagy', Slot2: 'Enlarged Meniscus', Slot3: 'Reinforced Tendons',
        ParentSlot1: 'Efficient Digestion', ParentSlot2: 'PhotosyntheticTissueStatAdder',
        ElderSlot1A: 'Cellular Regeneration',
      },
      nutrients: { carbValue: 42, proteinValue: 88, lipidValue: 61, bonesValue: 12, bMalnutrition: false },
      location: { x: 104233.5, y: -55120.2, z: 1840.7 },
      rotation: { pitch: 0, yaw: 83.2, roll: 0 },
      ...extra,
    }, null, 2),
  );
  slot(id(1), 'default', 'BlueprintGeneratedClass /Game/Dino/BP_Carnotaurus.BP_Carnotaurus_C', 3600, {});
  slot(id(1), 'hunter', 'BlueprintGeneratedClass /Game/Dino/BP_Deinosuchus.BP_Deinosuchus_C', 86400,
       { growth: 0.64, health: 610, isFemale: false, elderStacks: 0,
         mutations: { Slot1: 'Increased Inspiratory Capacity' },
         nutrients: { carbValue: 5, proteinValue: 20, lipidValue: 8, bMalnutrition: true } });
  slot(id(2), 'backup', 'BlueprintGeneratedClass /Game/Dino/BP_Tenontosaurus.BP_Tenontosaurus_C', 7200,
       { growth: 0.82, health: 1400 });
  slot(id(3), 'event', 'BlueprintGeneratedClass /Game/Dino/BP_Rex.BP_Rex_C', 600,
       { growth: 1, health: null, stamina: null, hunger: null, thirst: null, oxygen: null, blood: null,
         food: null, waterLevel: null, mutations: {}, nutrients: {}, elderStacks: null,
         location: undefined, rotation: undefined, createdBy: 'admin' });

  console.log(`demo data: ${out.length} events, ${snaps.length} snapshots, 4 stored dinos`);
} else {
  // Carry on from where the history left everyone, not from new random spots.
  for (const line of readFileSync(SNAPS, 'utf8').trim().split('\n')) {
    const e = JSON.parse(line);
    const p = roster.find((r) => r.steamId === e.steamId);
    if (p) Object.assign(p, { loc: e.loc, growth: e.growth, hp: e.health });
  }
  for (const line of readFileSync(EVENTS, 'utf8').trim().split('\n')) {
    const e = JSON.parse(line);
    const p = roster.find((r) => r.steamId === e.steamId);
    if (p && e.type === 'spawn') p.spawnedAt = e.t;
  }
  // Stand-in for DinoGarage's inbox poll (mods/DinoGarage/Scripts/garage/inbox.lua):
  // same ack file, same at-most-once and expiry rules, same admin_kill event.
  const INBOX = join(demo, 'garage', 'inbox.json');
  const ACK = join(demo, 'garage', 'inbox.ack.json');
  const readJ = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
  setInterval(() => {
    const inbox = readJ(INBOX);
    if (!inbox?.commands) return;
    let lastId = readJ(ACK)?.lastId ?? 0;
    const t = Math.floor(Date.now() / 1000);
    const out = [];
    for (const cmd of inbox.commands.filter((c) => c.id > lastId).sort((x, y) => x.id - y.id)) {
      lastId = cmd.id;
      writeFileSync(ACK, JSON.stringify({ lastId }));
      const p = roster.find((r) => r.steamId === cmd.steamId);
      const base = { t, type: 'admin_kill', id: cmd.id, steamId: cmd.steamId, reason: cmd.reason };
      if (t > cmd.expiresAt) { out.push({ ...base, ok: false, error: 'expired' }); continue; }
      if (!p) { out.push({ ...base, ok: false, error: 'offline' }); continue; }
      out.push({ ...base, ok: true, species: p.species, growth: p.growth });
      out.push({ t: t + 1, type: 'death', steamId: p.steamId, name: p.name, species: p.species,
                 growth: p.growth, attributed: false, lifeSeconds: t - p.spawnedAt });
      p.hp = 100; p.growth = 0.1; p.spawnedAt = t + 4;
      out.push({ t: t + 4, type: 'spawn', steamId: p.steamId, name: p.name, species: p.species,
                 classPath: classPathOf(p.species), growth: p.growth, loc: { ...p.loc } });
    }
    if (out.length) write(EVENTS, out, true);
  }, 2000);

  setInterval(() => {
    const out = [], snaps = [];
    step(Math.floor(Date.now() / 1000), out, snaps);
    if (out.length) write(EVENTS, out, true);
    write(SNAPS, snaps, true);
  }, 3000);
}
NODE

node "$DEMO/sim.mjs" "$DEMO" history
node "$DEMO/sim.mjs" "$DEMO" live &
FEEDER=$!
trap 'kill $FEEDER 2>/dev/null || true; rm -rf "$DEMO"' EXIT

echo
echo "  panel:  http://127.0.0.1:${PORT}"
echo "  token:  demo-token   (paste it into the admin form to enable writes)"
echo "  stop:   Ctrl-C"
echo

EVENTS_PATH="$DEMO/events.ndjson" \
SNAPSHOTS_PATH="$DEMO/snapshots.ndjson" \
GARAGE_ROOT="$DEMO/garage" \
ADMIN_TOKEN=demo-token \
HTTP_HOST=127.0.0.1 HTTP_PORT="$PORT" POLL_MS=500 \
  node dist/index.js
