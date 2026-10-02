// What each panel admin may do (permissions.ts), the game's admin list without the
// admins switched off in game (gameini.ts), and the admins' in-game commands read from
// TheIsle.log into the admin log (game-admin-log.ts). npm test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUPER = '76561199320940985';
const TREX = '76561199248426579';
const MOD = '76561199000000003';
const root = mkdtempSync(join(tmpdir(), 'perm-test-'));
process.env.DATA_DIR = root;
process.env.SUPER_ADMIN_STEAM_ID = SUPER;
process.env.ADMIN_GUARD_PATH = join(root, 'isle-admins.json');
const P = await import('../dist/permissions.js');
const { withoutAdmins } = await import('../dist/gameini.js');
const { parseAdminLine, detailOf, GameAdminLog } = await import('../dist/game-admin-log.js');
after(() => rmSync(root, { recursive: true, force: true }));

test('every panel route needs a permission; unknown ones are the super admin\'s', () => {
  const cases = [
    ['GET', '/api/me', null], ['GET', '/api/health', null], ['GET', '/api/catalog', null],
    ['GET', '/api/players', 'players.view'], ['GET', `/api/player/${MOD}`, 'players.view'], ['GET', `/api/player/${MOD}/path/123`, 'players.view'],
    ['GET', '/api/kill-scene', 'players.view'], ['POST', `/api/player/${MOD}/kill`, 'players.kill'],
    ['POST', `/api/player/${MOD}/admin`, 'players.admin'],
    ['GET', '/api/bans', 'bans.view'], ['POST', '/api/bans', 'bans.edit'], ['POST', '/api/bans/unban', 'bans.edit'], ['PUT', '/api/ban-reasons', 'bans.edit'],
    ['GET', '/api/prison', 'prison.view'], ['POST', '/api/prison/jail', 'prison.jail'], ['POST', '/api/prison/sentence/abcdef0123/release', 'prison.jail'],
    ['PUT', '/api/prison/settings', 'prison.settings'],
    ['GET', '/api/map/live', 'map.view'], ['GET', '/api/ai-zones', 'map.view'], ['PUT', '/api/ai-zones', 'world.edit'],
    ['GET', `/api/garage/${MOD}/1`, 'garage.view'], ['POST', `/api/garage/${MOD}/1`, 'garage.edit'], ['DELETE', `/api/garage/${MOD}/1`, 'garage.edit'],
    ['POST', '/api/restore-life', 'garage.edit'], ['PUT', '/api/garage-settings', 'garage.settings'], ['PUT', '/api/mutations/Hydro', 'garage.edit'],
    ['PUT', '/api/messages', 'mods.edit'], ['GET', '/api/messages', 'mods.view'],
    ['POST', '/api/server/restart', 'server.power'], ['PUT', '/api/server/schedule', 'server.schedule'],
    ['GET', '/api/game-config', 'config.view'], ['PUT', '/api/game-config', 'config.edit'],
    ['POST', '/api/rcon/announce', 'rcon.announce'], ['POST', '/api/rcon/toggleAi', 'rcon.run'],
    ['POST', '/api/backups/restore', 'backups.restore'], ['POST', '/api/backups/wipe', 'backups.restore'], ['POST', '/api/backups', 'backups.edit'],
    ['GET', '/api/backups/file/x.tar.gz', 'backups.view'], ['DELETE', '/api/backups/file/x.tar.gz', 'backups.edit'],
    ['GET', '/api/server/audit', 'audit.view'], ['PUT', '/api/panel-access', 'access.edit'], ['GET', '/api/discord/url', 'discord.edit'],
    ['GET', '/api/items', 'items.view'], ['GET', '/api/items/it_12345678/owners', 'items.view'], ['POST', '/api/items', 'items.edit'],
    ['PUT', '/api/items/it_12345678', 'items.edit'], ['POST', '/api/items/it_12345678/grant', 'items.grant'],
    ['POST', '/api/items/it_12345678/apply', 'items.grant'], ['DELETE', `/api/items/it_12345678/grant/${MOD}`, 'items.grant'],
    ['GET', '/skin3d.js', null], ['GET', '/dino3d/registry.json', null],
    ['GET', '/api/permissions', '*'], ['PUT', `/api/permissions/${MOD}`, '*'], ['GET', '/api/something-new', '*'], ['POST', '/api/something-new', '*'],
    ['GET', '/', null], ['GET', '/map/gateway.webp', null],
  ];
  for (const [m, p, want] of cases) assert.equal(P.permissionFor(m, p), want, `${m} ${p}`);
});

