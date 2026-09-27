// Prime condition 5 for every species (migration-credit.ts): a dino a minute in
// an active migration zone that the game did not credit gets it, once.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { MigrationCredit, activeMigrationZones, zoneAt, MIGRATION_DWELL_S, PENDING_S } = await import('../dist/migration-credit.js');

const square = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]];
const spawners = [
  { id: 1, c: 'BP_EdiblePlantsSpawnable_C', x: 500, y: 500, shape: { spline: square }, migration: true, active: true },
  { id: 2, c: 'BP_EdiblePlantsSpawnable_C', x: 5500, y: 500, shape: { spline: square.map(([x, y]) => [x + 5000, y]) }, migration: true, active: false },
  { id: 3, c: 'BP_EdiblePlantsSpawnable_C', x: 9000, y: 0, shape: { sphere: { x: 9000, y: 0, r: 300 } }, migration: true, mass: true },
  { id: 4, c: 'BP_EdiblePlantsSpawnable_C', x: 20000, y: 0, shape: { box: { x: 20000, y: 0, ex: 100, ey: 400, yaw: 90 } }, migration: true, active: true },
];
const zones = activeMigrationZones(spawners);
const conds = (on) => Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), on.includes(i + 1)]));
const deino = (over = {}) => ({ steamId: '76561198658463561', species: 'BP_Deinosuchus_C', growth: 0.53, x: 500, y: 500,
  conditions: conds([3, 7, 8, 10]), ...over });

test('active zones only, each shape', () => {
  assert.deepEqual(zones.map((z) => z.id), [1, 3, 4]);
  assert.equal(zoneAt(zones, 500, 500)?.id, 1);
  assert.equal(zoneAt(zones, 5500, 500), null, 'an inactive zone does not count');
  assert.equal(zoneAt(zones, 9100, 100)?.id, 3, 'a mass migration sphere');
  assert.equal(zoneAt(zones, 20300, 0)?.id, 4, 'a box turned 90°: 4 m along X');
  assert.equal(zoneAt(zones, 20000, 300), null);
});

test('a minute inside without condition 5: given once, eligible with the fifth', () => {
  const mc = new MigrationCredit();
  assert.deepEqual(mc.tick(1000, [deino()], zones), [], 'just arrived');
  assert.deepEqual(mc.tick(1000 + MIGRATION_DWELL_S - 1, [deino()], zones), []);
  const fixes = mc.tick(1000 + MIGRATION_DWELL_S, [deino()], zones);
  assert.equal(fixes.length, 1);
  assert.deepEqual({ ...fixes[0], note: undefined }, { steamId: '76561198658463561', species: 'BP_Deinosuchus_C',
    minGrowth: 0.48, maxGrowth: 0.75, conditions: '0000100000', eligible: true, days: 1, note: undefined });
  assert.deepEqual(mc.tick(1000 + MIGRATION_DWELL_S + 10, [deino()], zones), [], 'not twice while the game has not reported it');
  assert.equal(mc.tick(1000 + MIGRATION_DWELL_S + PENDING_S, [deino()], zones).length, 1, 'again if it never came');
});

test('nothing when the game gave it, outside, leaving resets, past 75 %, fewer than five', () => {
  const mc = new MigrationCredit();
  const has5 = deino({ conditions: conds([3, 5, 7, 8, 10]) });
  mc.tick(0, [has5], zones);
  assert.deepEqual(mc.tick(100, [has5], zones), []);
  const out = deino({ x: 5500 });
  mc.tick(0, [out], zones);
  assert.deepEqual(mc.tick(100, [out], zones), [], 'in an inactive zone');
  const b = new MigrationCredit();
  b.tick(0, [deino()], zones);
  b.tick(30, [deino({ x: -500 })], zones);
  b.tick(40, [deino()], zones);
  assert.deepEqual(b.tick(90, [deino()], zones), [], 'left for a moment: the minute starts again');
  assert.equal(b.tick(100, [deino()], zones).length, 1);
  const old = new MigrationCredit();
  old.tick(0, [deino({ growth: 0.8 })], zones);
  assert.deepEqual(old.tick(100, [deino({ growth: 0.8 })], zones), [], 'prime is already decided');
  const young = new MigrationCredit();
  young.tick(0, [deino({ conditions: conds([7, 8]) })], zones);
  const f = young.tick(100, [deino({ conditions: conds([7, 8]) })], zones);
  assert.equal(f.length, 1);
  assert.equal(f[0].eligible, undefined, 'three conditions: not eligible, left to the game');
});

test('another species: the minute starts again', () => {
  const mc = new MigrationCredit();
  mc.tick(0, [deino()], zones);
  assert.deepEqual(mc.tick(100, [deino({ species: 'BP_Triceratops_C' })], zones), []);
  assert.equal(mc.tick(160, [deino({ species: 'BP_Triceratops_C' })], zones).length, 1);
});
