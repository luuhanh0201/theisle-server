// Maxima by species and growth, as read on the server (species-stats.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { SpeciesStats, maximaAt } = await import('../dist/species-stats.js');

const REX = 'BP_Tyrannosaurus_C';
const P = '76561190000000001';

test('normal readings by growth; each stat is the value read most often', () => {
  const s = new SpeciesStats();
  s.snapshot(P, 10, REX, 0.5, { health: 4000, hunger: 1300, stamina: 800 });
  s.snapshot(P, 20, REX, 1, { health: 9350, hunger: 3085.5, stamina: 1000 });
  s.snapshot(P, 21, REX, 1, { health: 9350, hunger: 2471, stamina: 801 });   // one odd reading
  s.snapshot(P, 22, REX, 1, { health: 9350, hunger: 3085.5, stamina: 1000 });
  s.snapshot(P, 23, REX, 1, { health: 0, hunger: 0 });                      // still loading: not a reading
  const v = s.view()[REX];
  assert.deepEqual(v.points.map((p) => p.growth), [0.5, 1]);
  assert.deepEqual(v.points[1].max, { health: 9350, hunger: 3085.5, stamina: 1000 });
  assert.equal(v.prime, null);
});

test('prime: only while the events said prime; the highest reading is kept', () => {
  const s = new SpeciesStats();
  s.snapshot(P, 5, REX, 1, { health: 9350, hunger: 3085.5 });
  s.primeState(P, 10, true);
  s.snapshot(P, 11, REX, 1, { health: 9350, hunger: 3085.5 });
  s.snapshot(P, 50, REX, 1, { health: 12274, hunger: 4050.42 });
  s.lifeEnded(P, 60);
  s.snapshot(P, 70, REX, 1, { health: 9350, hunger: 3085.5 });   // a new life: normal again
  const v = s.view()[REX];
  assert.deepEqual(v.prime.max, { health: 12274, hunger: 4050.42 });
  assert.equal(v.prime.readings, 2);
  assert.equal(v.points.length, 1);
  assert.equal(v.points[0].max.health, 9350, 'prime readings never count as normal');
});

test('maximaAt: exact, between two readings, and outside them', () => {
  const pts = [{ growth: 0.25, max: { health: 1000 }, t: 0 }, { growth: 0.75, max: { health: 3000 }, t: 0 }];
  assert.deepEqual(maximaAt(pts, 0.25), { max: { health: 1000 }, exact: true, from: 0.25, to: 0.25 });
  const mid = maximaAt(pts, 0.5);
  assert.equal(mid.max.health, 2000);
  assert.equal(mid.exact, false);
  assert.deepEqual([mid.from, mid.to], [0.25, 0.75]);
  const above = maximaAt(pts, 1);
  assert.equal(above.max.health, 3000);
  assert.equal(above.exact, false, 'beyond the readings: the nearest, not exact');
  assert.equal(maximaAt([], 0.5), null);
});

test("the snapshot's own prime flag wins over the events' times; a usual value above a higher growth's is dropped", () => {
  const s = new SpeciesStats();
  const CROC = 'BP_Deinosuchus_C';
  // No prime event seen yet, but the snapshot says prime: kept apart.
  s.snapshot(P, 10, CROC, 0.88, { health: 10931 }, true);
  s.snapshot(P, 11, CROC, 1, { health: 9500 }, false);
  // An old snapshot (no flag) whose prime event came late: passed for usual.
  s.snapshot(P, 12, CROC, 0.9, { health: 10823 });
  s.snapshot(P, 13, CROC, 0.75, { health: 7943 });
  const v = s.view()[CROC];
  assert.equal(v.prime.max.health, 10931);
  assert.deepEqual(v.points.map((p) => [p.growth, p.max.health]), [[0.75, 7943], [1, 9500]],
    'maxima only grow with growth: 10,823 at 90 % is a prime value');
});

test('lab numbers (species-lab.ts): what SetGrowth gives, stomach from the diet ratio, blood = health', async () => {
  const { labPoints } = await import('../dist/species-lab.js');
  const rex = labPoints('BP_Tyrannosaurus_C');
  assert.ok(rex && rex.length === 7);
  const at = maximaAt(rex, 0.75);
  assert.equal(at.max.health, 9350);
  assert.equal(at.max.blood, 9350);
  assert.equal(at.max.hunger, Math.round(9350 * 0.33 * 100) / 100, 'meat eater: stomach = 0.33 x health');
  assert.equal(maximaAt(labPoints('BP_Triceratops_C'), 1).max.hunger, 4750, 'plant eater: 0.5 x health');
  assert.equal(maximaAt(rex, 0.45).exact, false, 'between two lab growths: an estimate');
  assert.equal(labPoints('BP_Oviraptor_C'), null, 'not in this build: no lab numbers');
});
