// Store aggregation tests. Runs against the compiled output: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../dist/store.js';
import { parseEvent } from '../dist/events.js';

const A = '76561198000000001';
const B = '76561198000000002';
const now = () => Math.floor(Date.now() / 1000);

function feed(store, events) {
  for (const raw of events) {
    const e = parseEvent(raw);
    assert.notEqual(e, null, `rejected: ${JSON.stringify(raw)}`);
    store.apply(e);
  }
}

test('parseEvent rejects unknown types and missing required fields', () => {
  assert.equal(parseEvent({ t: 1, type: 'nope' }), null);
  assert.equal(parseEvent({ t: 1, type: 'chat', steamId: A }), null);
  assert.equal(parseEvent({ t: 1, type: 'toString' }), null);
  assert.notEqual(parseEvent({ t: 1, type: 'chat', steamId: A, message: 'hi' }), null);
});

test('kills, deaths, biggest prey and killfeed', () => {
  const s = new Store();
  const t = now();
  feed(s, [
    { t, type: 'session_start', steamId: A, name: 'Alpha' },
    { t, type: 'session_start', steamId: B, name: 'Bravo' },
    { t: t + 1, type: 'damage', attacker: A, victim: B, amount: 40 },
    { t: t + 2, type: 'death', steamId: B, species: 'BP_Tenontosaurus_C', growth: 0.8,
      killer: A, killerSpecies: 'BP_Carnotaurus_C', attributed: true, lifeSeconds: 600 },
    { t: t + 3, type: 'death', steamId: A, species: 'BP_Carnotaurus_C', growth: 1,
      attributed: false },
  ]);
  const a = s.player(A).player;
  const b = s.player(B).player;
  assert.equal(a.kills, 1);
  assert.equal(a.deaths, 1);
  assert.equal(b.deaths, 1);
  assert.equal(b.longestLife, 600);
  assert.equal(a.biggestKill.species, 'BP_Tenontosaurus_C');
  assert.equal(a.damageDealt, 40);
  assert.equal(b.damageTaken, 40);

  assert.equal(s.killfeed(10).length, 2);
  const board = s.leaderboard();
  assert.equal(board.kills[0].steamId, A);
  assert.deepEqual(board.biggestPrey.map((k) => k.species), ['BP_Tenontosaurus_C']);
  assert.equal(board.biggestPrey[0].killerName, 'Alpha');
});

test('a death right after !store is labelled, not counted', () => {
  const s = new Store();
  const t = now();
  feed(s, [
    { t, type: 'garage_store', steamId: A, slot: 'default', species: 'X', growth: 1 },
    { t: t + 4, type: 'death', steamId: A, species: 'X', growth: 1, attributed: false },
  ]);
  assert.equal(s.player(A).player.deaths, 0);
  assert.equal(s.killfeed(10).length, 0);
  assert.equal(s.feed(10, new Set(['death']))[0].cause, 'garage');
});

test('sessions: playtime, online, and a crash without session_end', () => {
  const s = new Store();
  const t = now() - 10_000;
  feed(s, [
    { t, type: 'session_start', steamId: A },
    { t: t + 100, type: 'snapshot', steamId: A, species: 'X', health: 1, stamina: 1,
      hunger: 1, thirst: 1, growth: 1 },
    // server died here; next start is an hour later with no session_end
    { t: t + 3700, type: 'session_start', steamId: A },
    { t: t + 3760, type: 'session_end', steamId: A, duration: 60 },
  ]);
  const p = s.player(A).player;
  assert.equal(p.sessions, 2);
  assert.equal(p.playtime, 100 + 60, 'downtime must not count as playtime');
  assert.equal(p.online, false);
});

test('online needs an open session and recent activity; map lists positions', () => {
  const s = new Store();
  const t = now();
  feed(s, [
    { t, type: 'session_start', steamId: A, name: 'Alpha' },
    { t, type: 'snapshot', steamId: A, species: 'X', health: 50, stamina: 1, hunger: 1,
      thirst: 1, growth: 0.5, loc: { x: 10, y: 20, z: 0 } },
    { t: t + 1, type: 'snapshot', steamId: A, species: 'X', health: 50, stamina: 1,
      hunger: 1, thirst: 1, growth: 0.5, loc: { x: 1500, y: 25, z: 0 } },
    // B: open session but last heard long ago (replayed from an old file)
    { t: t - 5000, type: 'session_start', steamId: B },
  ]);
  assert.deepEqual(s.online().map((p) => p.steamId), [A]);
  const map = s.map();
  assert.equal(map.length, 1);
  assert.deepEqual(map[0].loc, { x: 1500, y: 25, z: 0 });
  assert.equal(map[0].trail.length, 2);

  feed(s, [{ t: t + 2, type: 'spawn', steamId: A, species: 'Y', growth: 0.1 }]);
  assert.equal(s.map()[0].trail.length, 0, 'a new life starts a new trail');
});

