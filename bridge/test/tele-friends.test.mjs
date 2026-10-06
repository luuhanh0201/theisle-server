// Tele con non (tele.ts) and Kết bạn (friends.ts): codes, limits, the routes the portal calls,
// and that no SteamID or stranger's position leaves the bridge.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'tele-friends-'));
process.env.DATA_DIR = join(root, 'data');
process.env.GARAGE_ROOT = join(root, 'garage');
process.env.PORTAL_TOKEN = 'portal-secret-token';
process.env.ADMIN_STEAM_IDS = '';
mkdirSync(process.env.DATA_DIR, { recursive: true });
mkdirSync(process.env.GARAGE_ROOT, { recursive: true });
// Both features open to everyone (Công khai) for the route tests.
writeFileSync(join(process.env.DATA_DIR, 'svip.json'), JSON.stringify({ players: [], features: { tele: 'all', friends: 'all' }, released: {} }));

const tele = await import('../dist/tele.js');
const fr = await import('../dist/friends.js');
const { handlePlayerApi } = await import('../dist/player-api.js');
const { Store } = await import('../dist/store.js');
after(() => rmSync(root, { recursive: true, force: true }));

const A = '76561198000000011';
const B = '76561198000000012';
const C = '76561198000000013';
const S = { ...tele.TELE_DEFAULTS };

test('settings: defaults 40 % / 5 min / 60 s / 60 s / 5 s, whole numbers in range only', async () => {
  assert.deepEqual(await tele.readTeleSettings(), { maxGrowthPct: 40, targetMaxGrowthPct: 40, codeMinutes: 5, cooldownS: 60, combatS: 60, countdownS: 5 });
  const s = await tele.saveTeleSettings({ maxGrowthPct: 50, cooldownS: 30 });
  assert.equal(s.maxGrowthPct, 50);
  assert.equal(s.cooldownS, 30);
  assert.equal(s.targetMaxGrowthPct, 40, 'what was not sent keeps its default');
  await assert.rejects(tele.saveTeleSettings({ maxGrowthPct: 0 }), /maxGrowthPct/);
  await assert.rejects(tele.saveTeleSettings({ countdownS: 61 }), /countdownS/);
  await assert.rejects(tele.saveTeleSettings({ codeMinutes: 2.5 }), /codeMinutes/);
  assert.deepEqual(JSON.parse(readFileSync(join(process.env.DATA_DIR, 'tele-settings.json'), 'utf8')), s);
  await tele.saveTeleSettings(tele.TELE_DEFAULTS);
});

test('a code: 6 characters of the alphabet, typed in any case, with spaces or a dash', () => {
  assert.equal(tele.normaliseCode('ab c-d2 3'), 'ABCD23');
  assert.equal(tele.normaliseCode('ABCD2O'), null, 'no O (read as 0)');
  assert.equal(tele.normaliseCode('ABC'), null);
  assert.equal(tele.normaliseCode(42), null);
});

test('growth: at most the limit (40 % yes, 41 % no), for the one moving and the one moved to', () => {
  const p = (growth) => ({ steamId: A, loc: { x: 0, y: 0 }, yaw: 0, vitals: {}, growth });
  assert.equal(tele.growthAllowed(0.4, 40), true);
  assert.equal(tele.growthAllowed(0.41, 40), false);
  assert.equal(tele.teleRefusal(p(0.3), p(0.4), S), null);
  assert.match(tele.teleRefusal(p(0.45), p(0.3), S), /40%.*45%/);
  assert.match(tele.teleRefusal(p(0.3), p(0.6), S), /người đưa mã/);
  assert.match(tele.teleRefusal(null, p(0.3), S), /trong game/);
  assert.match(tele.teleRefusal(p(0.3), null, S), /không ở trong game/);
  assert.equal(tele.teleRefusal(p(null), p(null), S), null, 'a growth live.json lacks: the mod decides');
  assert.match(tele.codeRefusal(p(0.5), S), /lấy mã/);
  assert.equal(tele.codeRefusal(p(0.2), S), null);
});

