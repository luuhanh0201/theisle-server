// The scene of a death (panel log → 📍): who stood near, the fight it ended. npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KillScenes } from '../dist/kill-scene.js';
import { parseEvent } from '../dist/events.js';

const V = '76561198000000001';   // dies
const K = '76561198000000002';   // kills
const N = '76561198000000003';   // stands 150 m away, bites the victim too
const F = '76561198000000004';   // 300 m away: not in the scene
const O = '76561198000000005';   // near, but its snapshot is a minute old
const T = 2_000_000_000;

const snap = (steamId, t, x, y, extra = {}) => ({ t, type: 'snapshot', steamId, species: 'BP_Carnotaurus_C', health: 50,
  stamina: 1, hunger: 1, thirst: 1, growth: 0.8, loc: { x, y }, name: `P${steamId.slice(-1)}`, ...extra });
const hit = (t, attacker, victim, amount, bite, tick = 1) => ({ t, type: 'damage', attacker, victim, amount, bite, tick });

async function scenes(events, startedAt = T - 100) {
  const dir = await mkdtemp(join(tmpdir(), 'kill-scene-'));
  const path = join(dir, 'kill-scenes.ndjson');
  const ks = new KillScenes(path, startedAt);
  await ks.load();
  for (const raw of events) {
    const e = parseEvent(raw);
    assert.notEqual(e, null, JSON.stringify(raw));
    await ks.handle(e);
  }
  return { ks, path };
}

const death = { t: T, type: 'death', steamId: V, name: 'Victim', species: 'BP_Tenontosaurus_C', growth: 0.6,
  loc: { x: 100000, y: 200000 }, killer: K, killerSpecies: 'BP_Carnotaurus_C', attributed: true };

test('the players near the death, from their last snapshot; the killer always', async () => {
  const { ks } = await scenes([
    snap(O, T - 60, 100500, 200000),
    snap(K, T - 3, 100000 + 30000, 200000),          // 300 m: far, but the killer
    snap(N, T - 2, 100000, 200000 + 15000),          // 150 m
    snap(F, T - 2, 100000 + 30000, 200000 + 1000),   // ~300 m
    death,
  ]);
  const s = ks.get(V, T);
  assert.ok(s);
  const byId = Object.fromEntries(s.players.map((p) => [p.steamId, p]));
  assert.equal(byId[V].role, 'victim');
  assert.equal(byId[V].dist, 0);
  assert.equal(byId[N].role, 'near');
  assert.equal(byId[N].dist, 150);
  assert.equal(byId[N].growth, 0.8);
  assert.equal(byId[N].name, 'P3');
  assert.equal(byId[K].role, 'killer', 'the killer is in it even 300 m away');
  assert.equal(byId[F], undefined, 'past 200 m: not in it');
  assert.equal(byId[O], undefined, 'a position a minute old is not where they stood');
  assert.deepEqual(s.players.map((p) => p.steamId), [V, N, K], 'nearest first');
});

test('the fight: damage dealt and taken per dino, hold bites summed, AI and an earlier fight left out', async () => {
  const { ks } = await scenes([
    hit(T - 200, F, V, 50, 'old'),            // an earlier fight, 170 s before this one
    hit(T - 30, K, V, 40, 'k1'),
    hit(T - 30, K, V, 38, 'k1', 2),          // the same hold bite
    hit(T - 20, V, K, 25, 'v1'),
    hit(T - 15, N, V, 10, 'n1'),
    hit(T - 10, 'ai', V, 99, 'a1'),
    hit(T - 8, V, 'ai', 99, 'a2'),
    hit(T - 5, N, F, 7, 'nf'),               // N fights F too: F is in the fight through N
    hit(T - 1, K, V, 30, 'k2'),
    death,
  ]);
  const { fight } = ks.get(V, T);
  assert.equal(fight.from, T - 30);
  assert.equal(fight.to, T - 1);
  const row = Object.fromEntries(fight.rows.map((r) => [r.steamId, r]));
  assert.deepEqual([row[K].dealt, row[K].taken, row[K].hits], [108, 25, 2]);
  assert.deepEqual([row[V].dealt, row[V].taken, row[V].hitsTaken], [25, 118, 3]);
  assert.deepEqual([row[N].dealt, row[N].taken], [17, 0]);
  assert.deepEqual([row[F].dealt, row[F].taken], [0, 7], 'the earlier 50 is not in this fight');
  assert.equal(fight.rows[0].steamId, K, 'most damage first');
  assert.equal(fight.hits.length, 5, 'one line per bite');
  assert.deepEqual(fight.hits[0], { t: T - 30, attacker: K, victim: V, amount: 78, ticks: 2 });
  assert.ok(fight.hits.every((h) => h.attacker !== 'ai' && h.victim !== 'ai'));
});

test('no hits: no fight; a replayed death gets no scene', async () => {
  const { ks } = await scenes([{ ...death, t: T - 500 }, { ...death, killer: undefined, attributed: false }]);
  assert.equal(ks.get(V, T - 500), null, 'before the bridge started: a replay');
  assert.equal(ks.get(V, T).fight, null);
  assert.equal(ks.get(V, T).killer, null);
});

test('saved to the file and read back after a restart', async () => {
  const { path } = await scenes([snap(N, T - 2, 100000, 201000), death]);
  const lines = (await readFile(path, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
  await writeFile(path, lines[0] + '\n{torn\n', 'utf8');
  const again = new KillScenes(path, T + 1000);
  await again.load();
  const s = again.get(V, T);
  assert.ok(s, 'loaded');
  assert.equal(s.players.length, 2);
  assert.equal(again.get(V, T + 1), null);
});