test('chat and per-player timeline', () => {
  const s = new Store();
  const t = now();
  feed(s, [
    { t, type: 'chat', steamId: A, name: 'Alpha', message: 'hi' },
    { t: t + 1, type: 'damage', attacker: A, victim: 'ai', amount: 5 },
    { t: t + 2, type: 'growth', steamId: A, species: 'X', milestone: 0.5, growth: 0.5 },
  ]);
  assert.equal(s.chat(10)[0].message, 'hi');
  const tl = s.player(A).timeline.map((e) => e.type);
  assert.deepEqual(tl, ['growth', 'damage', 'chat'], 'newest first');
  assert.equal(s.player('ai'), null);
});

test('feed filter by type', () => {
  const s = new Store();
  const t = now();
  feed(s, [
    { t, type: 'chat', steamId: A, message: 'x' },
    { t, type: 'spawn', steamId: A, species: 'X', growth: 0.1 },
  ]);
  assert.deepEqual(s.feed(10, new Set(['spawn'])).map((e) => e.type), ['spawn']);
  assert.equal(s.feed(10).length, 2);
});

test('replay order: a snapshot from a past life does not join the new trail', () => {
  const s = new Store();
  const t = now();
  const snap = (dt, x) => ({ t: t + dt, type: 'snapshot', steamId: A, species: 'X', health: 50,
    stamina: 1, hunger: 1, thirst: 1, growth: 1, loc: { x, y: 0 } });
  // events.ndjson is read first on a replay, snapshots.ndjson after it.
  feed(s, [
    { t, type: 'session_start', steamId: A, name: 'Alpha' },
    { t: t + 10, type: 'spawn', steamId: A, species: 'X', growth: 0.1, loc: { x: 900, y: 0 } },
    snap(0, 1), snap(5, 2000), snap(10, 900), snap(15, 1300),
  ]);
  assert.deepEqual(s.map()[0].trail.map((l) => l.x), [900, 1300]);
});

test('trail: only real movement (>= 2 m) is recorded, each point with its time', () => {
  const s = new Store();
  const t = now();
  const snap = (dt, x, y = 0) => ({ t: t + dt, type: 'snapshot', steamId: A, species: 'X', health: 50,
    stamina: 1, hunger: 1, thirst: 1, growth: 1, loc: { x, y, z: 0 } });
  feed(s, [
    { t, type: 'session_start', steamId: A, name: 'Alpha' },
    { t, type: 'spawn', steamId: A, species: 'X', growth: 0.1, loc: { x: 0, y: 0 } },
    snap(5, 0), snap(10, 50), snap(15, 120, 90), snap(20, 150, 160), snap(25, 500, 160),
  ]);
  const trail = s.map()[0].trail;
  assert.deepEqual(trail.map((l) => [l.x, l.y]), [[0, 0], [150, 160], [500, 160]],
    'standing still and small shuffles are not new points');
  assert.deepEqual(trail.map((l) => l.t), [t + 5, t + 20, t + 25]);
  assert.equal(s.map()[0].loc.x, 500, 'the dot itself still follows every snapshot');
});

test('whole-life path: kept per life, apart from the live trail', () => {
  const s = new Store();
  const t = now();
  const snap = (dt, x) => ({ t: t + dt, type: 'snapshot', steamId: A, species: 'X', health: 50,
    stamina: 1, hunger: 1, thirst: 1, growth: 1, loc: { x, y: 0, z: 0 } });
  feed(s, [
    { t, type: 'session_start', steamId: A, name: 'Alpha' },
    { t, type: 'spawn', steamId: A, species: 'X', growth: 0.1 },
    snap(5, 0), snap(10, 1000), snap(15, 2000),
    { t: t + 20, type: 'death', steamId: A, species: 'X', growth: 0.1 },
    { t: t + 30, type: 'spawn', steamId: A, species: 'Y', growth: 0.1 },
    snap(35, 9000), snap(40, 9500),
  ]);
  assert.deepEqual(s.path(A, t).map((p) => p.x), [0, 1000, 2000], 'the first life, whole');
  assert.deepEqual(s.path(A, t + 30).map((p) => p.x), [9000, 9500]);
  assert.equal(s.path(A, t + 999), null, 'unknown life');
  assert.deepEqual(s.map()[0].trail.map((p) => p.x), [9000, 9500], 'the live trail is the current life only');
});

