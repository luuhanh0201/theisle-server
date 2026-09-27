// "Completed: <task>" for each prime task that turns on (prime-notify.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { PrimeNotifier } = await import('../dist/prime-notify.js');
const { renderMessage } = await import('../dist/messages.js');

const fakeRcon = () => {
  const sent = [];
  return { sent, enabled: true, directMessage: async (steamId, message) => { sent.push([steamId, message]); return ''; } };
};
const conds = (on) => Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), on.includes(i + 1)]));
const ev = (t, on, over = {}) => ({ type: 'prime', t, steamId: '76561198658463561', species: 'BP_Deinosuchus_C',
  growth: 0.53, eligible: on.length >= 5, conditions: conds(on), ...over });
const render = (key, vars) => renderMessage(key, vars);

test('a task done on the same dino: told by name, then eligible', async () => {
  const rcon = fakeRcon();
  const n = new PrimeNotifier(rcon, 1000, render);
  assert.deepEqual(await n.handle(ev(1000, [3, 7, 8, 10])), [], 'the first reading is the baseline');
  const sent = await n.handle(ev(1010, [3, 5, 7, 8, 10], { growth: 0.531 }));
  assert.equal(sent.length, 2);
  assert.match(sent[0], /Đã hoàn thành nhiệm vụ prime: Vùng di cư \(5\/10 — cần 5/);
  assert.match(sent[1], /đủ điều kiện prime/);
  assert.equal(rcon.sent[0][0], '76561198658463561');
});

test('no message: passive tasks, a new spawn, another species, the garage, a replay, a task lost', async () => {
  const rcon = fakeRcon();
  const n = new PrimeNotifier(rcon, 1000, render);
  await n.handle(ev(1000, []));
  assert.deepEqual(await n.handle(ev(1001, [7, 8, 10])), [], 'passive ones are there from the start');
  assert.deepEqual(await n.handle(ev(1002, [3, 7, 8, 10], { species: 'BP_Triceratops_C' })), [], 'another species: a new baseline');
  assert.deepEqual(await n.handle(ev(1003, [1, 3, 7, 8, 10], { species: 'BP_Triceratops_C', growth: 0.25 })), [], 'growth jumped (a new dino)');
  assert.deepEqual(await n.handle(ev(1004, [1, 3, 5, 6, 7, 8, 10], { species: 'BP_Triceratops_C', growth: 0.6 })), [], 'out of the garage');
  assert.deepEqual(await n.handle(ev(1005, [1, 3, 7, 8, 10], { species: 'BP_Triceratops_C', growth: 0.6 })), [], 'a task lost is not told');
  const old = new PrimeNotifier(fakeRcon(), 5000, render);
  await old.handle(ev(100, [3]));
  assert.deepEqual(await old.handle(ev(200, [3, 5])), [], 'events from before the bridge started (a replay)');
  assert.equal(rcon.sent.length, 0);
});

test('turned off on the panel (empty text): nothing sent', async () => {
  const rcon = fakeRcon();
  const n = new PrimeNotifier(rcon, 1000, () => null);
  await n.handle(ev(1000, [3]));
  assert.deepEqual(await n.handle(ev(1001, [3, 5])), []);
  assert.equal(rcon.sent.length, 0);
});
