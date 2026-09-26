// Bans (bans.ts): the game's PlayerBans.json read as it is on this server,
// each new ban once, and a ban from the panel (DM, BanPlayer in hours, kick).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'bans-test-'));
process.env.DATA_DIR = root;
const { readBans, parseBans, parseGameTime, formatGameTime, durationText, banVars, BanWatcher, validateBan, validateBanEdit, banPlayer, PERMANENT_HOURS,
  readReasons, saveReasons, DEFAULT_REASONS } = await import('../dist/bans.js');
const { banLine, banChangeLine } = await import('../dist/discord.js');
after(() => rmSync(root, { recursive: true, force: true }));

// As the game wrote it on 2026-09-26 for "ZZTestBan,76561190000000009,panel test ban,90".
const FILE = JSON.stringify({ bannedPlayerData: [
  { steamId: '76561190000000009', playerName: 'ZZTestBan', banReason: 'panel test ban', bannedTime: '2026.09.26-10.56.54',
    endBanTime: '2026.09.30-04.56.54', bannerName: 'Rcon', bannerSteamId: 'Rcon' },
  { steamId: '76561199000000001', playerName: 'Rex', banReason: 'Hack / cheat', bannedTime: '2026.09.26-11.00.00',
    endBanTime: '2036.09.24-11.00.00', bannerName: 'Dã Tượng', bannerSteamId: '76561199320940985' },
] });

test('the game\'s list: times, 90 hours, permanent, who', () => {
  const [a, b] = parseBans(FILE);
  assert.equal(a.endsAt - a.bannedAt, 90 * 3600, 'Time is in hours');
  assert.equal(durationText(a), '90 giờ');
  assert.equal(a.permanent, false);
  assert.equal(b.permanent, true);
  assert.equal(durationText(b), 'vĩnh viễn');
  assert.equal(banVars(a).by, 'admin', 'RCON reads as "admin"');
  assert.equal(banVars(b).by, 'Dã Tượng');
  assert.equal(durationText({ bannedAt: 0, endsAt: 72 * 3600, permanent: false }), '3 ngày');
  assert.equal(parseGameTime('nope'), null);
  assert.deepEqual(parseBans('not json'), []);
});

test('watcher: the first read is the baseline, each new ban once', async () => {
  const path = join(root, 'watch.json');
  writeFileSync(path, FILE);
  const seen = [];
  const w = new BanWatcher((b) => seen.push(b.name), { path });
  await w.tick();
  assert.deepEqual(seen, [], 'old bans are not announced again after a restart');
  const d = JSON.parse(FILE);
  d.bannedPlayerData.push({ steamId: '76561199000000002', playerName: 'Troll', banReason: 'Spam', bannedTime: '2026.09.26-12.00.00', endBanTime: '2026.09.27-12.00.00', bannerName: 'Rcon' });
  writeFileSync(path, JSON.stringify(d));
  await w.tick();
  await w.tick();
  assert.deepEqual(seen, ['Troll']);
});

test('unban and edit: the game file changed (a copy kept), and kept so when the game writes its own list back', async () => {
  const path = join(root, 'PlayerBans.json');
  writeFileSync(path, FILE);
  const seen = [];
  const w = new BanWatcher((b) => seen.push(b.name), { path });
  await w.tick();
  const { before, after } = await w.change({ steamId: '76561190000000009', bannedTime: '2026.09.26-10.56.54', action: 'unban', by: 'Hạnh' });
  assert.equal(before.name, 'ZZTestBan');
  assert.equal(after, null);
  let now = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(now.bannedPlayerData.map((b) => b.playerName), ['Rex']);
  assert.match(readFileSync(path, 'utf8'), /^\{\n\t"bannedPlayerData"/, 'tabs, as the game writes it');
  assert.ok(readdirSync(join(root, 'ban-backups')).some((n) => n.startsWith('PlayerBans.')), 'the file as it was is kept');

  const end = parseGameTime('2026.09.28-11.00.00');
  await w.change({ steamId: '76561199000000001', bannedTime: '2026.09.26-11.00.00', action: 'edit', by: 'Hạnh', endBanTime: formatGameTime(end), banReason: 'Hack (xác nhận)' });
  now = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(now.bannedPlayerData[0].endBanTime, '2026.09.28-11.00.00');
  assert.equal(now.bannedPlayerData[0].banReason, 'Hack (xác nhận)');

  // The game writes its own (old) list back: the edits are put back, the unbanned one is not a new ban.
  writeFileSync(path, FILE);
  await w.tick();
  now = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(now.bannedPlayerData.map((b) => [b.playerName, b.endBanTime, b.banReason]), [['Rex', '2026.09.28-11.00.00', 'Hack (xác nhận)']]);
  assert.deepEqual(seen, []);
  // …also for a new watcher (a bridge restart): the edits are on disk.
  writeFileSync(path, FILE);
  const w2 = new BanWatcher(() => assert.fail('not a new ban'), { path });
  await w2.tick();
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).bannedPlayerData.length, 1);
  await assert.rejects(w.change({ steamId: '76561190000000009', bannedTime: '2026.09.26-10.56.54', action: 'unban', by: 'x' }), /không thấy/);
});

