// Waypoints (public/map.js): distance, compass direction, what is remembered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { distanceM, bearingOf, compassName, fmtDistance, loadWaypoints } = await import('../public/map.js');

test('distance in metres from world units (cm), on the ground', () => {
  assert.equal(distanceM({ x: 0, y: 0 }, { x: 30000, y: 40000 }), 500);
  assert.equal(fmtDistance(500), '500 m');
  assert.equal(fmtDistance(1234), '1,2 km');
});

test('compass: up the map is north, world X east, Y south', () => {
  const o = { x: 0, y: 0 };
  assert.equal(compassName(bearingOf(o, { x: 0, y: -100 })), 'Bắc');
  assert.equal(compassName(bearingOf(o, { x: 100, y: 0 })), 'Đông');
  assert.equal(compassName(bearingOf(o, { x: 0, y: 100 })), 'Nam');
  assert.equal(compassName(bearingOf(o, { x: -100, y: 0 })), 'Tây');
  assert.equal(compassName(bearingOf(o, { x: 100, y: -100 })), 'Đông Bắc');
  assert.equal(compassName(bearingOf(o, { x: -100, y: 100 })), 'Tây Nam');
});

test('waypoints: nothing stored (or no storage at all) is an empty list, never a throw', () => {
  assert.deepEqual(loadWaypoints(), { target: null, saved: [] });
  globalThis.localStorage = { getItem: () => JSON.stringify({ target: { x: 1, y: 2, name: 'Hồ' }, saved: [{ id: 'a', name: 'Tổ', x: 5, y: 6 }, { id: 'b', name: 'x', y: 1 }] }) };
  assert.deepEqual(loadWaypoints(), { target: { x: 1, y: 2, name: 'Hồ' }, saved: [{ id: 'a', name: 'Tổ', x: 5, y: 6 }] });
  delete globalThis.localStorage;
});
