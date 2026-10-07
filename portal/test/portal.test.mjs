// Player portal: Steam login verification, sessions, scoping, headers, limits.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
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
  heatmap: async () => ({ status: 200, body: { t: 1, next: 300, cell: 50000, players: 2, cells: [{ x: 25000, y: 25000, n: 2 }] } }),
  claimQuest: async (steamId, quest) => { bridgeCalls.push(`quest:${steamId}:${quest}`); return { status: 200, body: { reward: 100, balance: 100, label: 'Hạ 1 dino' } }; },
  claimStarter: async (steamId) => { bridgeCalls.push(`starter:${steamId}`); return { status: 200, body: { item: 'Phiếu chọn dino' } }; },
  shop: async (steamId) => { bridgeCalls.push(`shop:${steamId}`); return { status: 200, body: { listings: [] } }; },
  shopBuy: async (steamId, body) => { bridgeCalls.push({ shopBuy: steamId, body }); return { status: 200, body: { item: 'Hộp food nhỏ', qty: 2, spent: 100, balance: 0, left: 1 } }; },
  checkin: async (steamId) => { bridgeCalls.push(`checkin:${steamId}`); return { status: 200, body: { day: 1, reward: 50, balance: 50, item: null } }; },
  itemOptions: async (steamId, kind, uid) => { bridgeCalls.push(`opts:${steamId}:${kind}:${uid}`); return { status: 200, body: { pick: 'random' } }; },
  openLoot: async (steamId, body) => { bridgeCalls.push({ openLoot: steamId, body }); return { status: 200, body: { won: { name: 'Phiếu Prime', qty: 1 } } }; },
  lootOptions: async (steamId, uid) => { bridgeCalls.push(`loot:${steamId}:${uid}`); return { status: 200, body: { pool: [] } }; },
  openBox: async (steamId, body) => { bridgeCalls.push({ openBox: steamId, body }); return { status: 200, body: { uid: 'own_10', species: 'triceratops', label: 'Triceratops', growth: 0.7, drawn: true } }; },
  useDino: async (steamId, body) => { bridgeCalls.push({ useDino: steamId, body }); return { status: 200, body: { slot: '3', species: 'Tyrannosaurus', growth: 0.8, female: true, mutations: {} } }; },
  garage: async (id, body) => { bridgeCalls.push({ garage: id, body }); return { status: 202, body: { id: 5, action: body.action } }; },
  skin: async (id, body) => { bridgeCalls.push({ skin: id, body }); return { status: 202, body: { id: 6, action: 'skin' } }; },
  useItem: async (id, body) => { bridgeCalls.push({ useItem: id, body }); return { status: 202, body: { id: 7, action: 'mutation' } }; },
  previewItem: async (id, uid) => { bridgeCalls.push(`previewItem:${id}:${uid}`); return { status: 200, body: { stacks: 1 } }; },
  command: async (id, n) => { bridgeCalls.push(`command:${id}:${n}`); return { status: 200, body: { status: 'pending' } }; },
  voice: async (id) => { bridgeCalls.push(`voice:${id}`); return { status: 200, body: { inGame: true, peers: [] } }; },
  voiceRange: async (id, range) => { bridgeCalls.push({ voiceRange: id, range }); return { status: 200, body: { range } }; },
  voiceToken: async (id) => { bridgeCalls.push(`voiceToken:${id}`); return { status: 200, body: { url: 'wss://voice.example.com', token: 't' } }; },
  tele: async (id, body) => { bridgeCalls.push({ tele: id, body }); return { status: 202, body: { id: 8, action: 'tele' } }; },
  friends: async (id) => { bridgeCalls.push(`friends:${id}`); return { status: 200, body: { friends: [], incoming: [], outgoing: [] } }; },
  friendsAction: async (id, body) => { bridgeCalls.push({ friendsAction: id, body }); return { status: 200, body: body.action === 'search' ? { results: [] } : { ok: true } }; },
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

test('/api/heatmap (players per square, every 5 minutes) needs a login', async () => {
  assert.equal((await get('/api/heatmap')).status, 401);
  const cookie = `${COOKIE}=${sign(SECRET, ME, Math.floor(Date.now() / 1000) + 600)}`;
  const r = await get('/api/heatmap', { cookie });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).cells, [{ x: 25000, y: 25000, n: 2 }]);
});