test('roles, extras and removals; nobody set keeps everything; the super admin and a script have all', async () => {
  assert.equal(await P.denied(MOD, 'POST', '/api/server/restart'), null, 'not set yet: everything, as before');
  assert.notEqual(await P.denied(MOD, 'GET', '/api/permissions'), null, 'but never the permission page');
  assert.equal(await P.denied(SUPER, 'GET', '/api/permissions'), null);
  assert.equal(await P.denied(null, 'PUT', `/api/permissions/${MOD}`), null, 'ADMIN_TOKEN on the server itself');

  await P.savePermission(MOD, P.validatePerm({ role: 'mod', allow: ['players.kill'], deny: ['bans.edit'], ingame: true }));
  const mine = await P.permsOf(MOD);
  assert.ok(mine.has('prison.jail') && mine.has('players.kill'));
  assert.ok(!mine.has('bans.edit') && !mine.has('server.power') && !mine.has('*'));
  assert.equal(await P.denied(MOD, 'POST', '/api/bans'), 'Bạn không có quyền: Ban / gỡ ban / sửa ban, lý do ban');
  assert.equal(await P.denied(MOD, 'POST', '/api/prison/jail'), null);
  assert.ok(P.ROLES.admin.perms.includes('server.power') && !P.ROLES.admin.perms.includes('backups.restore'));

  P.resetPermissionsCache();
  assert.ok((await P.permsOf(MOD)).has('players.kill'), 'saved to the file');
});

test('what can be saved', async () => {
  assert.throws(() => P.validatePerm({ role: 'boss' }), /role/);
  assert.throws(() => P.validatePerm({ role: 'mod', allow: ['nope'] }), /unknown permission/);
  assert.throws(() => P.validatePerm({ role: 'mod', ingame: 'no' }), /ingame/);
  await assert.rejects(P.savePermission(SUPER, P.validatePerm({ role: 'mod' })), /admin tổng/);
  assert.deepEqual(P.validatePerm({ role: 'admin' }), { role: 'admin', allow: [], deny: [], ingame: true });
});

test('in game off: left out of the game\'s admin list, kept by the panel; the AdminGuard file', async () => {
  await P.savePermission(TREX, P.validatePerm({ role: 'admin', ingame: false }));
  const off = await P.inGameOff();
  assert.deepEqual([...off], [TREX]);
  const settings = { AdminsSteamIDs: [SUPER, TREX], MaxPlayerCount: 50 };
  assert.deepEqual(withoutAdmins(settings, off, SUPER), { AdminsSteamIDs: [SUPER], MaxPlayerCount: 50 });
  assert.deepEqual(settings.AdminsSteamIDs, [SUPER, TREX], 'the saved settings are not changed');
  assert.deepEqual(withoutAdmins({ AdminsSteamIDs: [TREX] }, off, SUPER).AdminsSteamIDs, [SUPER], 'never empty');
  assert.deepEqual(withoutAdmins({ MaxPlayerCount: 1 }, off, SUPER), { MaxPlayerCount: 1 }, 'no list: nothing to filter');

  await P.syncAdminGuard(new Set([SUPER, TREX, MOD]));
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'isle-admins.json'), 'utf8')), { off: [TREX], on: [MOD, SUPER].sort() });
});

const LINE = '[2026.09.28-09.11.03:729][791]LogTheIsleCommandData: [2026.09.28-16.11.03] T-Rex Nổi Loạn [76561199248426579] used command: '
  + 'Bring at: Quang Tèo, [76561199555873629], Class: Deinosuchus, Gender: Male, Previous value: 0.000000%, New value: 0.000000%';

