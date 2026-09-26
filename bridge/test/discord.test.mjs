// The Discord log (discord.ts): settings (URLs never shown whole), what each
// event says, and the sender — batching, a replay not re-sent, 429 / outage
// waits, a dead webhook dropped, the queue kept on disk.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'discord-test-'));
process.env.DATA_DIR = root;
const { validateDiscord, maskUrl, publicView, lineOf, auditLine, phaseLine, plain, DiscordLog } = await import('../dist/discord.js');
after(() => rmSync(root, { recursive: true, force: true }));

const URL1 = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD';
const URL2 = 'https://discord.com/api/webhooks/223456789012345678/zyxwvutsrqponmlkjihgfedcba9876543210WXYZ';

test('settings: webhook URLs checked, kept when not sent again, never shown whole', () => {
  const s = validateDiscord({ enabled: true, channels: [{ id: 'aa', name: 'log', url: URL1 }], routes: { chat: 'aa', kill: '' } });
  assert.deepEqual(s.routes, { chat: 'aa' });
  const again = validateDiscord({ enabled: true, channels: [{ id: 'aa', name: 'log 2' }], routes: {} }, s);
  assert.equal(again.channels[0].url, URL1, 'no URL sent: the saved one stays');
  assert.throws(() => validateDiscord({ enabled: true, channels: [{ name: 'x', url: 'https://evil.example/api/webhooks/1/2' }] }), /webhook URL/);
  assert.throws(() => validateDiscord({ enabled: true, channels: [{ name: 'x' }] }), /webhook URL/);
  assert.throws(() => validateDiscord({ enabled: true, channels: [{ id: 'aa', name: 'x', url: URL1 }], routes: { chat: 'zz' } }), /unknown channel/);
  assert.throws(() => validateDiscord({ enabled: true, channels: [], routes: { nope: '' } }), /unknown log kind/);
  assert.equal(maskUrl(URL1), 'webhook 123456789012345678 · …ABCD');
  assert.ok(!JSON.stringify(publicView(s)).includes('abcdefghij'), 'the token part is not in the panel view');
});

test('lines: what each event says; player text cannot format or ping', () => {
  assert.equal(plain('**hi** @everyone <@1>'), '\\*\\*hi\\*\\* @everyone \\<@1\\>');
  const kill = lineOf({ type: 'death', t: 5, id: 1, steamId: '2', name: 'Bé', species: 'BP_Troodon_C', growth: 0.45, attributed: true,
    killer: '1', killerName: 'Rex', killerSpecies: 'BP_Tyrannosaurus_C', killerGrowth: 1, lifeSeconds: 600 });
  assert.equal(kill.kind, 'kill');
  assert.equal(kill.text, '⚔️ **Rex** (Tyrannosaurus 100%) đã giết **Bé** (Troodon 45%) — sống được 10 phút');
  assert.equal(lineOf({ type: 'death', t: 5, id: 1, steamId: '2', species: 'BP_Troodon_C', growth: 0.5, attributed: false }).kind, 'death');
  assert.equal(lineOf({ type: 'death', t: 5, id: 1, steamId: '2', species: 'BP_Troodon_C', growth: 0.5, attributed: false, cause: 'garage' }), null,
    'stored in the garage is not a death');
  assert.equal(lineOf({ type: 'chat', t: 1, id: 1, steamId: '7', name: 'A', message: 'xin chào' }).text, '💬 **A**: xin chào');
  assert.equal(lineOf({ type: 'session_end', t: 1, id: 1, steamId: '7', name: 'A', duration: 3900 }).text, '🔴 **A** rời server (chơi 1 giờ 5 phút) `7`');
  assert.equal(lineOf({ type: 'damage', t: 1, id: 1, attacker: '1', victim: '2', amount: 5 }), null, 'damage is not logged');
  assert.equal(auditLine({ t: 1, action: 'AI zones saved', ok: true, byName: 'Hạnh' }).text, '🛠️ **Hạnh**: AI zones saved');
  assert.equal(phaseLine('running', 'running', 1, false), null);
  assert.match(phaseLine('running', 'starting', 1, false).text, /bất ngờ/);
  assert.match(phaseLine('running', 'stopping', 1, true).text, /đang tắt/);
  assert.match(phaseLine('starting', 'running', 1, false).text, /đã chạy/);
});