test('the check-in and the dino ticket: login, same-origin; the SteamID is the session\'s, only the pick forwarded', async () => {
  const cookie = `${COOKIE}=${sign(SECRET, ME, Math.floor(Date.now() / 1000) + 600)}`;
  const origin = new URL(BASE).origin;
  const post = (path, headers, body = '{}') => fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers, body, redirect: 'manual' });
  const json = { 'content-type': 'application/json' };
  assert.equal((await post('/api/checkin', { ...json, origin })).status, 401, 'no login');
  assert.equal((await post('/api/checkin', { ...json, cookie, origin: 'https://evil.example' })).status, 403, 'another site');
  const r = await post('/api/checkin', { ...json, cookie, origin });
  assert.equal(r.status, 200);
  assert.equal(bridgeCalls[bridgeCalls.length - 1], `checkin:${ME}`);
  const buy = JSON.stringify({ listing: 'sh_1', qty: 2, price: 1, steamId: '76561198000000002' });
  assert.equal((await post('/api/shop/buy', { ...json, origin }, buy)).status, 401, 'the shop: no login');
  assert.equal((await post('/api/shop/buy', { ...json, cookie, origin: 'https://evil.example' }, buy)).status, 403, 'the shop: another site');
  assert.equal((await post('/api/shop/buy', { ...json, cookie, origin }, buy)).status, 200);
  assert.deepEqual(bridgeCalls[bridgeCalls.length - 1], { shopBuy: ME, body: { listing: 'sh_1', qty: 2 } }, 'the shop: no price, no SteamID from the browser');
  assert.equal((await post('/api/starter/claim', { ...json, origin })).status, 401, 'the gift: no login');
  assert.equal((await post('/api/starter/claim', { ...json, cookie, origin: 'https://evil.example' })).status, 403, 'the gift: another site');
  assert.equal((await post('/api/starter/claim', { ...json, cookie, origin }, '{"steamId":"76561198000000002"}')).status, 200);
  assert.equal(bridgeCalls[bridgeCalls.length - 1], `starter:${ME}`, 'the gift: the session SteamID');
  assert.equal((await post('/api/quests/claim', { ...json, cookie, origin: 'https://evil.example' }, '{"quest":"hunt"}')).status, 403);
  assert.equal((await post('/api/quests/claim', { ...json, cookie, origin }, '{"quest":"hunt","steamId":"76561198000000002"}')).status, 200);
  assert.equal(bridgeCalls[bridgeCalls.length - 1], `quest:${ME}:hunt`, 'the session SteamID, the quest only');
  const pick = JSON.stringify({ uid: 'own_9', species: 'Tyrannosaurus', female: true, mutations: { 1: 'Hemomania' }, steamId: '76561198000000002', growth: 1 });
  assert.equal((await post('/api/items/dino', { ...json, cookie, origin: 'https://evil.example' }, pick)).status, 403);
  assert.equal((await post('/api/items/dino', { ...json, cookie, origin }, pick)).status, 200);
  assert.deepEqual(bridgeCalls[bridgeCalls.length - 1], { useDino: ME, body: { uid: 'own_9', female: true, mutations: { 1: 'Hemomania' } } },
    'no SteamID, no growth, no species from the browser');
  const open = JSON.stringify({ uid: 'own_8', species: 'Triceratops', steamId: '76561198000000002', growth: 1 });
  assert.equal((await post('/api/items/open', { ...json, cookie, origin: 'https://evil.example' }, open)).status, 403);
  assert.equal((await post('/api/items/open', { ...json, cookie, origin }, open)).status, 200);
  assert.deepEqual(bridgeCalls[bridgeCalls.length - 1], { openBox: ME, body: { uid: 'own_8', species: 'Triceratops' } }, 'a box: the uid and the species only');
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/items/box-options/own_8`)).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/items/dino-options/own_10`, { headers: { cookie } })).status, 200);
  assert.equal(bridgeCalls[bridgeCalls.length - 1], `opts:${ME}:dino:own_10`);
  // A hòm: another player's session (the write limit, 12 a minute, is per player).
  const LOOTER = '76561198000000077';
  const lootCookie = `${COOKIE}=${sign(SECRET, LOOTER, Math.floor(Date.now() / 1000) + 600)}`;
  assert.equal((await post('/api/items/loot', { ...json, cookie: lootCookie, origin: 'https://evil.example' }, '{"uid":"own_7"}')).status, 403, 'a hòm: another site');
  assert.equal((await post('/api/items/loot', { ...json, cookie: lootCookie, origin }, '{"uid":"own_7","steamId":"76561198000000002","won":"x"}')).status, 200);
  assert.deepEqual(bridgeCalls[bridgeCalls.length - 1], { openLoot: LOOTER, body: { uid: 'own_7' } }, 'a hòm: the uid only');
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/items/loot-options/own_7`, { headers: { cookie: lootCookie } })).status, 200);
  assert.equal(bridgeCalls[bridgeCalls.length - 1], `loot:${LOOTER}:own_7`);
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
  const page = await get('/tai.html');
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
  const own = await get('/map.js');
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('cache-control'), 'no-cache');
});

test('the site in React at / and /next/ (built from web/apps/portal), /next goes there; its hashed files cached for good', async () => {
  const r = await get('/next');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/next/');
  const page = await get('/next/');
  const built = existsSync(new URL('../public/next/index.html', import.meta.url));
  assert.equal(page.status, built ? 200 : 404, 'the React page when built, a plain 404 otherwise');
  if (built) {
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    const html = await page.text();
    assert.doesNotMatch(html, /<script>(?!<\/script>)/, 'no inline script (the CSP refuses it)');
    const js = /src="(\/next\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    assert.ok(js, 'the app script');
    const a = await get(js);
    assert.equal(a.status, 200);
    assert.match(a.headers.get('cache-control'), /immutable/);
  }
  // / is the same page; the site before React is gone (git tag old-sites-20261007), its files too.
  const root = await get('/');
  assert.equal(root.status, built ? 200 : 404);
  if (built) assert.equal(await root.text(), await (await get('/next/')).text());
  for (const gone of ['/app.js', '/voice.js', '/overlay-settings.js', '/index.html']) assert.equal((await get(gone)).status, 404, gone);
  // The pages of their own: their React pages at the same addresses (the launcher loads /bigmap.html, Steam's login
  // ends on /launcher-done.html); their old scripts are gone.
  for (const pg of ['tai', 'mutations', 'launcher-done', 'bigmap']) {
    const r3 = await get(`/${pg}.html`);
    const builtPg = existsSync(new URL(`../public/next/${pg}.html`, import.meta.url));
    assert.equal(r3.status, builtPg ? 200 : 404, pg);
    if (builtPg) {
      const html = await r3.text();
      assert.match(html, /src="\/next\/assets\/[^"]+\.js"/, pg);
      assert.doesNotMatch(html, /<script>(?!<\/script>)/, `${pg}: no inline script`);
      assert.equal(html, await (await get(`/next/${pg}.html`)).text(), pg);
    }
    assert.equal((await get(`/${pg}.js`)).status, 404, `${pg}.js`);
  }
  // The old voice address still goes to the voice page.
  assert.match(await (await get('/voice.html')).text(), /url=\/#voice/);
  // An old address (/old, its bookmarks): the site, the browser keeps the #page.
  for (const old of ['/old', '/old/']) {
    const r2 = await get(old);
    assert.deepEqual([r2.status, r2.headers.get('location')], [302, '/'], old);
  }
});

test('e2e only: with oldSiteDir the site before React is served at / (its own files from there, the shared ones from public/)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'isle-old-site-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>old</title><script src="/app.js"></script>');
  writeFileSync(join(dir, 'app.js'), '// old app');
  const srv = createPortal({ baseUrl: BASE, secureCookies: true, sessionSecret: SECRET, sessionDays: 7, trustProxy: true, bridge, oldSiteDir: dir,
    // The same voice server: the security headers are the module's, the last portal made sets them.
    voiceUrl: 'wss://voice.example.com' });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const at = (path) => fetch(`http://127.0.0.1:${srv.address().port}${path}`, { redirect: 'manual' });
  try {
    assert.match(await (await at('/')).text(), /<title>old<\/title>/);
    assert.equal(await (await at('/app.js')).text(), '// old app');
    assert.equal((await at('/map.js')).status, 200, 'shared files still from public/');
    assert.equal((await at('/voice.js')).status, 404, 'an old file not in the folder');
    writeFileSync(join(dir, 'tai.html'), '<!doctype html><title>old tai</title>');
    assert.match(await (await at('/tai.html')).text(), /old tai/, 'an old page of its own from there too');
    assert.equal((await at('/../package.json')).status, 404);
  } finally { srv.close(); }
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