test('an admin\'s command in TheIsle.log', () => {
  const a = parseAdminLine(LINE);
  assert.deepEqual(a, { t: Date.UTC(2026, 8, 28, 9, 11, 3) / 1000, name: 'T-Rex Nổi Loạn', steamId: TREX, command: 'Bring',
    target: { name: 'Quang Tèo', steamId: '76561199555873629', species: 'Deinosuchus', from: 0, to: 0 } });
  assert.equal(detailOf(a), 'Kéo người chơi tới chỗ mình · Quang Tèo (76561199555873629) · Deinosuchus');
  const grow = parseAdminLine('[2026.09.28-11.42.38:100][ 12]LogTheIsleCommandData: [2026.09.28-18.42.38] T-Rex Nổi Loạn [76561199248426579] used command: Grow at: Quang Tèo, [76561199555873629], Class: Deinosuchus, Gender: Male, Previous value: 0.256404%, New value: 0.502017%');
  assert.equal(detailOf(grow), 'Đặt growth · Quang Tèo (76561199555873629) · Deinosuchus · 0.3% → 0.5%');
  const w = parseAdminLine('[2026.10.01-09.51.57:069][983]LogTheIsleCommandData: [16:51] Dã Tượng [76561199320940985] used command: Changed weather! ');
  assert.equal(w.command, 'Changed weather');
  assert.equal(w.target, null);
  assert.equal(detailOf(w), 'Đổi thời tiết');
  assert.equal(parseAdminLine('[2026.10.01-09.51.57:069][983]LogTheIsleChatData: [16:51] x [76561199320940985]: used command: hi'), null);
});

test('the log is read as it grows, into the admin log; a switched-off admin\'s command is a failure; no repeat after a restart', async () => {
  const log = join(root, 'TheIsle.log');
  const stamp = (t) => { const d = new Date(t * 1000); const p = (n) => String(n).padStart(2, '0');
    return `[${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}-${p(d.getUTCHours())}.${p(d.getUTCMinutes())}.${p(d.getUTCSeconds())}:000][  1]`; };
  const now = Math.floor(Date.now() / 1000);
  writeFileSync(log, `${stamp(now - 3600)}LogTheIsleCommandData: [x] Old [${SUPER}] used command: Enter Specmode \n`);
  const g = new GameAdminLog(log);
  await g.load();   // first run: from now on
  await g.poll();
  appendFileSync(log, `${stamp(now + 5)}LogTheIsleCommandData: [x] Dã Tượng [${SUPER}] used command: Enter Specmode \n`
    + `${stamp(now + 6)}LogTheIsleCommandData: [x] T-Rex [${TREX}] used command: Heal at: A, [${MOD}], Class: Stegosaurus, Gender: Male, Previous value: 0.000000%, New value: 0.000000%\n`
    + `${stamp(now + 7)}LogTheIsleCommandData: [x] T-Rex [${TREX}] used command: Bring at: A, [${MOD}], Cla`);
  await g.poll();
  appendFileSync(log, `ss: Stegosaurus, Gender: Male, Previous value: 0.000000%, New value: 0.000000%\n`);
  await g.poll();
  const audit = () => readFileSync(join(root, 'admin-audit.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    .filter((e) => e.action.startsWith('in-game '));
  const lines = audit();
  assert.deepEqual(lines.map((e) => e.action), ['in-game Enter Specmode', 'in-game Heal', 'in-game Bring'], 'the old line skipped, a split line joined');
  assert.equal(lines[0].byId, SUPER);
  assert.equal(lines[0].ok, true);
  assert.equal(lines[1].ok, false, 'T-Rex is switched off in game');
  assert.match(lines[1].error, /TẮT/);
  assert.equal(lines[1].t, now + 6, 'the time the game logged it');

  const again = new GameAdminLog(log);
  await again.load();
  await again.poll();
  assert.equal(audit().length, 3, 'a bridge restart repeats nothing');
  assert.ok(existsSync(join(root, 'game-admin-log.json')));
});