function fakeDiscord() {
  const calls = [];
  const replies = [];
  const fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const r = replies.shift() ?? { status: 204 };
    if (r.throw) throw new Error(r.throw);
    return { status: r.status, text: async () => r.body ?? '' };
  };
  return { calls, replies, fetch };
}

test('sender: batched per channel, a replay not sent, 429 and outages wait, a dead webhook is dropped', async () => {
  let now = 1_000_000_000;
  const d = fakeDiscord();
  const log = new DiscordLog({ startedAt: 1_000_000, fetch: d.fetch, now: () => now });
  await log.load();
  await log.save({ enabled: true, channels: [{ id: 'aa', name: 'chat', url: URL1 }, { id: 'bb', name: 'admin', url: URL2 }], routes: { chat: 'aa', admin: 'bb' } });
  log.post({ kind: 'chat', t: 999_000, text: 'old' });                  // before the start: a replay
  for (let i = 0; i < 12; i++) log.post({ kind: 'chat', t: 1_000_000 + i, text: `m${i}` });
  log.post({ kind: 'kill', t: 1_000_001, text: 'no route' });
  log.post({ kind: 'admin', t: 1_000_001, text: 'saved' });
  assert.equal(log.status().queued, 13);
  await log.tick();
  assert.equal(d.calls.length, 2, 'one message per channel');
  assert.equal(d.calls[0].body.embeds.length, 10, 'at most 10 lines a message');
  assert.deepEqual(d.calls[0].body.allowed_mentions, { parse: [] });
  assert.equal(d.calls[0].body.embeds[0].timestamp, new Date(1_000_000_000).toISOString(), 'the line keeps its own time');
  assert.ok(!d.calls.some((c) => JSON.stringify(c.body).includes('old')));
  assert.equal(log.status().queued, 2);

  d.replies.push({ status: 429, body: '{"retry_after": 3}' });
  await log.tick();
  assert.equal(log.status().queued, 2, 'a 429 keeps the lines');
  const calls = d.calls.length;
  await log.tick();
  assert.equal(d.calls.length, calls, 'and waits');
  now += 3500;
  await log.tick();
  assert.equal(log.status().queued, 0);

  d.replies.push({ throw: 'ECONNRESET' });
  log.post({ kind: 'chat', t: 1_000_100, text: 'during an outage' });
  await log.tick();
  assert.equal(log.status().queued, 1);
  assert.match(log.status().channels.aa.lastError, /ECONNRESET/);
  now += 120_000;
  await log.tick();
  assert.equal(log.status().queued, 0, 'sent once through');

  d.replies.push({ status: 404, body: '{"message":"Unknown Webhook"}' });
  log.post({ kind: 'chat', t: 1_000_200, text: 'x' });
  await log.tick();
  assert.equal(log.status().queued, 0, 'a dead webhook: dropped, not retried forever');
  assert.match(log.status().channels.aa.lastError, /webhook không còn/);
});

test('the queue is on disk: a restart does not lose what was not sent', async () => {
  const d = fakeDiscord();
  const a = new DiscordLog({ startedAt: 1, fetch: d.fetch });
  await a.load();
  await a.save({ enabled: true, channels: [{ id: 'aa', name: 'chat', url: URL1 }], routes: { chat: 'aa' } });
  a.post({ kind: 'chat', t: 5, text: 'kept' });
  await new Promise((r) => setTimeout(r, 1200));
  assert.ok(existsSync(join(root, 'discord-queue.json')));
  const b = new DiscordLog({ startedAt: 1, fetch: d.fetch });
  await b.load();
  assert.equal(b.status().queued, 1);
  await b.tick();
  assert.equal(d.calls.at(-1).body.embeds[0].description, 'kept');
  const settings = JSON.parse(readFileSync(join(root, 'discord.json'), 'utf8'));
  assert.equal(settings.channels[0].url, URL1);
});
