// Proximity voice: LiveKit tokens, who hears whom and how loud, the routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

const dir = mkdtempSync(join(tmpdir(), 'voice-'));
process.env.PORTAL_TOKEN = 'portal-secret-token';
process.env.LIVEKIT_API_KEY = 'APIkey';
process.env.LIVEKIT_API_SECRET = 'a-secret-that-is-long-enough-000000';
process.env.VOICE_URL = 'wss://voice.example.com';
process.env.LIVE_PATH = join(dir, 'live.json');
process.env.GARAGE_ROOT = dir;
process.env.DATA_DIR = join(dir, 'data');

const { signJwt, voiceIdentity, joinToken, hear, peersOf, parseParticipants, VoiceRoom, VOICE_RANGES } = await import('../dist/voice.js');
const { handlePlayerApi } = await import('../dist/player-api.js');
const { Store } = await import('../dist/store.js');
const { readLiveState } = await import('../dist/live.js');
const { config } = await import('../dist/config.js');
const { saveVoiceSettings, readVoiceSettings, voiceTag } = await import('../dist/voice-settings.js');

const cfg = config.voice;
const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
const P = (steamId, x, y, yaw = 0, z = 0) => ({ steamId, loc: { x, y, z }, yaw, vitals: {}, growth: 1 });
const A = '76561198000000001';
const B = '76561198000000002';
const C = '76561198000000003';

test('JWT: HS256 over header.body, verifiable with the secret', () => {
  const jwt = signJwt({ a: 1 }, 's3cret');
  const [h, b, sig] = jwt.split('.');
  assert.deepEqual(decode(h), { alg: 'HS256', typ: 'JWT' });
  assert.deepEqual(decode(b), { a: 1 });
  assert.equal(sig, createHmac('sha256', 's3cret').update(`${h}.${b}`).digest('base64url'));
});

test('join token: opaque identity, microphone only, expires', () => {
  const [, body] = joinToken(cfg, A, 'Rex', 1000).split('.');
  const c = decode(body);
  assert.equal(c.iss, 'APIkey');
  assert.equal(c.sub, voiceIdentity(A, cfg.apiSecret));
  assert.match(c.sub, /^v[0-9a-f]{16}$/);
  assert.ok(!c.sub.includes(A), 'never the SteamID');
  assert.equal(c.name, 'Rex');
  assert.equal(c.exp, 1000 + 6 * 3600);
  assert.deepEqual(c.video.canPublishSources, ['microphone']);
  assert.equal(c.video.canPublishData, false);
  assert.equal(c.video.room, 'isle');
  assert.notEqual(voiceIdentity(A, cfg.apiSecret), voiceIdentity(B, cfg.apiSecret));
});

test('hear: full volume in the first quarter of the speaker\'s range, fading out, silent past it', () => {
  assert.deepEqual(hear(P(A, 0, 0), P(B, 500, 0), 30), { gain: 1, pan: 0 }, '5 m ahead, 30 m voice');
  const mid = hear(P(A, 0, 0), P(B, 1900, 0), 30);
  assert.ok(mid.gain > 0.2 && mid.gain < 0.5, String(mid.gain));
  assert.equal(hear(P(A, 0, 0), P(B, 3000, 0), 30), null, '30 m');
  assert.ok(hear(P(A, 0, 0), P(B, 3000, 0), 60).gain > 0.4, 'a 60 m voice still carries at 30 m');
  assert.equal(hear(P(A, 0, 0), P(B, 1600, 0), 15), null, 'a whisper does not');
  assert.equal(hear(P(A, 0, 0), P(B, 0, 0, 0, 9_000), 90), null, 'height counts');
});

test('hear: pan from the listener heading (X forward, Y right)', () => {
  assert.equal(hear(P(A, 0, 0, 0), P(B, 0, 1000), 90).pan, 1, 'facing +X, other at +Y = right');
  assert.equal(hear(P(A, 0, 0, 0), P(B, 0, -1000), 90).pan, -1);
  assert.equal(hear(P(A, 0, 0, 90), P(B, 0, 1000), 90).pan, 0, 'facing them');
  assert.equal(hear(P(A, 0, 0, 90), P(B, 1000, 0), 90).pan, -1, 'facing +Y, other at +X = left');
  assert.equal(hear({ ...P(A, 0, 0), yaw: null }, P(B, 0, 1000), 90).pan, 0, 'no heading = centre');
});

test('peersOf: you hear others inside THEIR range; your audience is inside YOURS', () => {
  const players = [P(A, 0, 0), P(B, 4000, 0), P(C, 800, 0)];
  const all = new Set([A, B, C].map((s) => voiceIdentity(s, cfg.apiSecret)));
  const ranges = { [A]: 15, [B]: 60, [C]: 30 };
  const r = peersOf(A, players, all, cfg, (id) => (id === C ? 'Cera' : null), (id) => ranges[id]);
  assert.equal(r.inGame, true);
  assert.equal(r.range, 15);
  assert.deepEqual(r.peers.map((p) => p.name), ['Cera', null], 'B shouts (60 m) from 40 m away: heard');
  assert.deepEqual(r.audience, [voiceIdentity(C, cfg.apiSecret)], 'A whispers: only C (8 m) may hear');
  assert.ok(r.peers.every((p) => !('steamId' in p) && !('x' in p)), 'no SteamID or position');
  const onlyC = new Set([voiceIdentity(C, cfg.apiSecret)]);
  assert.equal(peersOf(A, players, onlyC, cfg, () => null, () => 30).peers.length, 1, 'B has no voice');
  assert.deepEqual(peersOf('76561198000000009', players, all, cfg, () => null, () => 30),
    { inGame: false, range: 30, peers: [], audience: [] });
});