test('codes: one per owner, works once, expires, held while used, released on a refusal', () => {
  const codes = new tele.TeleCodes();
  let n = 0;
  const rnd = () => n++ % 32;
  const first = codes.issue(A, S, 1000, rnd);
  const second = codes.issue(A, S, 1001, rnd);
  assert.notEqual(first.code, second.code);
  assert.throws(() => codes.lookup(first.code, B, 1002), /hết hạn/, 'a new code drops the old one');
  assert.equal(codes.lookup(second.code, B, 1002).owner, A);
  assert.throws(() => codes.lookup(second.code, A, 1002), /mã của bạn/);
  assert.throws(() => codes.lookup(second.code, B, 1001 + 5 * 60 + 1), /hết hạn/, 'codeMinutes later it no longer works');

  const third = codes.issue(A, S, 2000, rnd);
  codes.reserve(third.code, B, 7, 2100);
  assert.throws(() => codes.lookup(third.code, C, 2001), /người khác dùng/);
  assert.throws(() => codes.issue(A, S, 2001, rnd), /đang được dùng/);
  // The mod refused it at once (fighting…): the code works again.
  codes.settle(() => ({ started: false, final: null }), 2002);
  assert.equal(codes.lookup(third.code, C, 2003).owner, A);
  // Started, then the countdown failed: works again.
  codes.reserve(third.code, C, 8, 2100);
  codes.settle(() => ({ started: true, final: { ok: false } }), 2010);
  assert.equal(codes.lookup(third.code, B, 2011).owner, A);
  // Moved: the code is gone, the cooldown starts for who moved.
  codes.reserve(third.code, B, 9, 2100);
  codes.settle(() => ({ started: true, final: null }), 2012);
  assert.throws(() => codes.lookup(third.code, C, 2013), /người khác dùng/, 'still counting down: still held');
  codes.settle(() => ({ started: true, final: { ok: true } }), 2020);
  assert.throws(() => codes.lookup(third.code, C, 2021), /hết hạn/);
  assert.equal(codes.cooldownLeft(B, S, 2050), 30);
  assert.equal(codes.cooldownLeft(B, S, 2080), 0);
  assert.equal(codes.cooldownLeft(C, S, 2050), 0);
  // No word from the mod by `until`: released.
  const fourth = codes.issue(A, S, 3000, rnd);
  codes.reserve(fourth.code, B, 10, 3050);
  codes.settle(() => ({ started: null, final: null }), 3051);
  assert.equal(codes.mine(A, 3052).inUse, false);
});

test('friends: ask, accept, both ways, decline, cancel, remove, limits', async () => {
  const f = new fr.Friends(join(root, 'friends-unit.json'));
  assert.equal(await f.request(A, B, 100), 'sent');
  await assert.rejects(f.request(A, B, 101), /đã gửi/);
  await assert.rejects(f.request(A, A, 101), /chính mình/);
  assert.deepEqual((await f.view(B, 102)).incoming.map((r) => r.from), [A]);
  assert.equal(await f.areFriends(A, B), false, 'not before the other accepts');
  await f.accept(B, A, 103);
  assert.equal(await f.areFriends(A, B), true);
  assert.deepEqual((await f.view(A, 104)).friends.map((x) => x.id), [B]);
  await assert.rejects(f.request(B, A, 105), /đã là bạn/);
  // C asks A, A asks C back: that is an accept.
  await f.request(C, A, 106);
  assert.equal(await f.request(A, C, 107), 'accepted');
  assert.equal((await f.view(A, 108)).incoming.length, 0);
  await f.remove(C, A, 109);
  assert.equal(await f.areFriends(A, C), false);
  await f.request(C, A, 110);
  await f.decline(A, C, 111);
  assert.equal((await f.view(A, 112)).incoming.length, 0);
  await f.request(C, B, 113);
  await f.cancel(C, B, 114);
  assert.equal((await f.view(B, 115)).incoming.length, 0);
  // A request is dropped after REQUEST_DAYS.
  await f.request(C, B, 200);
  assert.equal((await f.view(B, 200 + fr.REQUEST_DAYS * 86400 + 1)).incoming.length, 0);
  // Kept in the file, read back by a new instance.
  const again = new fr.Friends(join(root, 'friends-unit.json'));
  assert.equal(await again.areFriends(A, B), true);
});

