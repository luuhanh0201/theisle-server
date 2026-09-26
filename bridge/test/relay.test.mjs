// The bridge's side of the relay (relay.ts) and its settings (discord.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { alertWebhookOf, sendHeartbeat, registerCommands, COMMANDS } = await import('../dist/relay.js');
const { validateDiscord, publicView } = await import('../dist/discord.js');

const URL1 = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD';
const URL2 = 'https://discord.com/api/webhooks/223456789012345678/zyxwvutsrqponmlkjihgfedcba9876543210WXYZ';
const SECRET = 'a'.repeat(32);

test('settings: the relay URL and its secret (kept when not sent again, never shown)', () => {
  const s = validateDiscord({ enabled: true, channels: [], routes: {}, relay: { url: 'https://relay.x.workers.dev/', secret: SECRET } });
  assert.deepEqual(s.relay, { url: 'https://relay.x.workers.dev', secret: SECRET });
  assert.equal(validateDiscord({ enabled: true, relay: { url: 'https://relay.x.workers.dev' } }, s).relay.secret, SECRET);
  assert.throws(() => validateDiscord({ enabled: true, relay: { url: 'http://relay', secret: SECRET } }), /https/);
  assert.throws(() => validateDiscord({ enabled: true, relay: { url: 'https://relay', secret: 'short' } }), /24/);
  assert.equal(validateDiscord({ enabled: true, relay: { url: '' } }).relay, null, 'an empty URL: no relay');
  assert.ok(!JSON.stringify(publicView(s)).includes(SECRET));
});

test('the outage webhook: the "server" log\'s channel, else the first', () => {
  const s = validateDiscord({ enabled: true, channels: [{ id: 'aa', name: 'A', url: URL1 }, { id: 'bb', name: 'B', url: URL2 }], routes: { server: 'bb' } });
  assert.equal(alertWebhookOf(s), URL2);
  assert.equal(alertWebhookOf({ ...s, routes: {} }), URL1);
  assert.equal(alertWebhookOf({ ...s, channels: [], routes: {} }), null);
});

test('heartbeat: sent with the secret; a refusal says why', async () => {
  const calls = [];
  const state = { lastOkAt: null, lastError: null };
  const hb = { serverName: 'XG', phase: 'running', online: 1, maxPlayers: 100, players: ['Rex'], fps: 30, ai: 5, alertWebhook: URL1 };
  await sendHeartbeat({ url: 'https://relay', secret: SECRET }, hb, state, async (url, init) => { calls.push([url, init]); return { status: 200, text: async () => '' }; }, () => 42);
  assert.equal(calls[0][0], 'https://relay/heartbeat');
  assert.equal(calls[0][1].headers.authorization, `Bearer ${SECRET}`);
  assert.deepEqual(JSON.parse(calls[0][1].body), hb);
  assert.equal(state.lastOkAt, 42);
  await sendHeartbeat({ url: 'https://relay', secret: SECRET }, hb, state, async () => ({ status: 401, text: async () => '' }));
  assert.match(state.lastError, /mã bí mật/);
  await sendHeartbeat({ url: 'https://relay', secret: SECRET }, hb, state, async () => { throw new Error('ECONNRESET'); });
  assert.match(state.lastError, /ECONNRESET/);
});

test('slash commands: checked, PUT on the application with the bot token', async () => {
  await assert.rejects(registerCommands('abc', 'x'.repeat(60)), /Application ID/);
  await assert.rejects(registerCommands('123456789012345678', 'short'), /Bot token/);
  const calls = [];
  const done = await registerCommands('123456789012345678', `${'x'.repeat(24)}.${'y'.repeat(6)}.${'z'.repeat(38)}`, async (url, init) => { calls.push([url, init]); return { status: 200, text: async () => '[]' }; });
  assert.deepEqual(done, ['/status', '/online']);
  assert.equal(calls[0][0], 'https://discord.com/api/v10/applications/123456789012345678/commands');
  assert.equal(calls[0][1].method, 'PUT');
  assert.match(calls[0][1].headers.authorization, /^Bot /);
  assert.deepEqual(JSON.parse(calls[0][1].body), COMMANDS);
  await assert.rejects(registerCommands('123456789012345678', 'x'.repeat(60), async () => ({ status: 401, text: async () => '' })), /từ chối/);
});