test('whole-life path: a long life halves its resolution, it does not lose the start', () => {
  const s = new Store();
  const t = now();
  feed(s, [
    { t, type: 'session_start', steamId: A, name: 'Alpha' },
    { t, type: 'spawn', steamId: A, species: 'X', growth: 0.1 },
  ]);
  const n = 4100; // PATH_MAX_POINTS defaults to 4000
  for (let i = 0; i < n; i++) {
    s.apply({ t: t + 1 + i, type: 'snapshot', steamId: A, species: 'X', health: 50, stamina: 1,
      hunger: 1, thirst: 1, growth: 1, loc: { x: i * 300, y: 0, z: 0 } });
  }
  const path = s.path(A, t);
  assert.ok(path.length <= 4000 && path.length > 2000, `halved once: ${path.length}`);
  assert.equal(path[0].x, 0, 'the start is kept');
  assert.equal(path[path.length - 1].x, (n - 1) * 300, 'the latest point is kept');
});

test('whole-life path: only the last 5 lives are kept', () => {
  const s = new Store();
  const t = now();
  const events = [{ t, type: 'session_start', steamId: A, name: 'Alpha' }];
  for (let life = 0; life < 7; life++) {
    const at = t + life * 100;
    events.push({ t: at, type: 'spawn', steamId: A, species: 'X', growth: 0.1 },
      { t: at + 1, type: 'snapshot', steamId: A, species: 'X', health: 50, stamina: 1, hunger: 1,
        thirst: 1, growth: 1, loc: { x: life, y: 0, z: 0 } });
  }
  feed(s, events);
  assert.equal(s.path(A, t), null, 'oldest dropped');
  assert.equal(s.path(A, t + 100), null);
  assert.equal(s.path(A, t + 200).length, 1);
  assert.equal(s.path(A, t + 600).length, 1);
});

test('garage events get the display name the bridge already knows', () => {
  const s = new Store();
  const t = now();
  feed(s, [
    { t, type: 'session_start', steamId: A, name: 'Alpha' },
    { t: t + 1, type: 'garage_store', steamId: A, slot: 'x', species: 'X', growth: 1 },
  ]);
  assert.equal(s.feed(1)[0].name, 'Alpha');
});

test('lives: one record per dino, with kills, damage and how it ended', () => {
  const s = new Store();
  const t = now();
  feed(s, [
    { t, type: 'session_start', steamId: A, name: 'Alpha' },
    { t, type: 'session_start', steamId: B, name: 'Bravo' },
    { t: t + 1, type: 'spawn', steamId: A, species: 'Carno', growth: 0.5 },
    { t: t + 1, type: 'spawn', steamId: B, species: 'Tenon', growth: 0.3 },
    { t: t + 5, type: 'snapshot', steamId: A, species: 'Carno', health: 90, stamina: 1,
      hunger: 1, thirst: 1, growth: 0.6 },
    { t: t + 6, type: 'damage', attacker: A, victim: B, amount: 50 },
    { t: t + 7, type: 'death', steamId: B, species: 'Tenon', growth: 0.35, attributed: true,
      killer: A, killerSpecies: 'Carno' },
    { t: t + 20, type: 'garage_store', steamId: A, slot: 'main', species: 'Carno', growth: 0.6 },
    { t: t + 23, type: 'death', steamId: A, species: 'Carno', growth: 0.6, attributed: false },
    { t: t + 40, type: 'spawn', steamId: A, species: 'Carno', growth: 0.1 },
    { t: t + 50, type: 'garage_redeem', steamId: A, slot: 'main', species: 'Carno', growth: 0.6, ok: true },
  ]);

  const [current, first] = s.player(A).lives;   // newest first
  assert.equal(first.species, 'Carno');
  assert.equal(first.growthStart, 0.5);
  assert.equal(first.growth, 0.6);
  assert.equal(first.kills, 1);
  assert.equal(first.damageDealt, 50);
  assert.equal(first.end, 'garage');
  assert.equal(current.end, null, 'still alive');
  assert.equal(current.redeemedFrom, 'main');
  assert.equal(current.growth, 0.6);

  const [bLife] = s.player(B).lives;
  assert.equal(bLife.end, 'death');
  assert.equal(bLife.killerName, 'Alpha');
  assert.equal(bLife.damageTaken, 50);
  assert.equal(bLife.endedAt - bLife.spawnedAt, 6);
});