test('search: exact SteamID, or a name without its marks; never yourself', () => {
  const players = [
    { steamId: A, name: 'Đạt Nguyễn', online: false },
    { steamId: B, name: 'dat2', online: true },
    { steamId: C, name: 'Trâu', online: true },
  ];
  assert.deepEqual(fr.searchPlayers(players, 'dat', C).map((p) => p.steamId), [B, A], 'online first');
  assert.deepEqual(fr.searchPlayers(players, 'dat', B).map((p) => p.steamId), [A]);
  assert.deepEqual(fr.searchPlayers(players, ` ${C} `, A).map((p) => p.steamId), [C]);
  assert.deepEqual(fr.searchPlayers(players, C, C), []);
  assert.throws(() => fr.searchPlayers(players, 'd', A), /2 ký tự/);
  assert.equal(fr.idOfRef(fr.friendRef(B), [A, B, C]), B);
  assert.equal(fr.idOfRef(B, [A, B, C]), null, 'a SteamID is not a ref');
});

// --- the routes ------------------------------------------------------------------

const store = new Store();
const now = Math.floor(Date.now() / 1000);
for (const [id, name] of [[A, 'Mẹ Rex'], [B, 'Con Rex'], [C, 'Người lạ']]) {
  store.apply({ type: 'session_start', t: now, steamId: id, name });
  store.apply({ type: 'spawn', t: now, steamId: id, name, species: 'BP_Tyrannosaurus_C', growth: 0.3, loc: { x: 1, y: 1, z: 1 } });
}
const liveOf = (growths) => ({
  t: now, stale: false, fps: 30, ai: null,
  players: Object.entries(growths).map(([steamId, growth], i) => ({ steamId, loc: { x: 1000 * (i + 1), y: 2000, z: 10 }, yaw: 90, vitals: {}, growth })),
});
let live = liveOf({ [A]: 0.35, [B]: 0.2, [C]: 0.9 });

async function call(path, method = 'GET', payload = undefined) {
  const chunks = payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))];
  const req = { method, headers: { 'x-portal-token': 'portal-secret-token' }, async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; } };
  let status = 0; let body = '';
  const res = { writeHead: (s) => { status = s; }, end: (b) => { body = b; } };
  await handlePlayerApi(req, res, path, { store, serverPhase: async () => 'running', live: async () => live });
  return { status, body: body ? JSON.parse(body) : null };
}

test('tele route: A takes a code, B uses it, the mod gets one "tele" command; refusals with the reason', async () => {
  // A grown dino cannot give a code (default 40 %).
  live = liveOf({ [A]: 0.5, [B]: 0.2 });
  assert.equal((await call(`/player-api/tele/${A}`, 'POST', { action: 'code' })).status, 409);
  live = liveOf({ [A]: 0.35, [B]: 0.2, [C]: 0.9 });
  const got = await call(`/player-api/tele/${A}`, 'POST', { action: 'code' });
  assert.equal(got.status, 200);
  assert.equal(got.body.code.length, 6);
  const me = await call(`/player-api/me/${A}`);
  assert.equal(me.body.tele.code.code, got.body.code, '/me shows their code');
  assert.equal(me.body.tele.maxGrowthPct, 40);

  // C is too big to move.
  const big = await call(`/player-api/tele/${C}`, 'POST', { action: 'use', code: got.body.code });
  assert.equal(big.status, 409);
  assert.match(big.body.error, /40%/);
  // A wrong code.
  assert.equal((await call(`/player-api/tele/${B}`, 'POST', { action: 'use', code: 'ZZZZZZ' })).status, 409);
  // B moves to A.
  const use = await call(`/player-api/tele/${B}`, 'POST', { action: 'use', code: got.body.code.toLowerCase() });
  assert.equal(use.status, 202, JSON.stringify(use.body));
  assert.equal(use.body.to, 'Mẹ Rex');
  const inbox = JSON.parse(readFileSync(join(process.env.GARAGE_ROOT, 'inbox.json'), 'utf8'));
  const cmd = inbox.commands.find((c) => c.id === use.body.id);
  assert.deepEqual({ ...cmd, id: 0, createdAt: 0, expiresAt: 0 }, { type: 'tele', steamId: B, target: A, maxGrowth: 0.4, targetMaxGrowth: 0.4,
    combatS: 60, countdownS: 5, cooldownS: 60, id: 0, createdAt: 0, expiresAt: 0 });
  // Held while the mod runs it.
  assert.equal((await call(`/player-api/me/${A}`)).body.tele.code.inUse, true);
  // The mod: started, then moved.
  store.apply({ type: 'portal_command', t: now, id: use.body.id, steamId: B, action: 'tele', ok: true, messages: ['Đứng yên 5 giây'] });
  store.apply({ type: 'tele_result', t: now, id: use.body.id, steamId: B, target: A, ok: true });
  const result = await call(`/player-api/command/${B}/${use.body.id}`);
  assert.deepEqual(result.body.final, { ok: true, reason: null });
  const meB = await call(`/player-api/me/${B}`);
  assert.ok(meB.body.tele.cooldownLeft > 0, 'the cooldown runs for who moved');
  assert.equal((await call(`/player-api/me/${A}`)).body.tele.code, null, 'the code worked once');
});

