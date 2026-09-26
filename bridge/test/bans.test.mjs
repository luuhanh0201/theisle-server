// Bans (bans.ts): the game's PlayerBans.json read as it is on this server,
// each new ban once, and a ban from the panel (DM, BanPlayer in hours, kick).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'bans-test-'));
process.env.DATA_DIR = root;
const { parseBans, parseGameTime, durationText, banVars, BanWatcher, validateBan, banPlayer, PERMANENT_HOURS, readReasons, saveReasons, DEFAULT_REASONS } = await import('../dist/bans.js');
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
  let text = FILE;
  const seen = [];
  const w = new BanWatcher((b) => seen.push(b.name), async () => parseBans(text));
  await w.tick();
  assert.deepEqual(seen, [], 'old bans are not announced again after a restart');
  const d = JSON.parse(FILE);
  d.bannedPlayerData.push({ steamId: '76561199000000002', playerName: 'Troll', banReason: 'Spam', bannedTime: '2026.09.26-12.00.00', endBanTime: '2026.09.27-12.00.00', bannerName: 'Rcon' });
  text = JSON.stringify(d);
  await w.tick();
  await w.tick();
  assert.deepEqual(seen, ['Troll']);
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
