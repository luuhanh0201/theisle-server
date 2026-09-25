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
