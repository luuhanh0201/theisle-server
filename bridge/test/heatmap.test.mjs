// Where players are, for every player's map: counts per 500 m square, every 5 minutes, admins left out
// (heatmap.ts). npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { buildHeat, HeatMapper, HEAT_CELL, HEAT_EVERY_S } = await import('../dist/heatmap.js');

const p = (steamId, x, y) => ({ steamId, loc: x === null ? null : { x, y } });

test('counts per square, never a position: two near each other share one square, its centre only', () => {
  const h = buildHeat([p('a', 10_000, 20_000), p('b', 40_000, 49_999), p('c', 260_000, -120_000), p('d', null)], () => false, 1000);
  assert.equal(h.cell, HEAT_CELL);
  assert.equal(h.players, 3, 'no position: not counted');
  assert.deepEqual(h.cells, [{ x: 25_000, y: 25_000, n: 2 }, { x: 275_000, y: -125_000, n: 1 }]);
});

test('admins are not counted', () => {
  const h = buildHeat([p('admin', 10_000, 10_000), p('b', 10_000, 10_000)], (id) => id === 'admin', 1000);
  assert.equal(h.players, 1);
  assert.deepEqual(h.cells, [{ x: 25_000, y: 25_000, n: 1 }]);
});

test('one picture per 5 minutes on the clock, the same for everyone, taken at the first ask', () => {
  let online = [p('a', 0, 0)];
  let takes = 0;
  const m = new HeatMapper(() => { takes += 1; return online; }, () => false);
  const t0 = 1_791_120_010;            // 10 s past a 5-minute mark
  const first = m.current(t0);
  assert.equal(first.next, Math.floor(t0 / HEAT_EVERY_S) * HEAT_EVERY_S + HEAT_EVERY_S);
  online = [p('a', 0, 0), p('b', 0, 0)];
  assert.equal(m.current(t0 + 200).players, 1, 'moved since: still the picture of these 5 minutes');
  assert.equal(takes, 1);
  assert.equal(m.current(first.next).players, 2, 'the next 5 minutes: a new picture');
  assert.equal(takes, 2);
});
