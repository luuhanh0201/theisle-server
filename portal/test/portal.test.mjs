// Player portal: Steam login verification, sessions, scoping, headers, limits.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
const downloads = mkdtempSync(join(tmpdir(), 'portal-dl-'));
writeFileSync(join(downloads, 'XomGay-Launcher-Setup-1.0.0.exe'), 'MZ fake');
writeFileSync(join(downloads, 'latest.yml'), 'version: 1.0.0\n');
const bridge = {
  me: async (id) => { bridgeCalls.push(`me:${id}`); return { status: 200, body: { steamId: id, name: 'Me' } }; },
  leaderboard: async () => ({ status: 200, body: { kills: [] } }),
  server: async () => ({ status: 200, body: { online: 3, phase: 'running' } }),
  ai: async () => { bridgeCalls.push('ai'); return { status: 200, body: { t: 1, stale: false, count: 1, list: [{ s: 'Boar', x: 1, y: 2 }] } }; },
  aiZones: async () => ({ status: 200, body: { zones: [{ name: 'Đồng cỏ', x: 1, y: 2, radiusM: 300, species: ['Heo rừng'], count: 3 }] } }),
  garage: async (id, body) => { bridgeCalls.push({ garage: id, body }); return { status: 202, body: { id: 5, action: body.action } }; },
  command: async (id, n) => { bridgeCalls.push(`command:${id}:${n}`); return { status: 200, body: { status: 'pending' } }; },
  voice: async (id) => { bridgeCalls.push(`voice:${id}`); return { status: 200, body: { inGame: true, peers: [] } }; },
  voiceRange: async (id, range) => { bridgeCalls.push({ voiceRange: id, range }); return { status: 200, body: { range } }; },
  voiceToken: async (id) => { bridgeCalls.push(`voiceToken:${id}`); return { status: 200, body: { url: 'wss://voice.example.com', token: 't' } }; },
};
before(async () => {
  server = createPortal({ baseUrl: BASE, secureCookies: true, sessionSecret: SECRET, sessionDays: 7, trustProxy: true,
    bridge, steamFetch: steamSays(true), voiceUrl: 'wss://voice.example.com', downloadsDir: downloads });
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

test('/api/ai (live AI for the map) needs a login', async () => {
  assert.equal((await get('/api/ai')).status, 401);
  const cookie = `${COOKIE}=${sign(SECRET, ME, Math.floor(Date.now() / 1000) + 600)}`;
  const r = await get('/api/ai', { cookie });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).list[0].s, 'Boar');
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

test('static caching: versioned vendor files for good, the app\'s own scripts revalidated', async () => {
  const lib = await get('/vendor/livekit-client-2.22.3.umd.js');
  assert.equal(lib.status, 200);
  assert.match(lib.headers.get('content-type'), /javascript/);
  assert.match(lib.headers.get('cache-control'), /immutable/);
  const own = await get('/app.js');
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('cache-control'), 'no-cache');
});

test('writes to the API are not allowed', async () => {
  const r = await fetch(`http://127.0.0.1:${port}/api/me`, { method: 'POST' });
  assert.equal(r.status, 405);
});

test('web garage: login, same-origin, JSON only; the SteamID is the session\'s', async () => {
  const cookie = `${COOKIE}=${sign(SECRET, ME, Math.floor(Date.now() / 1000) + 600)}`;
  const origin = new URL(BASE).origin;
  const post = (headers, body) => fetch(`http://127.0.0.1:${port}/api/garage`, { method: 'POST', headers, body, redirect: 'manual' });
  const json = { 'content-type': 'application/json' };
  assert.equal((await post({ ...json, origin }, '{"action":"store"}')).status, 401, 'no login');
  assert.equal((await post({ ...json, cookie, origin: 'https://evil.example' }, '{"action":"store"}')).status, 403, 'another site');
  assert.equal((await post({ ...json, cookie }, '{"action":"store"}')).status, 403, 'no Origin and no Sec-Fetch-Site');
  assert.equal((await post({ cookie, origin, 'content-type': 'text/plain' }, '{"action":"store"}')).status, 415, 'a form cannot post');
  assert.equal((await post({ ...json, cookie, origin }, 'x'.repeat(3000))).status, 400, 'small bodies only');

  const before = bridgeCalls.length;
  const r = await post({ ...json, cookie, origin },
    JSON.stringify({ action: 'store', slot: 'web1', steamId: '76561198000000002', extra: 1 }));
  assert.equal(r.status, 202);
  assert.deepEqual(bridgeCalls.slice(before), [{ garage: ME, body: { action: 'store', slot: 'web1', where: undefined } }],
    'the session SteamID, only action/slot/where forwarded');

  const c = await get('/api/command/5', { cookie });
  assert.equal(c.status, 200);
  assert.equal(bridgeCalls[bridgeCalls.length - 1], `command:${ME}:5`);
  assert.equal((await get('/api/command/5')).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/garage`, { headers: { cookie } })).status, 405, 'GET is not a write');
});

test('voice: login; the token only by POST from our own page; the CSP allows the voice server', async () => {
  const cookie = `${COOKIE}=${sign(SECRET, ME, Math.floor(Date.now() / 1000) + 600)}`;
  const origin = new URL(BASE).origin;
  const tok = (headers) => fetch(`http://127.0.0.1:${port}/api/voice/token`, { method: 'POST', headers });
  assert.equal((await tok({ origin })).status, 401);
  assert.equal((await tok({ cookie, origin: 'https://evil.example' })).status, 403);
  const r = await tok({ cookie, origin });
  assert.equal(r.status, 200);
  assert.equal(bridgeCalls[bridgeCalls.length - 1], `voiceToken:${ME}`);
  assert.equal((await get('/api/voice/token', { cookie })).status, 405);

  assert.equal((await get('/api/voice')).status, 401);
  const v = await get('/api/voice?steamId=76561198000000002', { cookie });
  assert.equal(v.status, 200);
  assert.equal(bridgeCalls[bridgeCalls.length - 1], `voice:${ME}`, 'always the session\'s player');
  const csp = v.headers.get('content-security-policy');
  assert.match(csp, /connect-src 'self' wss:\/\/voice\.example\.com https:\/\/voice\.example\.com;/);
  assert.match(v.headers.get('permissions-policy'), /microphone=\(self\)/);
});

test('after the Steam login: back to the voice page when it asked, never to a URL from outside', async () => {
  const start = await get('/auth/steam?next=voice');
  assert.match(start.headers.get('set-cookie'), /^isle_next=voice; Path=\/auth; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
  assert.equal((await get('/auth/steam?next=https://evil.example')).headers.get('set-cookie'), null);
  const back = await get(`/auth/steam/return?${steamReturn().toString()}`, { cookie: 'isle_next=voice' });
  assert.equal(back.headers.get('location'), '/#voice');
  assert.match(back.headers.get('set-cookie'), /isle_next=; Path=\/auth; HttpOnly; SameSite=Lax; Max-Age=0/);
  const other = await get(`/auth/steam/return?${steamReturn().toString()}`, { cookie: 'isle_next=//evil.example' });
  assert.equal(other.headers.get('location'), '/');
});

test('voice range: login, same-origin, JSON; the session\'s player', async () => {
  const cookie = `${COOKIE}=${sign(SECRET, ME, Math.floor(Date.now() / 1000) + 600)}`;
  const origin = new URL(BASE).origin;
  const post = (headers, body) => fetch(`http://127.0.0.1:${port}/api/voice/range`, { method: 'POST', headers, body });
  const json = { 'content-type': 'application/json' };
  assert.equal((await post({ ...json, origin }, '{"range":60}')).status, 401);
  assert.equal((await post({ ...json, cookie, origin: 'https://evil.example' }, '{"range":60}')).status, 403);
  assert.equal((await post({ cookie, origin, 'content-type': 'text/plain' }, '{"range":60}')).status, 415);
  const r = await post({ ...json, cookie, origin }, '{"range":60,"steamId":"76561198000000002"}');
  assert.equal(r.status, 200);
  assert.deepEqual(bridgeCalls[bridgeCalls.length - 1], { voiceRange: ME, range: 60 });
});

test('launcher login: browser login hands the session to the launcher that started it, once, same address', async () => {
  const at = (ip) => ({ 'x-forwarded-for': ip });
  const start = await fetch(`http://127.0.0.1:${port}/auth/launcher/start`, { method: 'POST', headers: at('1.2.3.4') });
  const { state, url } = await start.json();
  assert.match(state, /^[0-9a-f]{64}$/);
  assert.equal(url, `${BASE}/auth/steam?launcher=${state}`);
  const claim = (ip) => fetch(`http://127.0.0.1:${port}/auth/launcher/claim`, { method: 'POST', headers: { ...at(ip), 'content-type': 'application/json' }, body: JSON.stringify({ state }) });
  assert.deepEqual(await (await claim('1.2.3.4')).json(), { status: 'pending' });

  const open = await get(`/auth/steam?launcher=${state}`, at('1.2.3.4'));
  assert.match(open.headers.get('location'), /^https:\/\/steamcommunity\.com\/openid\/login/);
  assert.match(open.headers.get('set-cookie'), new RegExp(`^isle_next=launcher\\.${state};`));
  assert.equal((await get('/auth/steam?launcher=' + 'a'.repeat(64), at('1.2.3.4'))).headers.get('location'), '/launcher-done.html?error=expired');

  const back = await get(`/auth/steam/return?${steamReturn().toString()}`, { ...at('1.2.3.4'), cookie: `isle_next=launcher.${state}` });
  assert.equal(back.headers.get('location'), '/launcher-done.html');

  assert.deepEqual(await (await claim('9.9.9.9')).json(), { status: 'other-address' });
  const done = await (await claim('1.2.3.4')).json();
  assert.equal(done.status, 'done');
  assert.equal(done.cookie.name, COOKIE);
  assert.equal(readSession(SECRET, done.cookie.value), ME);
  assert.equal((await claim('1.2.3.4')).status, 410, 'claimed once');
});

test('launcher login: a browser on another address cannot complete someone else\'s launcher login', async () => {
  const { state } = await (await fetch(`http://127.0.0.1:${port}/auth/launcher/start`, { method: 'POST', headers: { 'x-forwarded-for': '5.5.5.5' } })).json();
  const back = await get(`/auth/steam/return?${steamReturn().toString()}`, { 'x-forwarded-for': '6.6.6.6', cookie: `isle_next=launcher.${state}` });
  assert.equal(back.headers.get('location'), '/launcher-done.html?error=other-address');
  const r = await fetch(`http://127.0.0.1:${port}/auth/launcher/claim`, { method: 'POST', headers: { 'x-forwarded-for': '5.5.5.5' }, body: JSON.stringify({ state }) });
  assert.equal(r.status, 410);
});

test('/tai/: installers and the update feed, nothing else', async () => {
  const exe = await get('/tai/XomGay-Launcher-Setup-1.0.0.exe');
  assert.equal(exe.status, 200);
  assert.equal(await exe.text(), 'MZ fake');
  assert.match(exe.headers.get('cache-control'), /immutable/);
  assert.match(exe.headers.get('content-disposition'), /attachment/);
  const feed = await get('/tai/latest.yml');
  assert.equal(feed.headers.get('cache-control'), 'no-cache');
  assert.equal((await get('/tai/missing.exe')).status, 404);
  assert.equal((await get('/tai/..%2Fpackage.json')).status, 404);
  assert.equal((await get('/tai/notes.txt')).status, 404, 'only installer / feed types');
});

test('Steam unreachable: a launcher login lands on its page with the reason, and the launcher is told', async () => {
  const flaky = async () => { throw new Error('ETIMEDOUT'); };
  const srv = createPortal({ baseUrl: BASE, secureCookies: true, sessionSecret: SECRET, sessionDays: 7, trustProxy: true, bridge, steamFetch: flaky });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const p2 = srv.address().port;
  try {
    const at = { 'x-forwarded-for': '7.7.7.7' };
    const { state } = await (await fetch(`http://127.0.0.1:${p2}/auth/launcher/start`, { method: 'POST', headers: at })).json();
    const back = await fetch(`http://127.0.0.1:${p2}/auth/steam/return?${steamReturn().toString()}`, { headers: { ...at, cookie: `isle_next=launcher.${state}` }, redirect: 'manual' });
    assert.equal(back.headers.get('location'), '/launcher-done.html?error=steam', 'never the web home');
    const claim = await fetch(`http://127.0.0.1:${p2}/auth/launcher/claim`, { method: 'POST', headers: { ...at, 'content-type': 'application/json' }, body: JSON.stringify({ state }) });
    assert.deepEqual(await claim.json(), { status: 'steam' });
    const web = await fetch(`http://127.0.0.1:${p2}/auth/steam/return?${steamReturn().toString()}`, { headers: { cookie: 'isle_next=voice' }, redirect: 'manual' });
    assert.match(web.headers.get('location'), /^\/\?login_error=Steam%20kh%C3%B4ng.*#voice$/, 'web: Vietnamese reason, back to the voice tab');
  } finally {
    srv.close();
  }
});

test('AI zones for the map: public, as the bridge gives them', async () => {
  const r = await get('/api/ai-zones');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.zones[0].name, 'Đồng cỏ');
  assert.equal(body.zones[0].radiusM, 300);
});
