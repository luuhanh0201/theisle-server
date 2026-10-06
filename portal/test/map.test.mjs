// Waypoints (public/map.js): distance, compass direction, what is remembered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { distanceM, bearingOf, compassName, fmtDistance, loadWaypoints, edgeArrow } = await import('../public/map.js');

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

test('a layer added since the choice was saved (the heat map) starts on; turned off, it stays off', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const { loadLayersForTest, saveLayersForTest } = await import('../public/map.js');
  store.set('portalMapLayers.v2', JSON.stringify(['ai', 'water']));        // saved before the heat map
  assert.deepEqual([...loadLayersForTest()].sort(), ['ai', 'heat', 'water']);
  const on = loadLayersForTest(); on.delete('heat'); saveLayersForTest(on);
  assert.deepEqual([...loadLayersForTest()].sort(), ['ai', 'water'], 'off by choice: stays off');
  delete globalThis.localStorage;
});

test('the heat map colours: how crowded, never the count', async () => {
  const { heatLevel } = await import('../public/map.js');
  assert.deepEqual([1, 2, 3, 4, 6, 7, 20].map((n) => heatLevel(n).label), ['Ít', 'Vừa', 'Vừa', 'Đông', 'Đông', 'Rất đông', 'Rất đông']);
});

test('a friend off the mini map: an arrow on the rim, their way; on the map: none', () => {
  // 200 x 200, a friend 500 px east: the arrow on the right edge, 13 px in, pointing east.
  const e = edgeArrow(500, 0, 200, 200, 'square');
  assert.deepEqual({ x: Math.round(e.x), y: Math.round(e.y), angle: e.angle }, { x: 87, y: 0, angle: 0 });
  assert.equal(edgeArrow(50, 20, 200, 200, 'square'), null, 'inside: drawn on the map instead');
  // A corner: the square's corner is off a round widget, the circle's rim is not.
  const sq = edgeArrow(300, 300, 200, 200, 'square');
  const ci = edgeArrow(300, 300, 200, 200, 'circle');
  assert.equal(Math.round(Math.hypot(sq.x, sq.y)), 123);
  assert.equal(Math.round(Math.hypot(ci.x, ci.y)), 87);
  assert.equal(edgeArrow(80, 80, 200, 200, 'square'), null);
  assert.ok(edgeArrow(80, 80, 200, 200, 'circle') !== null, 'beyond the round rim, inside the square');
  // Turned with the dino (heading up): a friend north on the map ends up where the turn puts them.
  const t = edgeArrow(0, -500, 200, 200, 'circle', Math.PI / 2);
  assert.deepEqual({ x: Math.round(t.x), y: Math.round(t.y) + 0 }, { x: 87, y: 0 });
});
