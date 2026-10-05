// A player's lives from StatsLogger's events (life-history.ts), and one put back
// in the garage as it was before it died.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'life-history-test-'));
process.env.DATA_DIR = join(root, 'data');
process.env.GARAGE_ROOT = join(root, 'garage');
process.env.EVENTS_PATH = join(root, 'events.ndjson');
mkdirSync(process.env.GARAGE_ROOT, { recursive: true });
after(() => rmSync(root, { recursive: true, force: true }));

const P = '76561198000000041';
const Q = '76561198000000042';
const REX = 'BlueprintGeneratedClass /Game/TheIsle/Core/Characters/Dinosaurs/Tyrannosaurus/BP_Tyrannosaurus.BP_Tyrannosaurus_C';
const conds = (on) => Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), on.includes(i + 1)]));
const events = [
  { type: 'spawn', t: 100, steamId: P, species: 'BP_Tyrannosaurus_C', classPath: REX, growth: 0.25, mutations: { Slot1: 'Hydrodynamic' },
    unlockedMutations: ['Traumatic Thrombosis', 'Multichambered Lungs'] },
  { type: 'mutation_unlocks', t: 115, steamId: P, species: 'BP_Tyrannosaurus_C', unlocked: ['Traumatic Thrombosis', 'Multichambered Lungs', 'Reniculate Kidneys'] },
  { type: 'prime', t: 110, steamId: P, species: 'BP_Tyrannosaurus_C', growth: 0.3, conditions: conds([1, 3, 7, 8]), eligible: false, prime: false, elderStacks: 0 },
  { type: 'mutation', t: 120, steamId: P, species: 'BP_Tyrannosaurus_C', slot: 'Slot2', to: 'Gastronomic Regeneration' },
  { type: 'skin', t: 121, steamId: P, species: 'BP_Tyrannosaurus_C', skin: { colors: { Body: { r: 0.5, g: 0.2, b: 0.1 } }, patternIndex: 1, female: true } },
  { type: 'prime', t: 200, steamId: P, species: 'BP_Tyrannosaurus_C', growth: 0.78, conditions: conds([1, 3, 5, 6, 7, 8]), eligible: true, prime: true, elderStacks: 2 },
  { type: 'death', t: 300, steamId: P, species: 'BP_Tyrannosaurus_C', growth: 0.79 },
  { type: 'spawn', t: 400, steamId: P, species: 'BP_Triceratops_C', classPath: 'X.BP_Triceratops_C', growth: 0.25, mutations: {} },
  { type: 'prime', t: 410, steamId: '76561198000000099', species: 'BP_Triceratops_C', growth: 0.9, conditions: conds([1, 2, 3, 4, 5]) },
  // Q: a prime at 100 % reborn (chuyển sinh), young again 6 s later, one more elder stack.
  { type: 'spawn', t: 500, steamId: Q, species: 'BP_Tyrannosaurus_C', classPath: REX, growth: 0.25, mutations: {} },
  { type: 'prime', t: 900, steamId: Q, species: 'BP_Tyrannosaurus_C', growth: 1, conditions: conds([3, 5, 6, 8]), eligible: true, prime: true, elderStacks: 2 },
  { type: 'death', t: 1000, steamId: Q, species: 'BP_Tyrannosaurus_C', growth: 1 },
  { type: 'spawn', t: 1006, steamId: Q, species: 'BP_Tyrannosaurus_C', classPath: REX, growth: 0.25, mutations: {} },
  { type: 'prime', t: 1006, steamId: Q, species: 'BP_Tyrannosaurus_C', growth: 0.25, conditions: conds([]), eligible: false, prime: false, elderStacks: 3 },
];
writeFileSync(process.env.EVENTS_PATH, events.map((e) => JSON.stringify(e)).join('\n') + '\n');

const { lifeDetails, restoreLife } = await import('../dist/life-history.js');

test('lives: newest first; mutations, the last prime tasks, skin, sex and growth at death', async () => {
  const lives = await lifeDetails(P);
  assert.deepEqual(lives.map((l) => [l.species, l.end]), [['BP_Triceratops_C', null], ['BP_Tyrannosaurus_C', 'death']]);
  const rex = lives[1];
  assert.equal(rex.growth, 0.79);
  assert.deepEqual(rex.mutations, { Slot1: 'Hydrodynamic', Slot2: 'Gastronomic Regeneration' });
  assert.deepEqual(rex.prime, { code: '1010111100', done: 6, eligible: true, prime: true, elderStacks: 2 });
  assert.equal(rex.female, true);
  assert.equal(lives[0].prime, null, 'another player\'s event is not theirs');
});

test('restore: into the garage as it was, then never twice; a living dino is refused', async () => {
  const { slot } = await restoreLife(P, 100, 'khoiphuc-100');
  const state = JSON.parse(readFileSync(join(process.env.GARAGE_ROOT, 'stored', `${P}__khoiphuc-100.json`), 'utf8'));
  assert.equal(slot, 'khoiphuc-100');
  assert.equal(state.classPath, REX);
  assert.equal(state.growth, 0.79);
  assert.deepEqual(state.mutations, { Slot1: 'Hydrodynamic', Slot2: 'Gastronomic Regeneration' });
  assert.equal(state.primeData.cond5, true);
  assert.equal(state.primeData.cond2, false);
  assert.equal(state.primeData.eligible, true);
  assert.equal(state.isPrime, true, 'it was prime, past 75 %');
  assert.equal(state.elderStacks, 2);
  assert.equal(state.isFemale, true);
  assert.deepEqual(state.skin, { colors: { Body: { r: 0.5, g: 0.2, b: 0.1 } }, patternIndex: 1, female: true });
  assert.deepEqual(state.unlockedMutations, ['Traumatic Thrombosis', 'Multichambered Lungs', 'Reniculate Kidneys'],
    'the quest mutations it had unlocked go with it (hidden and dead without them)');
  assert.equal((await lifeDetails(P))[1].restoredTo, 'khoiphuc-100');
  await assert.rejects(() => restoreLife(P, 100, 'again'), /already restored/);
  await assert.rejects(() => restoreLife(P, 400, 'alive'), /still alive/);
  await assert.rejects(() => restoreLife(P, 999, 'x'), /no such life/);
});

test('chuyển sinh: the reborn prime\'s life ends in "rebirth", and it is not restored (it lives on)', async () => {
  const lives = await lifeDetails(Q);
  assert.deepEqual(lives.map((l) => l.end), [null, 'rebirth']);
  await assert.rejects(() => restoreLife(Q, 500, 'khoiphuc-500'), /reborn/);
});