test('tele route: closed (Chỉ admin) = 403 and nothing in /me', async () => {
  writeFileSync(join(process.env.DATA_DIR, 'svip.json'), JSON.stringify({ players: [], features: { tele: 'admin', friends: 'all' }, released: {} }));
  (await import('../dist/svip.js')).resetSvipCache();
  assert.equal((await call(`/player-api/tele/${A}`, 'POST', { action: 'code' })).status, 403);
  assert.equal((await call(`/player-api/me/${A}`)).body.tele, null);
  writeFileSync(join(process.env.DATA_DIR, 'svip.json'), JSON.stringify({ players: [], features: { tele: 'all', friends: 'all' }, released: {} }));
  (await import('../dist/svip.js')).resetSvipCache();
});

test('friends route: search by name, ask, accept; positions only of friends, never a SteamID', async () => {
  live = liveOf({ [A]: 0.35, [B]: 0.2, [C]: 0.9 });
  const found = await call(`/player-api/friends/${A}`, 'POST', { action: 'search', q: 'con rex' });
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.results.map((r) => r.name), ['Con Rex']);
  assert.ok(!JSON.stringify(found.body).includes(B), 'no SteamID in a search');
  const ref = found.body.results[0].ref;
  assert.equal((await call(`/player-api/friends/${A}`, 'POST', { action: 'request', ref })).body.result, 'sent');
  // Before B accepts: A sees B in outgoing, with no position.
  const before = await call(`/player-api/friends/${A}`);
  assert.equal(before.body.friends.length, 0);
  assert.equal(before.body.outgoing[0].name, 'Con Rex');
  assert.equal((await call(`/player-api/me/${B}`)).body.friends.incoming, 1, 'the badge on B\'s map');
  const inB = await call(`/player-api/friends/${B}`);
  const back = inB.body.incoming[0].ref;
  assert.equal((await call(`/player-api/friends/${B}`, 'POST', { action: 'accept', ref: back })).status, 200);
  const after = await call(`/player-api/friends/${A}`);
  assert.equal(after.body.friends[0].name, 'Con Rex');
  assert.equal(after.body.friends[0].online, true);
  assert.deepEqual(after.body.friends[0].pos, { x: 2000, y: 2000, yaw: 90 });
  const text = JSON.stringify(after.body);
  assert.ok(!text.includes(B) && !text.includes(C), 'no SteamID, nobody but friends');
  // A ref of someone not in the right list: 404.
  assert.equal((await call(`/player-api/friends/${A}`, 'POST', { action: 'accept', ref: fr.friendRef(C) })).status, 404);
  assert.equal((await call(`/player-api/friends/${A}`, 'POST', { action: 'remove', ref })).status, 200);
  assert.equal((await call(`/player-api/friends/${A}`)).body.friends.length, 0);
});
