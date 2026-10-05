// The super admin (SUPER_ADMIN_STEAM_ID) gets into the panel from any address;
// every other admin still needs an address on the allow list (panel-gate.ts).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ADMIN = '76561190000000001';     // in Game.ini's AdminsSteamIDs
const SUPER = '76561190000000009';     // the super admin
const TOKEN = 'b'.repeat(40);

const root = mkdtempSync(join(tmpdir(), 'panel-super-test-'));
process.env.DATA_DIR = join(root, 'data');
process.env.GAME_CONFIG_DIR = join(root, 'cfg');
process.env.ADMIN_TOKEN = TOKEN;
process.env.ADMIN_STEAM_IDS = '';
process.env.SUPER_ADMIN_STEAM_ID = SUPER;
process.env.PANEL_ALLOWED_IPS = '42.114.212.207';
process.env.PANEL_BASE_URL = '';
mkdirSync(process.env.GAME_CONFIG_DIR);
writeFileSync(join(process.env.GAME_CONFIG_DIR, 'Game.ini'),
  `[/Script/TheIsle.TIGameSession]\nServerName=Test\n\n[/Script/TheIsle.TIGameStateBase]\nAdminsSteamIDs=${ADMIN}\n`);

const auth = await import('../dist/panel-auth.js');
const { panelGate } = await import('../dist/panel-gate.js');
after(() => rmSync(root, { recursive: true, force: true }));

let server; let port;
before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    panelGate(req, res, url, async () => { res.writeHead(200); res.end('img'); }).then((login) => {
      if (login === null) return;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(login));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => server.close());
const get = (path, headers = {}, method = 'GET') => fetch(`http://127.0.0.1:${port}${path}`, { method, headers, redirect: 'manual' });
const cookieFor = (id) => `${auth.COOKIE}=${auth.signSession(auth.sessionSecret(TOKEN), id, Math.floor(Date.now() / 1000) + 3600)}`;
const AWAY = { 'x-real-ip': '8.8.8.8' };   // not on the allow list

test('from an address not on the list: the login pages open (for the super admin to sign in)', async () => {
  auth.resetAccessCache();
  const page = await get('/login', AWAY);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /chỉ admin tổng/);
  assert.equal((await get('/img/logo-96.webp', AWAY)).status, 200);
  assert.equal((await get('/login?e=ip', AWAY)).status, 200);
});

test('from there: the super admin\'s login gets in; another admin\'s, or none, does not', async () => {
  const s = await get('/api/status', { ...AWAY, cookie: cookieFor(SUPER) });
  assert.equal(s.status, 200);
  assert.equal((await s.json()).steamId, SUPER);
  assert.equal((await get('/', { ...AWAY, cookie: cookieFor(SUPER) })).status, 200, 'the panel page itself');
  assert.equal((await get('/api/status', { ...AWAY, cookie: cookieFor(ADMIN) })).status, 403, 'an admin still needs an allowed address');
  const page = await get('/', { ...AWAY, cookie: cookieFor(ADMIN) });
  assert.deepEqual([page.status, page.headers.get('location')], [303, '/login'], 'a page: to the login page (Steam decides)');
  const fresh = await get('/', AWAY);
  assert.deepEqual([fresh.status, fresh.headers.get('location')], [303, '/login'],
    'no session (a new address, a new browser): the login page, not a dead end, the super admin signs in from there');
  assert.equal((await get('/api/status', AWAY)).status, 403, 'no login: refused, not asked to log in');
  assert.equal((await get('/api/status', { ...AWAY, cookie: `${auth.COOKIE}=forged` })).status, 403);
});

test('from an allowed address: as before', async () => {
  const ok = { 'x-real-ip': '42.114.212.207' };
  assert.equal((await get('/api/status', { ...ok, cookie: cookieFor(ADMIN) })).status, 200);
  assert.equal((await get('/api/status', { ...ok, cookie: cookieFor(SUPER) })).status, 200);
  assert.equal((await get('/api/status', ok)).status, 401);
});
