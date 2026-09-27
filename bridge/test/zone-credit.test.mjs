// The zone prime tasks for every species (zone-credit.ts): a minute in the
// game's sanctuary / active migration / patrol zone that the game did not
// credit gives that task, once.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { ZoneCredit, taskZones, zoneAt, DWELL_S, PENDING_S } = await import('../dist/zone-credit.js');

const square = (x0) => [[x0, 0], [x0 + 1000, 0], [x0 + 1000, 1000], [x0, 1000]];
const sp = (id, x0, flags, shape) => ({ id, c: 'BP_EdiblePlantsSpawnable_C', x: x0 + 500, y: 500, shape: shape ?? { spline: square(x0) }, ...flags });
const spawners = [
  sp(1, 0, { migration: true, active: true }),                         // an active migration zone
  sp(2, 5000, { migration: true, active: false }),                     // inactive: not a migration zone now
  sp(3, 10000, { migration: true, active: false, patrol: true }),      // a patrol zone
  sp(4, 15000, { migration: true, active: true, juvenile: true }),     // a sanctuary (active migration too)
  sp(5, 0, { migration: true, mass: true }, { sphere: { x: 30000, y: 0, r: 300 } }),
  sp(6, 0, { migration: true, active: true }, { box: { x: 40000, y: 0, ex: 100, ey: 400, yaw: 90 } }),
];
const zones = taskZones(spawners);
const conds = (on) => Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), on.includes(i + 1)]));
const deino = (over = {}) => ({ steamId: '76561198658463561', species: 'BP_Deinosuchus_C', growth: 0.53, x: 500, y: 500,
  conditions: conds([3, 7, 8, 10]), ...over });

test('each task has the game\'s own zones, each shape', () => {
  assert.deepEqual(zones.get('5').map((z) => z.id), [1, 4, 5, 6]);
  assert.deepEqual(zones.get('6').map((z) => z.id), [3]);
  assert.deepEqual(zones.get('1').map((z) => z.id), [4]);
  assert.equal(zoneAt(zones.get('5'), 5500, 500), null, 'an inactive migration zone does not count');
  assert.equal(zoneAt(zones.get('5'), 30100, 100)?.id, 5, 'a mass migration sphere');
  assert.equal(zoneAt(zones.get('5'), 40300, 0)?.id, 6, 'a box turned 90°: 4 m along X');
  assert.equal(zoneAt(zones.get('5'), 40000, 300), null);
});

test('a minute in a migration zone without task 5: given once, eligible with the fifth', () => {
  const zc = new ZoneCredit();
  assert.deepEqual(zc.tick(1000, [deino()], zones), [], 'just arrived');
  assert.deepEqual(zc.tick(1000 + DWELL_S - 1, [deino()], zones), []);
  const fixes = zc.tick(1000 + DWELL_S, [deino()], zones);
  assert.equal(fixes.length, 1);
  assert.deepEqual({ ...fixes[0], note: undefined }, { steamId: '76561198658463561', species: 'BP_Deinosuchus_C',
    minGrowth: 0.48, maxGrowth: 0.75, conditions: '0000100000', eligible: true, days: 1, note: undefined });
  assert.deepEqual(zc.tick(1000 + DWELL_S + 10, [deino()], zones), [], 'not twice while the game has not reported it');
  assert.equal(zc.tick(1000 + DWELL_S + PENDING_S, [deino()], zones).length, 1, 'again if it never came');
});

test('patrol and sanctuary the same way, one task per look', () => {
  const zc = new ZoneCredit();
  const inPatrol = deino({ x: 10500, conditions: conds([7, 8]) });
  zc.tick(0, [inPatrol], zones);
  const f = zc.tick(DWELL_S, [inPatrol], zones);
  assert.deepEqual(f.map((x) => x.conditions), ['0000010000']);
  assert.equal(f[0].eligible, undefined, 'three tasks: not eligible, left to the game');
  const b = new ZoneCredit();
  const inSanctuary = deino({ x: 15500, conditions: conds([7, 8]) });
  b.tick(0, [inSanctuary], zones);
  assert.deepEqual(b.tick(DWELL_S, [inSanctuary], zones).map((x) => x.conditions), ['1000000000'], 'sanctuary first');
  assert.deepEqual(b.tick(DWELL_S + 10, [inSanctuary], zones).map((x) => x.conditions), ['0000100000'], 'then the migration there');
});

test('nothing when the game gave it, outside, leaving resets, past 75 %, another species starts again', () => {
  const zc = new ZoneCredit();
  const has5 = deino({ conditions: conds([3, 5, 7, 8, 10]) });
  zc.tick(0, [has5], zones);
  assert.deepEqual(zc.tick(100, [has5], zones), []);
  const out = deino({ x: 5500 });
  zc.tick(0, [out], zones);
  assert.deepEqual(zc.tick(100, [out], zones), [], 'in an inactive zone');
  const b = new ZoneCredit();
  b.tick(0, [deino()], zones);
  b.tick(30, [deino({ x: -500 })], zones);
  b.tick(40, [deino()], zones);
  assert.deepEqual(b.tick(90, [deino()], zones), [], 'left for a moment: the minute starts again');
  assert.equal(b.tick(100, [deino()], zones).length, 1);
  const old = new ZoneCredit();
  old.tick(0, [deino({ growth: 0.8 })], zones);
  assert.deepEqual(old.tick(100, [deino({ growth: 0.8 })], zones), [], 'prime is already decided');
  const other = new ZoneCredit();
  other.tick(0, [deino()], zones);
  assert.deepEqual(other.tick(100, [deino({ species: 'BP_Triceratops_C' })], zones), []);
  assert.equal(other.tick(160, [deino({ species: 'BP_Triceratops_C' })], zones).length, 1);
});

test('the map zone players see counts when the game\'s zone of that kind is in it', () => {
  const mz = (name, x0) => ({ name, x: x0 + 5000, y: 5000, poly: [[x0, -5000], [x0 + 10000, -5000], [x0 + 10000, 10000], [x0, 10000]] });
  const z = taskZones(spawners, { migration: [mz('MZ 01', -2000), mz('MZ 02', 100000)], patrol: [mz('PZ 13', 9000)] });
  const mig = z.get('5');
  assert.equal(zoneAt(mig, 7500, 8000)?.name, 'MZ 01', '60 m from the plant patch, still in MZ 01 which holds an active zone');
  assert.equal(zoneAt(mig, 105000, 0), null, 'MZ 02 holds no active migration zone now');
  assert.equal(zoneAt(z.get('6'), 18500, 9000)?.name, 'PZ 13');
  const zc = new ZoneCredit();
  const far = deino({ x: 7500, y: 8000 });
  zc.tick(0, [far], z);
  const f = zc.tick(DWELL_S, [far], z);
  assert.equal(f.length, 1);
  assert.match(f[0].note, /MZ 01/);
});