test('catalog learns real class paths and mutations from spawns and picks', () => {
  const s = new Store();
  const t = now();
  const CP = 'BlueprintGeneratedClass /Game/Dino/BP_Carno.BP_Carno_C';
  feed(s, [
    { t, type: 'spawn', steamId: A, species: 'BP_Carno_C', classPath: CP, growth: 0.1,
      mutations: { Slot1: 'MUT_A', ParentSlot1: 'MUT_P', ElderSlot2B: 'MUT_E', Weird: 'MUT_X' } },
    { t: t + 5, type: 'mutation', steamId: A, species: 'BP_Carno_C', slot: 'Slot2', to: 'MUT_B' },
    { t: t + 6, type: 'snapshot', steamId: B, species: 'BP_Tenon_C', health: 1, stamina: 1,
      hunger: 1, thirst: 1, growth: 1 },
  ]);
  const [carno, tenon] = s.catalog.list();
  assert.equal(carno.classPath, CP);
  assert.deepEqual(carno.mutations, { active: ['MUT_A', 'MUT_B'], parent: ['MUT_P'], elder: ['MUT_E'] });
  assert.equal(tenon.species, 'BP_Tenon_C');
  assert.equal(tenon.classPath, null, 'short name only: not creatable yet');
});

test('a death right after a successful admin_kill is labelled admin, not counted', () => {
  const s = new Store();
  const t = now();
  feed(s, [
    { t, type: 'session_start', steamId: A, name: 'Alpha' },
    { t, type: 'spawn', steamId: A, species: 'X', growth: 1 },
    { t: t + 1, type: 'admin_kill', id: 1, steamId: A, ok: true, reason: 'x' },
    { t: t + 5, type: 'death', steamId: A, species: 'X', growth: 1, attributed: false },
    // A failed command must not excuse the next real death.
    { t: t + 20, type: 'spawn', steamId: A, species: 'X', growth: 1 },
    { t: t + 21, type: 'admin_kill', id: 2, steamId: A, ok: false, error: 'no_dino' },
    { t: t + 25, type: 'death', steamId: A, species: 'X', growth: 1, attributed: false },
  ]);
  const p = s.player(A);
  assert.equal(p.player.deaths, 1, 'only the real death counts');
  assert.deepEqual(p.lives.map((l) => l.end), ['death', 'admin']);
  assert.equal(s.feed(20, new Set(['admin_kill']))[0].name, 'Alpha');
  assert.equal(s.feed(20, new Set(['death']))[1].cause, 'admin');
});

test('catalog keeps evidence per species and confirms only where seen', () => {
  const s = new Store();
  const t = now();
  feed(s, [
    { t, type: 'spawn', steamId: A, species: 'BP_Carno_C', classPath: 'X.BP_Carno_C', growth: 1,
      mutations: { Slot1: 'MUT_A' } },
    { t: t + 10, type: 'spawn', steamId: B, species: 'BP_Carno_C', classPath: 'X.BP_Carno_C', growth: 1,
      mutations: { ParentSlot1: 'MUT_A' } },
    { t: t + 20, type: 'mutation', steamId: A, species: 'BP_Tenon_C', slot: 'Slot1', to: 'MUT_T' },
  ]);
  const carno = s.catalog.list().find((c) => c.species === 'BP_Carno_C');
  assert.deepEqual(carno.evidence.MUT_A, { count: 2, players: 2, lastSeen: t + 10, groups: ['active', 'parent'] });
  assert.equal(s.catalog.confirms('BP_Carno_C', 'MUT_A'), true);
  assert.equal(s.catalog.confirms('BP_Carno_C', 'MUT_T'), false, 'seen only on another species');
  assert.equal(s.catalog.knows('MUT_T'), true);
  assert.equal(s.catalog.knows('MUT_NOPE'), false);
});

test('web garage commands: results kept, but no player invented for an unknown SteamID', () => {
  const s = new Store();
  const t = now();
  const STRANGER = '76561190000000042';
  s.apply({ type: 'portal_command', t, id: 7, steamId: STRANGER, action: 'store', ok: false, error: 'offline' });
  assert.equal(s.player(STRANGER), null, 'not in the players list');
  assert.equal(s.commandResult(STRANGER, 7).error, 'offline', 'the web can still read its answer');
  feed(s, [{ t, type: 'session_start', steamId: A, name: 'Alpha' }]);
  s.apply({ type: 'portal_command', t, id: 8, steamId: A, action: 'store', ok: true, messages: ['x'] });
  assert.equal(s.player(A).timeline[0].type, 'portal_command', 'a known player gets it in their timeline');
});
