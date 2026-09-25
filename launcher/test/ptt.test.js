// Push-to-talk: held / released once per press, capture a new key, mouse side buttons.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { UiohookKey } = require('uiohook-napi');
const { PushToTalk, label, parseBinding, DEFAULT_PTT } = require('../src/ptt.js');

const setup = (binding) => {
  const hook = new EventEmitter();
  const seen = [];
  const ptt = new PushToTalk(hook, binding, (h) => seen.push(h));
  return { hook, seen, ptt };
};

test('default is V; labels in Vietnamese', () => {
  assert.equal(DEFAULT_PTT.code, UiohookKey.V);
  assert.equal(label(DEFAULT_PTT, UiohookKey), 'V');
  assert.equal(label({ kind: 'key', code: UiohookKey.CapsLock }, UiohookKey), 'Caps Lock');
  assert.equal(label({ kind: 'mouse', code: 4 }, UiohookKey), 'Chuột bên 1 (Mouse 4)');
  assert.deepEqual(parseBinding({ kind: 'mouse', code: 1 }), DEFAULT_PTT, 'left click is not a talk key');
  assert.deepEqual(parseBinding('junk'), DEFAULT_PTT);
});

test('held once, released once, other keys ignored (auto-repeat too)', () => {
  const { hook, seen } = setup(undefined);
  hook.emit('keydown', { keycode: UiohookKey.W });
  hook.emit('keydown', { keycode: UiohookKey.V });
  hook.emit('keydown', { keycode: UiohookKey.V });
  hook.emit('keyup', { keycode: UiohookKey.V });
  assert.deepEqual(seen, [true, false]);
});

test('capture: next key or side button becomes the key; Esc cancels; left click ignored', async () => {
  const { hook, seen, ptt } = setup(undefined);
  const p = ptt.captureNext();
  hook.emit('mousedown', { button: 1 });
  hook.emit('mousedown', { button: 4 });
  assert.deepEqual(await p, { kind: 'mouse', code: 4 });
  hook.emit('mousedown', { button: 4 });
  hook.emit('mouseup', { button: 4 });
  assert.deepEqual(seen, [true, false]);
  const q = ptt.captureNext();
  hook.emit('keydown', { keycode: UiohookKey.Escape });
  assert.equal(await q, null);
  assert.deepEqual(ptt.binding, { kind: 'mouse', code: 4 }, 'unchanged');
});

test('release: a lost key-up never leaves the mic open', () => {
  const { hook, seen, ptt } = setup(undefined);
  hook.emit('keydown', { keycode: UiohookKey.V });
  ptt.release();
  assert.deepEqual(seen, [true, false]);
});

test('range key: ` by default, its own binding next to the talk key', () => {
  const { DEFAULT_RANGE } = require('../src/ptt.js');
  const hook = new EventEmitter();
  const talk = []; const range = [];
  new PushToTalk(hook, undefined, (h) => talk.push(h));
  new PushToTalk(hook, undefined, (d) => range.push(d), DEFAULT_RANGE);
  assert.equal(DEFAULT_RANGE.code, UiohookKey.Backquote);
  assert.equal(label(DEFAULT_RANGE, UiohookKey), '` ~');
  hook.emit('keydown', { keycode: UiohookKey.Backquote });
  hook.emit('keyup', { keycode: UiohookKey.Backquote });
  assert.deepEqual(range, [true, false]);
  assert.deepEqual(talk, []);
  assert.deepEqual(parseBinding({ kind: 'mouse', code: 1 }, DEFAULT_RANGE), DEFAULT_RANGE);
});
