// Mod → player messages: "notify" events delivered over RCON DirectMessage.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { Notifier } = await import('../dist/notify.js');
const { parseEvent } = await import('../dist/events.js');

const fakeRcon = (enabled = true, fail = false) => {
  const sent = [];
  return {
    sent,
    enabled,
    directMessage: async (steamId, message) => {
      if (fail) throw new Error('connect ECONNREFUSED');
      sent.push([steamId, message]);
      return '';
    },
  };
};
const ev = (t, message = 'Restored.') => parseEvent({ type: 'notify', t, steamId: '76561198000000001', message });

test('notify is a known event type', () => {
  assert.ok(ev(1));
  assert.equal(parseEvent({ type: 'notify', t: 1, steamId: '7656' }), null, 'message required');
});

test('fresh messages are delivered; a replay of old ones at startup is not', async () => {
  const rcon = fakeRcon();
  const n = new Notifier(rcon, 1000, () => {});
  assert.equal(n.handle(ev(500, 'old')), null, 'written before the bridge started');
  await n.handle(ev(995, 'just before start (poll slack)'));
  await n.handle(ev(1005, 'new'));
  assert.deepEqual(rcon.sent.map((s) => s[1]), ['just before start (poll slack)', 'new']);
  assert.equal(n.handle(parseEvent({ type: 'chat', t: 2000, steamId: '1', message: 'hi' })), null, 'only notify');
});

test('RCON off: warned once, nothing thrown; a failed send is logged, not fatal', async () => {
  const logs = [];
  const off = new Notifier(fakeRcon(false), 0, (m) => logs.push(m));
  assert.equal(off.handle(ev(10)), null);
  off.handle(ev(11));
  assert.equal(logs.length, 1);
  const broken = new Notifier(fakeRcon(true, true), 0, (m) => logs.push(m));
  await broken.handle(ev(12));
  assert.match(logs.at(-1), /DirectMessage to 76561198000000001 failed: connect ECONNREFUSED/);
});
