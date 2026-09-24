// Player portal: Steam login verification, sessions, scoping, headers, limits.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';

const { verify, loginUrl, NonceCache, STEAM_OPENID } = await import('../dist/steam.js');
const { sign, readSession, cookieHeader, COOKIE } = await import('../dist/session.js');
const { RateLimit } = await import('../dist/ratelimit.js');
const { createPortal } = await import('../dist/server.js');

const BASE = 'https://play.example.com';
const ME = '76561198000000001';
const SECRET = 'x'.repeat(40);

function steamReturn(overrides = {}) {
  const claimed = `https://steamcommunity.com/openid/id/${ME}`;
  return new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': STEAM_OPENID,
    'openid.claimed_id': claimed,
    'openid.identity': claimed,
    'openid.return_to': `${BASE}/auth/steam/return`,
    'openid.response_nonce': `2026-09-24T10:00:00Z${Math.random()}`,
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'c2lnbmF0dXJl',
    ...overrides,
  });
}
const steamSays = (valid) => {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, body: String(init.body) }); return { text: async () => `ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n` }; };
  f.calls = calls;
  return f;
};

test('login URL goes to Steam with our return address', () => {
  const u = new URL(loginUrl(BASE));
  assert.equal(`${u.origin}${u.pathname}`, STEAM_OPENID);
  assert.equal(u.searchParams.get('openid.return_to'), `${BASE}/auth/steam/return`);
  assert.equal(u.searchParams.get('openid.realm'), BASE);
});

test('a genuine Steam response logs in, after Steam itself confirms it', async () => {
  const f = steamSays(true);
  const r = await verify(steamReturn(), BASE, new NonceCache(), f);
  assert.deepEqual(r, { ok: true, steamId: ME });
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].body, /openid\.mode=check_authentication/);
  assert.match(f.calls[0].body, /openid\.sig=c2lnbmF0dXJl/, 'every field sent back as received');
});

test('forged or tampered responses are refused', async () => {
  const nonces = new NonceCache();
  assert.equal((await verify(steamReturn(), BASE, nonces, steamSays(false))).ok, false, 'Steam says invalid');
  assert.match((await verify(steamReturn({ 'openid.op_endpoint': 'https://evil.example/login' }), BASE, nonces, steamSays(true))).reason, /endpoint/);
  assert.match((await verify(steamReturn({ 'openid.return_to': 'https://evil.example/auth/steam/return' }), BASE, nonces, steamSays(true))).reason, /return URL/);
  assert.match((await verify(steamReturn({ 'openid.claimed_id': 'https://steamcommunity.com/openid/id/123' }), BASE, nonces, steamSays(true))).reason, /Steam ID/);
  assert.match((await verify(steamReturn({ 'openid.mode': 'cancel' }), BASE, nonces, steamSays(true))).reason, /cancelled/);
  const down = async () => { throw new Error('ETIMEDOUT'); };
  assert.match((await verify(steamReturn(), BASE, nonces, down)).reason, /did not answer/);
});

test('a login link cannot be replayed', async () => {
  const nonces = new NonceCache();
  const q = steamReturn({ 'openid.response_nonce': '2026-09-24T10:00:00Zabc' });
  assert.equal((await verify(q, BASE, nonces, steamSays(true))).ok, true);
  assert.match((await verify(q, BASE, nonces, steamSays(true))).reason, /already used/);
});

test('session cookie: valid, tampered, expired, other secret', () => {
  const now = 1_000_000;
  const v = sign(SECRET, ME, now + 60);
  assert.equal(readSession(SECRET, v, now), ME);
  assert.equal(readSession(SECRET, v.replace(ME, '76561198000000002'), now), null, 'swapping the SteamID breaks the MAC');
  assert.equal(readSession(SECRET, v, now + 61), null, 'expired');
  assert.equal(readSession('y'.repeat(40), v, now), null, 'another secret');
  assert.equal(readSession(SECRET, 'garbage', now), null);
  assert.match(cookieHeader(v, 60, true), /HttpOnly; SameSite=Lax; Max-Age=60; Secure$/);
  assert.doesNotMatch(cookieHeader(v, 60, false), /Secure/, 'plain-HTTP dev setup');
});

test('rate limit per key and window', () => {
  const rl = new RateLimit(2, 1000);
  assert.equal(rl.allow('a', 0), true);
  assert.equal(rl.allow('a', 1), true);
  assert.equal(rl.allow('a', 2), false);
  assert.equal(rl.allow('b', 2), true, 'other clients unaffected');
  assert.equal(rl.allow('a', 1001), true, 'new window');
});

// --- the HTTP server, against a fake bridge ---------------------------------
let server; let port; const bridgeCalls = [];
const bridge = {
  me: async (id) => { bridgeCalls.push(`me:${id}`); return { status: 200, body: { steamId: id, name: 'Me' } }; },
  leaderboard: async () => ({ status: 200, body: { kills: [] } }),
  server: async () => ({ status: 200, body: { online: 3, phase: 'running' } }),
};
before(async () => {
  server = createPortal({ baseUrl: BASE, secureCookies: true, sessionSecret: SECRET, sessionDays: 7, trustProxy: true,
    bridge, steamFetch: steamSays(true) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => server.close());
const get = (path, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, { headers, redirect: 'manual' });

test('/api/me needs a login, and returns ONLY the logged-in player', async () => {
  assert.equal((await get('/api/me')).status, 401);
  const cookie = `${COOKIE}=${sign(SECRET, ME, Math.floor(Date.now() / 1000) + 600)}`;
  const r = await get('/api/me?steamId=76561198000000002', { cookie });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).steamId, ME, 'a steamId in the query is ignored');
  assert.deepEqual(bridgeCalls, [`me:${ME}`]);
});

test('the Steam round trip sets a Secure HttpOnly cookie', async () => {
  const r = await get(`/auth/steam/return?${steamReturn().toString()}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/');
  assert.match(r.headers.get('set-cookie'), new RegExp(`^${COOKIE}=${ME}\\.\\d+\\.[\\w-]+; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$`));
  const start = await get('/auth/steam');
  assert.match(start.headers.get('location'), /^https:\/\/steamcommunity\.com\/openid\/login\?/);
});

test('security headers on every response; no path traversal', async () => {
  const r = await get('/api/server');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal((await get('/../package.json')).status, 404);
  assert.equal((await get('/%2e%2e/src/session.ts')).status, 404);
});

test('writes to the API are not allowed', async () => {
  const r = await fetch(`http://127.0.0.1:${port}/api/me`, { method: 'POST' });
  assert.equal(r.status, 405);
});