test('skin: login, same-origin, JSON only; the SteamID is the session\'s, only the skin fields forwarded', async () => {
  const cookie = `${COOKIE}=${sign(SECRET, ME, Math.floor(Date.now() / 1000) + 600)}`;
  const origin = new URL(BASE).origin;
  const post = (headers, body) => fetch(`http://127.0.0.1:${port}/api/skin`, { method: 'POST', headers, body, redirect: 'manual' });
  const json = { 'content-type': 'application/json' };
  const skin = { colors: { Body: { r: 0.5, g: 0.2, b: 0.1 } }, pattern: 1, theme: 0, variation: 3 };
  assert.equal((await post({ ...json, origin }, JSON.stringify(skin))).status, 401, 'no login');
  assert.equal((await post({ ...json, cookie, origin: 'https://evil.example' }, JSON.stringify(skin))).status, 403, 'another site');
  assert.equal((await post({ cookie, origin, 'content-type': 'text/plain' }, JSON.stringify(skin))).status, 415);
  const before = bridgeCalls.length;
  const r = await post({ ...json, cookie, origin }, JSON.stringify({ ...skin, steamId: '76561198000000002' }));
  assert.equal(r.status, 202);
  assert.deepEqual(bridgeCalls.slice(before), [{ skin: ME, body: { ...skin, effects: undefined, keep: undefined, forget: undefined, item: undefined } }]);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/skin`, { headers: { cookie } })).status, 405);
});

test('bag: use a mutation item, login, same-origin, JSON only; the SteamID is the session\'s, only uid / slot / mutation forwarded', async () => {
  const cookie = `${COOKIE}=${sign(SECRET, ME, Math.floor(Date.now() / 1000) + 600)}`;
  const origin = new URL(BASE).origin;
  const post = (headers, body) => fetch(`http://127.0.0.1:${port}/api/items/use`, { method: 'POST', headers, body, redirect: 'manual' });
  const json = { 'content-type': 'application/json' };
  const use = JSON.stringify({ uid: 'own_1', slot: 3, steamId: '76561198000000002', mutation: 'Hax' });
  assert.equal((await post({ ...json, origin }, use)).status, 401, 'no login');
  assert.equal((await post({ ...json, cookie, origin: 'https://evil.example' }, use)).status, 403, 'another site');
  assert.equal((await post({ cookie, origin, 'content-type': 'text/plain' }, use)).status, 415);
  const before = bridgeCalls.length;
  assert.equal((await post({ ...json, cookie, origin }, use)).status, 202);
  assert.deepEqual(bridgeCalls.slice(before), [{ useItem: ME, body: { uid: 'own_1', slot: 3, upgrade: undefined, mutation: 'Hax' } }],
    'the steamId sent is dropped; the picked mutation goes on, the bridge checks it against the ticket');
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/items/use`, { headers: { cookie } })).status, 405);
  assert.equal((await get('/api/items/preview/own_1')).status, 401, 'the preview: login');
  const pv = await get('/api/items/preview/own_1', { cookie });
  assert.equal(pv.status, 200);
  assert.equal(bridgeCalls[bridgeCalls.length - 1], `previewItem:${ME}:own_1`, 'for the session SteamID');
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

test('tele and friends: login, same-origin, JSON; the session\'s player, only the allowed fields', async () => {
  // A player of its own: the write limit (12 a minute) is per player and the tests above used ME's.
  const TF = '76561198000000077';
  const cookie = `${COOKIE}=${sign(SECRET, TF, Math.floor(Date.now() / 1000) + 600)}`;
  const origin = new URL(BASE).origin;
  const post = (path, headers, body) => fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers, body });
  const json = { 'content-type': 'application/json' };
  assert.equal((await post('/api/tele', { ...json, origin }, '{"action":"code"}')).status, 401);
  assert.equal((await post('/api/tele', { ...json, cookie, origin: 'https://evil.example' }, '{"action":"code"}')).status, 403);
  assert.equal((await post('/api/tele', { cookie, origin, 'content-type': 'text/plain' }, '{"action":"code"}')).status, 415);
  const r = await post('/api/tele', { ...json, cookie, origin }, '{"action":"use","code":"ABC234","steamId":"76561198000000002","target":"x"}');
  assert.equal(r.status, 202);
  assert.deepEqual(bridgeCalls[bridgeCalls.length - 1], { tele: TF, body: { action: 'use', code: 'ABC234' } });
  assert.equal((await get('/api/friends')).status, 401);
  assert.equal((await get('/api/friends', { cookie })).status, 200);
  assert.equal(bridgeCalls[bridgeCalls.length - 1], `friends:${TF}`);
  assert.equal((await get('/api/friends/search?q=rex', { cookie })).status, 200);
  assert.deepEqual(bridgeCalls[bridgeCalls.length - 1], { friendsAction: TF, body: { action: 'search', q: 'rex' } });
  assert.equal((await post('/api/friends', { ...json, cookie, origin: 'https://evil.example' }, '{"action":"request","ref":"abcdefghijklmnop"}')).status, 403);
  const f = await post('/api/friends', { ...json, cookie, origin }, '{"action":"request","ref":"abcdefghijklmnop","steamId":"76561198000000002"}');
  assert.equal(f.status, 200);
  assert.deepEqual(bridgeCalls[bridgeCalls.length - 1], { friendsAction: TF, body: { action: 'request', ref: 'abcdefghijklmnop' } });
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

// --- traffic for the panel's "Truy cập" (traffic.ts → bridge traffic.ts) ------------------
test('traffic: page loads, download clicks, launchers, installers served and players using it reach the bridge', async () => {
  const tracked = [];
  const tb = { ...bridge, track: async (e) => { tracked.push(e); return { status: 200, body: {} }; } };
  const srv = createPortal({ baseUrl: BASE, secureCookies: true, sessionSecret: SECRET, sessionDays: 7, trustProxy: true,
    bridge: tb, steamFetch: steamSays(true), downloadsDir: downloads });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const p = srv.address().port;
  const post = (path, body, headers = {}) => fetch(`http://127.0.0.1:${p}${path}`, { method: 'POST', body: JSON.stringify(body), headers });
  const LAUNCHER_UA = 'Mozilla/5.0 XomGayLauncher/1.0.33 Electron/44';
  try {
    assert.equal((await post('/api/track/view', {}, { origin: BASE })).status, 204);
    await post('/api/track/view', {}, { origin: BASE, 'user-agent': LAUNCHER_UA });
    await post('/api/track/view', {}, { origin: 'https://evil.example' });                    // another site: not counted
    await post('/api/track/download', { os: 'linux' }, { origin: BASE });
    await post('/api/track/download', { os: 'mac' }, { origin: BASE });                       // not an OS we ship
    await post('/api/track/launcher', { id: 'a'.repeat(32), version: '1.0.33', os: 'win', first: true }, { 'user-agent': LAUNCHER_UA });
    await post('/api/track/launcher', { id: 'b'.repeat(32), version: '1.0.33', os: 'win' }, { 'user-agent': 'curl/8' });   // not the launcher
    await (await fetch(`http://127.0.0.1:${p}/tai/XomGay-Launcher-Setup-1.0.0.exe`)).text();
    await (await fetch(`http://127.0.0.1:${p}/tai/XomGay-Launcher-Setup-1.0.0.exe`, { headers: { 'user-agent': LAUNCHER_UA } })).text();
    await (await fetch(`http://127.0.0.1:${p}/tai/latest.yml`)).text();                      // the update feed: not a download
    const cookie = `${COOKIE}=${sign(SECRET, ME, Math.floor(Date.now() / 1000) + 600)}`;
    await fetch(`http://127.0.0.1:${p}/api/me`, { headers: { cookie } });
    await fetch(`http://127.0.0.1:${p}/api/me`, { headers: { cookie } });                       // once a day
    await new Promise((r) => setTimeout(r, 50));
    const views = tracked.filter((e) => e.kind === 'view');
    assert.deepEqual(views.map((e) => e.where), ['web', 'launcher']);
    assert.match(views[0].visitor, /^[0-9a-f]{24}$/, 'a hash, no address');
    assert.deepEqual(tracked.filter((e) => e.kind === 'download_click'), [{ kind: 'download_click', os: 'linux' }]);
    assert.deepEqual(tracked.filter((e) => e.kind === 'launcher').map((e) => [e.id.slice(0, 1), e.first]), [['a', true]]);
    assert.deepEqual(tracked.filter((e) => e.kind === 'download_file').map((e) => [e.os, e.update]), [['win', false], ['win', true]]);
    assert.deepEqual(tracked.filter((e) => e.kind === 'active'), [{ kind: 'active', where: 'web', steamId: ME }]);
  } finally {
    srv.close();
  }
});
