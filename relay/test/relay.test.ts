// The relay (src/index.ts) with a fake KV and a fake Discord: heartbeats kept,
// an outage told once and its end, /status and /online answered from the last
// heartbeat, Discord's signature checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { STALE_S, checkOutage, cleanHeartbeat, handleHeartbeat, handleInteraction, onlineText, sameSecret, statusEmbed, verifyDiscord } from '../src/index.ts';

const HOOK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD';

function fakeEnv(publicKey = '') {
  const kv = new Map<string, string>();
  const STATE = {
    get: async (k: string, type?: string) => { const v = kv.get(k); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; },
    put: async (k: string, v: string) => { kv.set(k, v); },
  };
  return { kv, env: { STATE, BRIDGE_SECRET: 's3cret-s3cret', DISCORD_PUBLIC_KEY: publicKey } as never };
}

const posted: Array<{ url: string; body: { embeds: Array<{ description: string }> } }> = [];
globalThis.fetch = (async (url: string, init: { body: string }) => {
  posted.push({ url, body: JSON.parse(init.body) });
  return { ok: true, status: 204 };
}) as never;

const beat = (body: unknown, secret = 's3cret-s3cret') => new Request('https://relay/heartbeat', {
  method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('heartbeat: only with the secret; kept to what it may hold', async () => {
  const { env, kv } = fakeEnv();
  assert.equal((await handleHeartbeat(beat({ online: 1 }, 'wrong'), env, 1000)).status, 401);
  assert.equal((await handleHeartbeat(beat({ serverName: 'XG', phase: 'running', online: 3, players: ['A', 'B', 3], alertWebhook: 'https://evil/x' }), env, 1000)).status, 200);
  const s = JSON.parse(kv.get('state') as string);
  assert.deepEqual(s.players, ['A', 'B']);
  assert.equal(s.alertWebhook, null, 'only a Discord webhook');
  assert.equal(sameSecret('a', 'a'), true);
  assert.equal(sameSecret('', ''), false);
  assert.equal(cleanHeartbeat(null, 1), null);
});

test('an outage: told once after STALE_S, and its end', async () => {
  const { env } = fakeEnv();
  posted.length = 0;
  await handleHeartbeat(beat({ serverName: 'XG', phase: 'running', online: 5, players: [], alertWebhook: HOOK }), env, 1000);
  assert.equal(await checkOutage(env, 1000 + STALE_S), 'ok');
  assert.equal(await checkOutage(env, 1000 + STALE_S + 60), 'told');
  assert.equal(await checkOutage(env, 1000 + STALE_S + 120), 'already');
  assert.equal(posted.length, 1);
  assert.match(posted[0].body.embeds[0].description, /Mất kết nối.*<t:1000:t>.*5 người online/s);
  await handleHeartbeat(beat({ serverName: 'XG', phase: 'running', online: 2, players: [], alertWebhook: HOOK }), env, 1000 + 900);
  assert.equal(posted.length, 2);
  assert.match(posted[1].body.embeds[0].description, /Kết nối lại.*15 phút/);
  assert.equal(await checkOutage(env, 1000 + 960), 'ok');
});

test('/status and /online, live and while unreachable', () => {
  const s = cleanHeartbeat({ serverName: 'XG *EVO*', phase: 'running', online: 2, maxPlayers: 100, players: ['Rex', 'Bé_Ba'], fps: 29.6, ai: 40 }, 1000) as never;
  const live = statusEmbed(s, 1010);
  assert.equal(live.title, 'XG \\*EVO\\*');
  assert.match(String(live.description), /Đang chạy/);
  assert.deepEqual((live.fields as Array<{ value: string }>).map((f) => f.value), ['2 / 100', '30', '40']);
  const down = statusEmbed(s, 1000 + STALE_S + 1);
  assert.match(String(down.description), /Mất kết nối/);
  assert.match(onlineText(s, 1010), /2 người online.*Rex, Bé\\_Ba/s);
  assert.match(onlineText(s, 1000 + STALE_S + 1), /Mất kết nối/);
  assert.match(onlineText(null, 1), /Chưa nhận/);
  const hit = cleanHeartbeat({ serverName: 'XG', phase: 'running', online: 1, attack: { since: 990, peakPps: 180000, peakMbps: 900 } }, 1000) as never;
  assert.match(String(statusEmbed(hit, 1010).description), /Đang bị DDoS.*<t:990:R>.*180\.000 gói\/s · 900 Mbit\/s/s);
  assert.equal((cleanHeartbeat({ attack: 'x' }, 1) as { attack: unknown }).attack, null);
});

test('interactions: a bad signature refused; PING; /status answered from KV', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const pub = Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey)).toString('hex');
  const { env } = fakeEnv(pub);
  const sign = async (body: string, ts = '1700000000') => {
    const sig = Buffer.from(await crypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(ts + body))).toString('hex');
    return new Request('https://relay/interactions', { method: 'POST', headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': ts }, body });
  };
  const ping = JSON.stringify({ type: 1 });
  assert.equal(await verifyDiscord(pub, '00'.repeat(64), '1', ping), false);
  const bad = await sign(ping);
  const tampered = new Request(bad.url, { method: 'POST', headers: bad.headers, body: JSON.stringify({ type: 2 }) });
  assert.equal((await handleInteraction(tampered, env)).status, 401);
  assert.deepEqual(await (await handleInteraction(await sign(ping), env)).json(), { type: 1 });
  await handleHeartbeat(beat({ serverName: 'XG', phase: 'running', online: 1, players: ['Rex'] }), env, Math.floor(Date.now() / 1000));
  const r = await (await handleInteraction(await sign(JSON.stringify({ type: 2, data: { name: 'online' } })), env)).json() as { data: { content: string } };
  assert.match(r.data.content, /1 người online.*Rex/s);
  const res = await worker.fetch(new Request('https://relay/'), env);
  assert.equal(await res.text(), 'theisle discord relay: ok');
});