test('a UTF-16 file (a Vietnamese name, as the game writes it): read, and written back as UTF-16', async () => {
  const path = join(root, 'utf16.json');
  const doc = { bannedPlayerData: [{ steamId: '76561199248426579', playerName: 'T-Rex Nổi Loạn', banReason: 'Hack / cheat',
    bannedTime: '2026.09.26-11.20.09', endBanTime: '2026.09.26-12.20.09', bannerName: 'Rcon', bannerSteamId: 'Rcon' }] };
  writeFileSync(path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(doc, null, '\t'), 'utf16le')]));
  const [b] = await readBans(path);
  assert.equal(b.name, 'T-Rex Nổi Loạn');
  assert.equal(b.endsAt - b.bannedAt, 3600);
  const w = new BanWatcher(() => undefined, { path });
  await w.tick();
  await w.change({ steamId: '76561199248426579', bannedTime: '2026.09.26-11.20.09', action: 'edit', by: 'x', banReason: 'Thử — đã xong' });
  const raw = readFileSync(path);
  assert.deepEqual([...raw.subarray(0, 2)], [0xff, 0xfe], 'still UTF-16 with its BOM');
  assert.equal(JSON.parse(raw.subarray(2).toString('utf16le')).bannedPlayerData[0].banReason, 'Thử — đã xong');
});

test('edit requests and times', () => {
  assert.equal(formatGameTime(parseGameTime('2026.09.30-04.56.54')), '2026.09.30-04.56.54');
  assert.throws(() => validateBanEdit({ steamId: '1', bannedTime: 'x', reason: 'a' }), /which ban/);
  assert.throws(() => validateBanEdit({ steamId: '1', bannedTime: '2026.09.26-11.00.00', endsAt: parseGameTime('2026.09.26-10.00.00') }), /after the ban/);
  assert.throws(() => validateBanEdit({ steamId: '1', bannedTime: '2026.09.26-11.00.00' }), /nothing/);
  assert.equal(validateBanEdit({ steamId: '1', bannedTime: '2026.09.26-11.00.00', endsAt: 'permanent' }).endsAt, 'permanent');
  assert.equal(validateBanEdit({ steamId: '1', bannedTime: '2026.09.26-11.00.00', reason: ' a, b ' }).reason, 'a b');
});

test('Discord: the whole reason and both dates; unban and edit say what changed', () => {
  const [a] = parseBans(FILE);
  const line = banLine(a, banVars(a));
  assert.match(line.text, /\*\*Lý do:\*\* panel test ban/);
  assert.match(line.text, /\*\*Ban lúc:\*\* 10\\:56 26\/09\/2026/);
  assert.match(line.text, /\*\*Hết hạn:\*\* 04\\:56 30\/09\/2026/);
  const un = banChangeLine(a, banVars(a), null, null, 'Hạnh');
  assert.match(un.text, /Gỡ ban \*\*ZZTestBan\*\*.*Hạnh/);
  const b2 = { ...a, reason: 'mới', endsAt: a.bannedAt + 24 * 3600 };
  const ed = banChangeLine(a, banVars(a), b2, banVars(b2), 'Hạnh');
  assert.match(ed.text, /90 giờ.*→ \*\*1 ngày\*\*/);
  assert.match(ed.text, /panel test ban → \*\*mới\*\*/);
});

test('a ban from the panel: checked, the player told, BanPlayer in hours without commas, then kicked', async () => {
  assert.throws(() => validateBan({ steamId: '123', reason: 'x', hours: 1 }), /SteamID/);
  assert.throws(() => validateBan({ steamId: '76561199000000002', reason: ' ', hours: 1 }), /lý do/);
  assert.throws(() => validateBan({ steamId: '76561199000000002', reason: 'x', hours: 0 }), /hours/);
  const req = validateBan({ steamId: '76561199000000002', name: 'A,B', reason: 'Hack, cheat', hours: 72 });
  const calls = [];
  const rcon = { enabled: true, exec: async (op, args) => { calls.push([op, args]); return ''; }, directMessage: async (id, m) => { calls.push(['dm', id, m]); return ''; } };
  await banPlayer(rcon, req, true, async () => undefined);
  assert.equal(calls[0][0], 'dm');
  assert.match(calls[0][2], /^Bạn đã bị ban 3 ngày\. Lý do: Hack cheat\./);
  assert.deepEqual(calls[1], [0x20, 'A B,76561199000000002,Hack cheat,72']);
  assert.deepEqual(calls[2], [0x30, '76561199000000002']);
  calls.length = 0;
  await banPlayer(rcon, validateBan({ steamId: '76561199000000002', reason: 'x', hours: PERMANENT_HOURS }), false, async () => undefined);
  assert.equal(calls.length, 1, 'offline: no message, no kick');
});

test('reasons offered on the panel: defaults, then the admin\'s list', async () => {
  assert.deepEqual(await readReasons(), DEFAULT_REASONS);
  assert.deepEqual(await saveReasons(['Hack', ' Hack ', '', 'Spam, quảng cáo']), ['Hack', 'Spam quảng cáo']);
  assert.deepEqual(await readReasons(), ['Hack', 'Spam quảng cáo']);
});
