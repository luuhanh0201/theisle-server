// Overlay widgets: settings and placement (pure parts of src/overlay.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normaliseOverlay, normaliseWidget, widgetBounds, DEFAULTS, WIDGETS, BASE } = require('../src/overlay.js');

const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };

test('four widgets; only voice is on out of the box', () => {
  const s = normaliseOverlay(undefined);
  assert.deepEqual(Object.keys(s.widgets), WIDGETS);
  assert.deepEqual(WIDGETS, ['voice', 'map', 'dino', 'quests']);
  assert.equal(s.enabled, true);
  assert.equal(s.widgets.voice.enabled, true);
  assert.equal(s.widgets.map.enabled, false);
  assert.deepEqual(s.widgets.map, DEFAULTS.map);
});

test('settings from before the widgets become the voice widget', () => {
  const s = normaliseOverlay({ enabled: true, position: 'bottom-right', style: 'compact', scale: 120 });
  assert.equal(s.widgets.voice.position, 'bottom-right');
  assert.equal(s.widgets.voice.style, 'compact');
  assert.equal(s.widgets.voice.scale, 120);
  assert.equal(s.widgets.map.position, DEFAULTS.map.position);
});

test('junk falls back; each widget keeps only its own options', () => {
  const m = normaliseWidget('map', { radius: 777, shape: 'star', rotate: 'heading', scale: 999, show: { ai: false, evil: true }, style: 'full' });
  assert.equal(m.radius, DEFAULTS.map.radius);
  assert.equal(m.shape, 'circle');
  assert.equal(m.rotate, 'heading');
  assert.equal(m.scale, 100);
  assert.equal(m.show.ai, false);
  assert.equal('evil' in m.show, false);
  assert.equal('style' in m, false, 'the map has no voice style');
  const q = normaliseWidget('quests', { hideDone: true, maxSpeakers: 4 });
  assert.equal(q.hideDone, true);
  assert.equal('maxSpeakers' in q, false);
  assert.equal(normaliseWidget('dino', { position: 'custom' }).position, DEFAULTS.dino.position, 'custom needs a dragged spot');
});

test('bounds: corners with offsets, sizes per widget and scale', () => {
  const at = (id, position, extra = {}) => widgetBounds(id, normaliseWidget(id, { position, offsetX: 20, offsetY: 30, ...extra }), display);
  assert.deepEqual(at('voice', 'top-left'), { x: 20, y: 30, width: BASE.voice[0], height: BASE.voice[1] });
  assert.deepEqual(at('map', 'bottom-right'), { x: 1920 - BASE.map[0] - 20, y: 1080 - BASE.map[1] - 30, width: BASE.map[0], height: BASE.map[1] });
  assert.equal(at('dino', 'top-center').x, Math.round((1920 - BASE.dino[0]) / 2));
  assert.equal(at('map', 'top-left', { scale: 200 }).width, BASE.map[0] * 2);
});

test('bounds: a dragged widget stays on its screen', () => {
  const w = normaliseWidget('quests', { position: 'custom', custom: { x: 5000, y: -40 } });
  const b = widgetBounds('quests', w, { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } });
  assert.equal(b.x, 1920 + 1920 - BASE.quests[0]);
  assert.equal(b.y, 0);
});

test('snap: dropped near a screen edge sticks to it, elsewhere stays', () => {
  const { snap } = require('../src/overlay.js');
  const b = { x: 1920, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(snap({ x: 1930, y: 9, width: 200, height: 100 }, b), [1920, 0]);
  assert.deepEqual(snap({ x: 3630, y: 975, width: 200, height: 100 }, b), [3640, 980]);
  assert.deepEqual(snap({ x: 2500, y: 400, width: 200, height: 100 }, b), [2500, 400]);
});

test('resize by an edge / corner: proportions kept, 50–250 %', () => {
  const { resizedScale } = require('../src/overlay.js');
  const box = { width: 200, height: 100, scale: 100 };
  assert.equal(resizedScale({ ...box, dir: 'e' }, 100, 0), 150, 'right edge 100 px wider');
  assert.equal(resizedScale({ ...box, dir: 'w' }, 100, 0), 50, 'left edge dragged inwards');
  assert.equal(resizedScale({ ...box, dir: 's' }, 0, 50), 150);
  assert.equal(resizedScale({ ...box, dir: 'se' }, 10, 60), 160, 'a corner follows the bigger move');
  assert.equal(resizedScale({ ...box, dir: 'e' }, 5000, 0), 250);
});
