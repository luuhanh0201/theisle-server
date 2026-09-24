// /player-api: the portal's read-only, player-scoped window into the bridge.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'player-api-'));
process.env.GARAGE_ROOT = root;
process.env.PORTAL_TOKEN = 'portal-secret-token';
mkdirSync(join(root, 'stored'));
const ME = '76561198000000001';
const OTHER = '76561198000000002';
writeFileSync(join(root, 'stored', `${ME}__default.json`), JSON.stringify({
  version: 1, slot: 'default', classPath: 'BlueprintGeneratedClass /Game/X/BP_Carnotaurus.BP_Carnotaurus_C',
  growth: 1, capturedAt: 1000, location: { x: 1, y: 2, z: 3 }, health: 1300,
  skin: { colors: { Body: { r: 0.2, g: 0.3, b: 0.4 }, 'bad key!': { r: 1, g: 1, b: 1 }, Eyes: { r: 'x', g: 0, b: 0 } },
    patternIndex: 2, extra: '<script>' },
}));
writeFileSync(join(root, 'storage.json'), JSON.stringify({ schema: 1, players: { [ME]: {
  default: { classPath: 'BlueprintGeneratedClass /Game/X/BP_Carnotaurus.BP_Carnotaurus_C', growth: 1, capturedAt: 1000 },
} } }));

const { handlePlayerApi, shortSpecies } = await import('../dist/player-api.js');
const { Store } = await import('../dist/store.js');
after(() => rmSync(root, { recursive: true, force: true }));

const store = new Store();
const t = Math.floor(Date.now() / 1000);
store.apply({ type: 'session_start', t, steamId: ME, name: 'Me' });
store.apply({ type: 'session_start', t, steamId: OTHER, name: 'Other' });
store.apply({ type: 'spawn', t, steamId: OTHER, name: 'Other', species: 'BP_Troodon_C', growth: 0.5, loc: { x: 9, y: 9, z: 9 } });
store.apply({ type: 'snapshot', t, steamId: OTHER, name: 'Other', species: 'BP_Troodon_C', growth: 0.5, health: 50, loc: { x: 9, y: 9, z: 9 } });
store.apply({ type: 'spawn', t, steamId: ME, name: 'Me', species: 'BP_Carnotaurus_C', growth: 0.3, loc: { x: 1, y: 1, z: 1 } });
store.apply({ type: 'snapshot', t, steamId: ME, name: 'Me', species: 'BP_Carnotaurus_C', growth: 0.3, health: 800, loc: { x: 1, y: 1, z: 1 } });
store.apply({ type: 'skin', t, steamId: ME, name: 'Me', skin: { colors: { Body: { r: 0.5, g: 0.25, b: 0.1 } }, patternIndex: 3 } });
store.apply({ type: 'damage', t, attacker: OTHER, victim: ME, amount: 900, attackerName: 'Other', attackerSpecies: 'BP_Troodon_C' });
store.apply({ type: 'death', t: t + 1, steamId: ME, name: 'Me', species: 'BP_Carnotaurus_C', growth: 0.3,
  attributed: true, killer: OTHER, killerName: 'Other', killerSpecies: 'BP_Troodon_C' });

async function call(path, { token = 'portal-secret-token', method = 'GET' } = {}) {
  const req = { method, headers: token === null ? {} : { 'x-portal-token': token } };
  let status = 0; let body = '';
  const res = { writeHead: (s) => { status = s; }, end: (b) => { body = b; } };
  const handled = await handlePlayerApi(req, res, path, { store, serverPhase: async () => 'running' });
  return { handled, status, body: body ? JSON.parse(body) : null };
}

test('species names come out short', () => {
  assert.equal(shortSpecies('BP_Carnotaurus_C'), 'Carnotaurus');
  assert.equal(shortSpecies('BlueprintGeneratedClass /Game/X/BP_Carnotaurus.BP_Carnotaurus_C'), 'Carnotaurus');
  assert.equal(shortSpecies(null), null);
});

test('other paths are left to the admin API', async () => {
  assert.equal((await call('/api/players')).handled, false);
});

test('no token, a wrong token, or a write: refused', async () => {
  assert.equal((await call(`/player-api/me/${ME}`, { token: null })).status, 403);
  assert.equal((await call(`/player-api/me/${ME}`, { token: 'portal-secret-tokeX' })).status, 403);
  assert.equal((await call(`/player-api/me/${ME}`, { method: 'POST' })).status, 405);
  assert.equal((await call('/player-api/me/123')).status, 404, 'only a 17-digit SteamID');
});

