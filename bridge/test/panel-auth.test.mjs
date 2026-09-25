// Who may open the admin panel: the address check, the admin login, the
// login's own write token (panel-auth.ts, panel-gate.ts).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ADMIN = '76561190000000001';     // in Game.ini's AdminsSteamIDs
const OWNER = '76561190000000002';     // in ADMIN_STEAM_IDS only
const PLAYER = '76561190000000003';    // nobody
const TOKEN = 'a'.repeat(40);

const root = mkdtempSync(join(tmpdir(), 'panel-auth-test-'));
process.env.DATA_DIR = join(root, 'data');
process.env.GAME_CONFIG_DIR = join(root, 'cfg');
process.env.ADMIN_TOKEN = TOKEN;
process.env.ADMIN_STEAM_IDS = OWNER;
process.env.PANEL_ALLOWED_IPS = '42.114.212.207, 10.0.0.0/24';
process.env.PANEL_BASE_URL = '';   // not the real .env's (deploy.sh runs the tests with it loaded)
delete process.env.PANEL_SESSION_HOURS;
mkdirSync(process.env.GAME_CONFIG_DIR);
writeFileSync(join(process.env.GAME_CONFIG_DIR, 'Game.ini'),
  `[/Script/TheIsle.TIGameSession]\nServerName=Test\n\n[/Script/TheIsle.TIGameStateBase]\nAdminsSteamIDs=${ADMIN}\n`);

const auth = await import('../dist/panel-auth.js');
const { panelGate, currentLogin } = await import('../dist/panel-gate.js');
after(() => rmSync(root, { recursive: true, force: true }));

test('sessions: signed, unforgeable, expire; the write token belongs to one login', () => {
  const secret = auth.sessionSecret(TOKEN);
  assert.equal(auth.sessionSecret(null), null, 'no ADMIN_TOKEN = no logins');
  const now = 1_000_000;
  const v = auth.signSession(secret, ADMIN, now + 60);
  assert.equal(auth.readSession(secret, v, now), ADMIN);
  assert.equal(auth.readSession(secret, v, now + 61), null, 'expired');
  assert.equal(auth.readSession(secret, v.replace(ADMIN, PLAYER), now), null, 'another SteamID in a valid-looking cookie');
  assert.equal(auth.readSession(auth.sessionSecret('b'.repeat(40)), v, now), null, 'a new ADMIN_TOKEN logs everyone out');
  const other = auth.signSession(secret, ADMIN, now + 120);
  const t = auth.writeToken(secret, v);
  assert.ok(auth.writeAllowed(t, TOKEN, secret, v));
  assert.ok(!auth.writeAllowed(t, TOKEN, secret, other), 'not with another login');
  assert.ok(!auth.writeAllowed(t, TOKEN, secret, undefined), 'not without the cookie');
  assert.ok(auth.writeAllowed(TOKEN, TOKEN, secret, undefined), 'ADMIN_TOKEN still works for scripts');
  assert.ok(!auth.writeAllowed('', TOKEN, secret, v));
  assert.ok(!auth.writeAllowed(undefined, TOKEN, secret, v));
});

test('addresses: exact IPs (v4, v6, v4-mapped) and IPv4 ranges', () => {
  assert.equal(auth.normalizeIp('::ffff:42.114.212.207'), '42.114.212.207');
  assert.equal(auth.normalizeIp('nope'), null);
  assert.ok(auth.ipMatches('42.114.212.207', '42.114.212.207'));
  assert.ok(!auth.ipMatches('42.114.212.208', '42.114.212.207'));
  assert.ok(auth.ipMatches('10.0.0.77', '10.0.0.0/24'));
  assert.ok(!auth.ipMatches('10.0.1.77', '10.0.0.0/24'));
  assert.ok(auth.ipMatches(auth.normalizeIp('2405:4802::1'), '2405:4802:0::1'), 'the same IPv6 written two ways');
  assert.ok(auth.ipMatches(auth.normalizeIp('2405:4802::1'), '2405:4802:0:0:0:0:0:1'));
  assert.ok(!auth.validRule('1.2.3.4/4'), 'too wide a range');
  // A home IPv6: the last half changes every few hours, the /64 stays.
  const home = '2405:4802:1d32:eec0::/64';
  assert.ok(auth.validRule(home));
  assert.ok(auth.ipMatches(auth.normalizeIp('2405:4802:1d32:eec0:bdf0:531f:6da5:dc30'), home));
  assert.ok(auth.ipMatches(auth.normalizeIp('2405:4802:1d32:eec0:c1fa:1d7d:b2fa:ec76'), home));
  assert.ok(!auth.ipMatches(auth.normalizeIp('2405:4802:1d32:eec1::1'), home), 'the neighbour /64');
  assert.ok(!auth.ipMatches('42.114.212.207', home), 'v4 never matches a v6 range');
  assert.ok(!auth.validRule('2405::/16'), 'too wide a v6 range');
  assert.equal(auth.ruleFor(auth.normalizeIp('2405:4802:1d32:eec0:bdf0:531f:6da5:dc30')), auth.normalizeRule(home));
  assert.equal(auth.ruleFor('42.114.212.207'), '42.114.212.207');
  assert.ok(!auth.validRule('example.com'));
});

