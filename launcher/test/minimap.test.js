// The mini map gliding after your dino (src/minimap.js): what the portal sends checked, the dino between two
// positions, the picture moved and turned, a friend's arrow on the rim.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { miniMeta, lerpYaw, PoseTween, placePicture, edgeArrow, MINI_V2, TWEEN_MIN_MS, TWEEN_MAX_MS } = require('../src/minimap.js');

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('a v2 picture: its numbers checked; an older picture (no meta) or junk is none', () => {
  const ok = { v: 2, cx: 349211, cy: 148696, pxPerM: 0.26, w: 390, h: 390, friends: true, evil: 'x' };
  assert.deepEqual(miniMeta(ok), { v: MINI_V2, cx: 349211, cy: 148696, pxPerM: 0.26, w: 390, h: 390, friends: true });
  assert.equal(miniMeta(undefined), null);
  assert.equal(miniMeta({ ...ok, v: 1 }), null);
  assert.equal(miniMeta({ ...ok, cx: 'a' }), null);
  assert.equal(miniMeta({ ...ok, pxPerM: 0 }), null);
  assert.equal(miniMeta({ ...ok, w: Infinity }), null);
  assert.equal(miniMeta({ ...ok, h: 99999 }), null);
  assert.equal(miniMeta({ ...ok, friends: 'yes' }).friends, false);
});

test('the heading turns the short way round', () => {
  assert.equal(lerpYaw(350, 10, 0.5), 360);
  assert.equal(lerpYaw(10, 350, 0.5), 0);
  assert.equal(lerpYaw(90, 180, 0.5), 135);
  assert.equal(lerpYaw(null, 40, 0.3), 40);
  assert.equal(lerpYaw(40, null, 0.3), 40);
});

test('between two positions the dino glides, then stands; the glide lasts about as long as the positions take', () => {
  const t = new PoseTween();
  t.update({ x: 0, y: 0, yaw: 0 }, 0);
  assert.deepEqual(t.at(0), { x: 0, y: 0, yaw: 0 });
  assert.equal(t.moving(0), false, 'the first position: nothing to glide from');
  t.update({ x: 1000, y: 0, yaw: 90 }, 1000);
  assert.ok(t.ms > 1000 && t.ms < 1100, `a second apart: about a second (${t.ms})`);
  const mid = t.at(1000 + t.ms / 2);
  assert.ok(near(mid.x, 500) && near(mid.yaw, 45), JSON.stringify(mid));
  assert.equal(t.moving(1000 + t.ms / 2), true);
  assert.deepEqual(t.at(1000 + t.ms + 1), { x: 1000, y: 0, yaw: 90 });
  assert.equal(t.moving(1000 + t.ms + 1), false, 'arrived: no more frames');
  // The same answer again (the page asks every second, the game moves once): no new glide, the clock not reset.
  const t0 = t.t0;
  t.update({ x: 1000, y: 0, yaw: 90 }, 1500);
  assert.equal(t.t0, t0);
  // Positions coming fast or slow: the glide follows, within its bounds.
  for (let i = 0; i < 20; i++) t.update({ x: 2000 + i * 100, y: 0, yaw: 90 }, 3000 + i * 200);
  assert.equal(t.ms, TWEEN_MIN_MS);
  for (let i = 0; i < 20; i++) t.update({ x: 9000 + i * 100, y: 0, yaw: 90 }, 10000 + i * 5000);
  assert.equal(t.ms, TWEEN_MAX_MS);
});

test('a new position mid-glide goes on from where the dino is shown (no jump back); a far one is not glided', () => {
  const t = new PoseTween();
  t.update({ x: 0, y: 0, yaw: 0 }, 0);
  t.update({ x: 1000, y: 0, yaw: 0 }, 1000);
  const shown = t.at(1000 + t.ms / 2);
  t.update({ x: 2000, y: 0, yaw: 0 }, 1000 + t.ms / 2);
  assert.ok(near(t.at(t.t0).x, shown.x), 'starts where it was shown');
  t.update({ x: 900000, y: 0, yaw: 0 }, t.t0 + 100);
  assert.deepEqual(t.at(t.t0), { x: 900000, y: 0, yaw: 0 }, 'a respawn / teleport: there at once');
  assert.equal(t.moving(t.t0), false);
  t.update(null, t.t0 + 200);
  assert.equal(t.at(t.t0 + 200), null, 'no dino: nothing shown');
});

test('the picture moved by how far the dino is from its middle, scaled to the widget, turned with the heading', () => {
  // A 390 px picture of 750 m (radius), 0.26 px a metre; the widget 260 px for 500 m: the same scale.
  const meta = { v: 2, cx: 10000, cy: 20000, pxPerM: 130 / 500, w: 390, h: 390 };
  const north = placePicture(meta, { x: 10000, y: 20000, yaw: 90 }, 260, 260, 500, false);
  assert.ok(near(north.w, 390) && near(north.x, -195) && near(north.y, -195) && north.turn === 0, JSON.stringify(north));
  // 10 m east of the middle: the picture 2.6 px to the left.
  const moved = placePicture(meta, { x: 11000, y: 20000, yaw: 90 }, 260, 260, 500, false);
  assert.ok(near(moved.x, -195 - 2.6), String(moved.x));
  // A bigger widget (scale 150 %): the picture drawn 1.5 times bigger.
  assert.ok(near(placePicture(meta, { x: 10000, y: 20000 }, 390, 390, 500, false).w, 585));
  // Heading up: facing east (yaw 0) turns the map a quarter to the left.
  assert.ok(near(placePicture(meta, { x: 10000, y: 20000, yaw: 0 }, 260, 260, 500, true).turn, -Math.PI / 2));
});

test('a friend beyond the map: an arrow on the rim their way; on the map: none (as map.js)', () => {
  assert.equal(edgeArrow(50, 0, 260, 260, 'circle'), null);
  const e = edgeArrow(500, 0, 260, 260, 'circle');
  assert.ok(near(e.x, 117) && near(e.y, 0) && near(e.angle, 0), JSON.stringify(e));
  const turned = edgeArrow(500, 0, 260, 260, 'circle', -Math.PI / 2);
  assert.ok(near(turned.x, 0) && near(turned.y, -117), JSON.stringify(turned));
});