test('me: own stats, lives and garage — nothing that leaks others or positions', async () => {
  const { status, body } = await call(`/player-api/me/${ME}`);
  assert.equal(status, 200);
  assert.equal(body.name, 'Me');
  assert.equal(body.stats.deaths, 1);
  assert.equal(body.lives[0].species, 'Carnotaurus');
  assert.equal(body.lives[0].killedBy, 'Other', 'the killer by name, as the game showed it');
  assert.deepEqual(body.garage, [{ slot: 'default', species: 'Carnotaurus', growth: 1, storedAt: 1000, gift: false,
    skin: { colors: { Body: { r: 0.2, g: 0.3, b: 0.4 } }, patternIndex: 2 } }], 'skin cleaned: bad keys, non-numbers and extras dropped');
  const text = JSON.stringify(body);
  assert.ok(!text.includes(OTHER), 'no other SteamID');
  assert.ok(!/"loc"|"location"/.test(text), 'no raw positions');
  assert.ok(!text.includes('"x":9'), 'nobody else\'s position (the other player stands at x 9)');
  assert.ok(!text.includes('1300'), 'no raw garage file content');
});

test('leaderboard by name only; server summary', async () => {
  const lb = await call('/player-api/leaderboard');
  assert.equal(lb.status, 200);
  assert.equal(lb.body.kills[0].name, 'Other');
  assert.ok(!JSON.stringify(lb.body).includes('7656119800000'), 'no SteamIDs');
  const srv = await call('/player-api/server');
  assert.deepEqual(srv.body, { online: 2, phase: 'running' });
});

test('the live skin of the dino being played', async () => {
  store.apply({ type: 'spawn', t: t + 5, steamId: ME, name: 'Me', species: 'BP_Carnotaurus_C', growth: 0.3 });
  store.apply({ type: 'snapshot', t: t + 5, steamId: ME, name: 'Me', species: 'BP_Carnotaurus_C', growth: 0.3, health: 800 });
  const { body } = await call(`/player-api/me/${ME}`);
  assert.deepEqual(body.dino.skin, { colors: { Body: { r: 0.5, g: 0.25, b: 0.1 } }, patternIndex: 3 });
  store.apply({ type: 'skin', t: t + 6, steamId: ME, skin: { colors: { Body: { r: 0.9, g: 0.1, b: 0.1 } }, patternIndex: 3 } });
  assert.equal((await call(`/player-api/me/${ME}`)).body.dino.skin.colors.Body.r, 0.9, 'a recolour shows at once');
});

test('bars: vitals with their maxima; prime status', async () => {
  store.apply({ type: 'snapshot', t: t + 7, steamId: ME, name: 'Me', species: 'BP_Carnotaurus_C', growth: 0.3,
    health: 650, stamina: 400, hunger: null, thirst: 90, max: { health: 1300, stamina: 1000, thirst: 100 } });
  store.apply({ type: 'prime', t: t + 7, steamId: ME, elder: false, prime: false, eligible: true, elderStacks: 0,
    conditions: { 1: false, 2: false, 3: true, 4: false, 5: false, 6: false, 7: false, 8: true, 9: true, 10: false } });
  const { body } = await call(`/player-api/me/${ME}`);
  assert.equal(body.dino.vitals.health, 650);
  assert.equal(body.dino.max.health, 1300);
  assert.equal(body.dino.max.hunger, null, 'no max read = no bar, not a wrong one');
  const pb = body.dino.prime;
  assert.equal(pb.eligible, true, 'the game\'s verdict, not our count');
  assert.equal(pb.met, 3);
  assert.equal(pb.conditions.length, 10);
  assert.deepEqual(pb.conditions.filter((c) => c.met).map((c) => c.n), [3, 8, 9]);
  assert.ok(pb.conditions.every((c) => c.verified === false), 'labels marked unverified');
  assert.equal(pb.locked, false, 'growth 0.3 < 75 %');
});

test('live vitals (1 s) win over the snapshot (5 s); positions still never leave', async () => {
  const t2 = Math.floor(Date.now() / 1000);
  const live = { t: t2, stale: false, ai: null, players: [{ steamId: ME, loc: { x: 5, y: 6 }, yaw: 10,
    vitals: { health: 111, stamina: null, hunger: null, thirst: null, oxygen: null, blood: null }, growth: 0.31 }] };
  const req = { method: 'GET', headers: { 'x-portal-token': 'portal-secret-token' } };
  let body = '';
  const res = { writeHead: () => {}, end: (b) => { body = b; } };
  await handlePlayerApi(req, res, `/player-api/me/${ME}`, { store, serverPhase: async () => 'running', live: async () => live });
  const me = JSON.parse(body);
  assert.equal(me.dino.vitals.health, 111, 'live value');
  assert.equal(me.dino.vitals.stamina, 400, 'no live value: the snapshot\'s');
  assert.equal(me.dino.growth, 0.31);
  assert.deepEqual(me.dino.position, { x: 5, y: 6, z: null, yaw: 10 }, 'their own position, live');
  assert.ok(!body.includes('"x":9'), 'nobody else\'s position');
});

test('own position falls back to the snapshot; the trail is theirs only', async () => {
  const { body } = await call(`/player-api/me/${ME}`);
  assert.equal(typeof body.dino.position.x, 'number');
  assert.ok(Array.isArray(body.dino.trail));
  const other = await call(`/player-api/me/${OTHER}`);
  assert.ok(!JSON.stringify(other.body).includes(`"${ME}"`), 'no other SteamID anywhere');
});