test('allow list: seeded from PANEL_ALLOWED_IPS; a save must keep the saver\'s own IP', async () => {
  auth.resetAccessCache();
  assert.deepEqual(await auth.readAccess(), { ips: ['42.114.212.207', '10.0.0.0/24'], saved: false });
  await assert.rejects(auth.saveAccess(['1.1.1.1'], '42.114.212.207'), /locked out/);
  await assert.rejects(auth.saveAccess(['not-an-ip'], null), /not an IP/);
  const saved = await auth.saveAccess(['42.114.212.207', ' 42.114.212.207 ', '1.1.1.1'], '42.114.212.207');
  assert.deepEqual(saved, { ips: ['42.114.212.207', '1.1.1.1'], saved: true });
  auth.resetAccessCache();
  assert.deepEqual((await auth.readAccess()).ips, ['42.114.212.207', '1.1.1.1'], 'read back from disk');
});

test('admins: Game.ini\'s AdminsSteamIDs plus ADMIN_STEAM_IDS', async () => {
  const ids = await auth.adminIds(Date.now() + 60_000);
  assert.ok(ids.has(ADMIN) && ids.has(OWNER));
  assert.ok(!ids.has(PLAYER));
});

// --- the door, over HTTP ----------------------------------------------------------
let server; let port;
before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    panelGate(req, res, url, async () => { res.writeHead(200); res.end('img'); }).then((login) => {
      if (login === null) return;
      currentLogin.run(login, () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(login)); });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => server.close());
const get = (path, headers = {}, method = 'GET') => fetch(`http://127.0.0.1:${port}${path}`, { method, headers, redirect: 'manual' });
const cookieFor = (id) => `${auth.COOKIE}=${auth.signSession(auth.sessionSecret(TOKEN), id, Math.floor(Date.now() / 1000) + 3600)}`;

test('check 1: through the web, only allowed addresses get anything — even the login page', async () => {
  auth.resetAccessCache();
  const bad = await get('/login', { 'x-real-ip': '8.8.8.8' });
  assert.equal(bad.status, 403);
  assert.match(await bad.text(), /8\.8\.8\.8/);
  assert.equal((await get('/api/status', { 'x-real-ip': '8.8.8.8', cookie: cookieFor(ADMIN) })).status, 403, 'an admin login does not help from a wrong address');
  assert.equal((await get('/login', { 'x-real-ip': '42.114.212.207' })).status, 200);
  assert.equal((await get('/login')).status, 200, 'through the SSH tunnel (no X-Real-IP)');
  assert.equal((await get('/login', { 'x-real-ip': 'garbage' })).status, 400);
});

test('check 2: no login → the login page (pages) or 401 (API)', async () => {
  const page = await get('/');
  assert.equal(page.status, 303);
  assert.equal(page.headers.get('location'), '/login');
  assert.equal((await get('/api/status')).status, 401);
  assert.equal((await get('/api/status', { cookie: `${auth.COOKIE}=forged` })).status, 401);
});

test('check 2: a game admin or an owner gets in; any other Steam account does not', async () => {
  const a = await get('/api/status', { cookie: cookieFor(ADMIN), 'x-real-ip': '42.114.212.207' });
  assert.equal(a.status, 200);
  const login = await a.json();
  assert.equal(login.steamId, ADMIN);
  assert.equal(login.ip, '42.114.212.207');
  assert.equal((await get('/api/status', { cookie: cookieFor(OWNER) })).status, 200);
  assert.equal((await get('/api/status', { cookie: cookieFor(PLAYER) })).status, 401);
});

test('a script may use ADMIN_TOKEN through 127.0.0.1, never through the web', async () => {
  const r = await get('/api/status', { 'x-admin-token': TOKEN });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).steamId, null);
  assert.equal((await get('/api/status', { 'x-admin-token': TOKEN, 'x-real-ip': '42.114.212.207' })).status, 401);
  assert.equal((await get('/api/status', { 'x-admin-token': 'wrong' })).status, 401);
});

test('Steam login: back to the address the browser used (tunnel); through the web only with PANEL_BASE_URL', async () => {
  const r = await get('/auth/steam');
  assert.equal(r.status, 303);
  const to = new URL(r.headers.get('location'));
  assert.equal(to.origin, 'https://steamcommunity.com');
  assert.equal(to.searchParams.get('openid.return_to'), `http://127.0.0.1:${port}/auth/steam/return`);
  const web = await get('/auth/steam', { 'x-real-ip': '42.114.212.207' });
  assert.equal(web.headers.get('location'), '/login?e=setup', 'no PANEL_BASE_URL set in this test');
  // (fetch() will not send another Host; http.request will.)
  const oddLocation = await new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path: '/auth/steam', headers: { host: 'evil.example' } }, (res) => { res.resume(); resolve(res.headers.location); })
      .on('error', reject).end();
  });
  assert.equal(oddLocation, '/login?e=setup', 'a Host that is not loopback is not trusted');
  const forged = await get('/auth/steam/return?openid.mode=id_res&openid.claimed_id=x');
  assert.equal(forged.headers.get('location'), '/login?e=refused');
});

test('logout clears the cookie', async () => {
  const r = await get('/auth/logout', {}, 'POST');
  assert.equal(r.status, 204);
  assert.match(r.headers.get('set-cookie'), /panel_session=;.*Max-Age=0/);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  assert.match(r.headers.get('set-cookie'), /SameSite=Strict/);
});