test('VoiceRoom ranges: 30 m by default; only the offered steps', () => {
  const room = new VoiceRoom(cfg, async () => new Response('{}'));
  assert.equal(room.rangeOf(A), 30);
  room.setRange(A, 90);
  assert.equal(room.rangeOf(A), 90);
  assert.throws(() => room.setRange(A, 1000));
  assert.deepEqual([...VOICE_RANGES], [15, 30, 60, 90]);
});

test('parseParticipants: identities of our shape only', () => {
  const ids = parseParticipants({ participants: [{ identity: 'v0123456789abcdef' }, { identity: 'admin' }, {}] });
  assert.deepEqual([...ids], ['v0123456789abcdef']);
  assert.equal(parseParticipants(null).size, 0);
});

test('VoiceRoom: members from LiveKit; a missing room is empty; admin token sent', async () => {
  let auth = null;
  const reply = (status, body) => async (_url, init) => { auth = init.headers.authorization; return new Response(JSON.stringify(body), { status }); };
  const room = new VoiceRoom(cfg, reply(200, { participants: [{ identity: 'v0123456789abcdef', tracks: [] }] }));
  assert.deepEqual([...await room.members()], ['v0123456789abcdef'], 'asked on first use');
  auth = null;
  await room.members();
  assert.equal(auth, null, 'cached for a moment');
  await room.refresh(1000);
  assert.equal(decode(auth.split(' ')[1].split('.')[1]).video.roomAdmin, true);
  const empty = new VoiceRoom(cfg, reply(404, { code: 'not_found', msg: 'room not found' }));
  assert.equal((await empty.members()).size, 0);
  const down = new VoiceRoom(cfg, reply(503, { code: 'unavailable' }));
  await assert.rejects(down.refresh());
  assert.equal((await down.members()).size, 0, 'LiveKit down: nobody, and no throw');
});

function call(method, path, ctx, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = { 'x-portal-token': 'portal-secret-token' };
  return new Promise((resolve) => {
    const res = {
      status: 0,
      writeHead(s) { this.status = s; },
      end(body) { resolve({ status: this.status, body: JSON.parse(body) }); },
    };
    handlePlayerApi(req, res, path, ctx);
  });
}

test('routes: token for the logged-in player; peers from the live file', async () => {
  try {
    const t = Math.floor(Date.now() / 1000);
    writeFileSync(process.env.LIVE_PATH, JSON.stringify({ t, players: [
      { id: A, x: 0, y: 0, z: 0, yaw: 0 }, { id: B, x: 0, y: 500, z: 0, yaw: 0 },
    ] }));
    const store = new Store();
    store.apply({ type: 'session_start', t, steamId: B, name: 'Bee' });
    const room = new VoiceRoom(cfg, async () => new Response(JSON.stringify({ participants: [
      { identity: voiceIdentity(A, cfg.apiSecret) }, { identity: voiceIdentity(B, cfg.apiSecret) },
    ] })));
    const ctx = { store, serverPhase: async () => 'running', live: () => readLiveState(t), voice: room };

    const tok = await call('POST', `/player-api/voice/${A}/token`, ctx);
    assert.equal(tok.status, 200);
    assert.equal(tok.body.url, 'wss://voice.example.com');
    assert.equal(tok.body.identity, voiceIdentity(A, cfg.apiSecret));
    assert.equal((await call('GET', `/player-api/voice/${A}/token`, ctx)).status, 405);

    const v = await call('GET', `/player-api/voice/${A}`, ctx);
    assert.equal(v.status, 200);
    assert.equal(v.body.inGame, true);
    assert.deepEqual(v.body.peers, [{ id: voiceIdentity(B, cfg.apiSecret), name: 'Bee', gain: 1, pan: 1 }]);
    assert.deepEqual(v.body.audience, [voiceIdentity(B, cfg.apiSecret)]);
    assert.equal(v.body.range, 30);
    assert.deepEqual(tok.body.ranges, [15, 30, 60, 90]);

    assert.equal((await call('POST', `/player-api/voice/${A}/range`, ctx, { range: 45 })).status, 400);
    const set = await call('POST', `/player-api/voice/${A}/range`, ctx, { range: 15 });
    assert.deepEqual(set.body, { range: 15 });
    const whisper = await call('GET', `/player-api/voice/${A}`, ctx);
    assert.deepEqual(whisper.body.audience, [voiceIdentity(B, cfg.apiSecret)], 'B is 5 m away: still inside 15 m');
    assert.equal((await call('GET', `/player-api/voice/${A}/range`, ctx)).status, 405);

    assert.equal(v.body.nameMode, 'name');

    // Panel → Voice: hide names.
    await assert.rejects(saveVoiceSettings({ nameMode: 'steamid' }));
    await saveVoiceSettings({ nameMode: 'id' });
    assert.deepEqual(await readVoiceSettings(), { nameMode: 'id' });
    const tagged = await call('GET', `/player-api/voice/${A}`, ctx);
    assert.equal(tagged.body.peers[0].name, voiceTag(voiceIdentity(B, cfg.apiSecret)));
    assert.match(tagged.body.peers[0].name, /^#[0-9A-F]{4}$/);
    await saveVoiceSettings({ nameMode: 'none' });
    const hidden = await call('GET', `/player-api/voice/${A}`, ctx);
    assert.equal(hidden.body.peers[0].name, null);
    assert.equal(hidden.body.nameMode, 'none');
    const tok2 = await call('POST', `/player-api/voice/${B}/token`, ctx);
    assert.equal(decode(tok2.body.token.split('.')[1]).name, '', 'no name inside the room either');
    await saveVoiceSettings({ nameMode: 'name' });

    const noVoice = await call('GET', `/player-api/voice/${A}`, { ...ctx, voice: undefined });
    assert.equal(noVoice.status, 404);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
