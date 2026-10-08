// The mutation icons (public/mut-icons.js): a failed fetch of their bundle is tried again, the icons fill in when it comes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const src = await readFile(new URL('../public/mut-icons.js', import.meta.url), 'utf8');

test('the bundle failing (503, then no network) is asked again until it comes; the waiting icon is filled then', async () => {
  const timers = [];
  const winListeners = {};
  const answers = [{ ok: false, status: 503 }, 'offline', { ok: true, json: async () => ({ hatchling: '<svg/>' }) }];
  let calls = 0;
  const icon = { dataset: { mutIcon: 'MUT_Hatchling' }, src: '', matches: () => true };
  const body = { matches: () => false, querySelectorAll: () => [icon] };
  const window = {
    addEventListener: (k, f) => { (winListeners[k] ??= new Set()).add(f); },
    removeEventListener: (k, f) => { winListeners[k]?.delete(f); },
  };
  vm.runInNewContext(src, {
    window,
    document: { body, addEventListener() {} },
    MutationObserver: class { observe() {} },
    fetch: async () => { const a = answers[calls++]; if (a === 'offline') throw new TypeError('Failed to fetch'); return a; },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    clearTimeout: () => {},
    encodeURIComponent,
    Promise, Error, Object, String,
  });
  const tick = () => new Promise((r) => setImmediate(r));
  await tick();
  assert.equal(calls, 1);
  assert.equal(icon.src, '', 'nothing yet');
  assert.equal(timers.at(-1).ms, 1000, 'the first try again after a second');
  timers.at(-1).f();
  await tick();
  assert.equal(calls, 2);
  assert.equal(timers.at(-1).ms, 2000, 'then longer');
  // The network back: at once, without waiting for the timer.
  for (const f of [...winListeners.online]) f();
  await window.MutIcons.ready;
  assert.equal(calls, 3);
  assert.match(icon.src, /^data:image\/svg\+xml/);
  assert.equal(window.MutIcons.has('Hatchling'), true);
  assert.equal(winListeners.online.size, 0, 'no listener left behind');
});
