// Hổ phách and the daily check-in (economy.ts): balances never below 0 with a ledger line each time,
// minutes in game per Vietnam day from the sessions, a 7-day streak. npm test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'economy-'));
process.env.DATA_DIR = root;
const { PlayDays, dayOf, credit, balanceOf, readLedger, checkinStatus, claimCheckin, saveEconomySettings, readEconomySettings, validateEconomySettings } = await import('../dist/economy.js');
const { createItem, inventoryOf } = await import('../dist/items.js');
after(() => rmSync(root, { recursive: true, force: true }));

const A = '76561198000000001';
const B = '76561198000000002';
// 2026-10-05 00:00 in Vietnam (UTC+7).
const MIDNIGHT = Date.UTC(2026, 9, 5) / 1000 - 7 * 3600;
const DAY = 86400;

test('the settings: defaults, checked, kept', async () => {
  assert.deepEqual(await readEconomySettings(), { checkinMinutes: 15, checkinRewards: [50, 60, 70, 80, 100, 120, 200], checkinBonusItem: null });
  assert.throws(() => validateEconomySettings({ checkinRewards: [1, 2, 3] }), /7 whole numbers/);
  assert.throws(() => validateEconomySettings({ checkinMinutes: -1 }), /0–600/);
  await assert.rejects(() => saveEconomySettings({ checkinBonusItem: 'it_missing' }), /no such item/);
});

test('balances: credited and taken with a reason, never below 0, a ledger line each time', async () => {
  assert.equal((await credit(A, 100, 'admin gift', 'Admin', 1000)).balance, 100);
  assert.equal((await credit(A, -30, 'shop', null, 1001)).balance, 70);
  await assert.rejects(() => credit(A, -71, 'too much', null), /không đủ/);
  await assert.rejects(() => credit(A, 5, '  ', null), /reason/);
  await assert.rejects(() => credit('nope', 5, 'x', null), /SteamID64/);
  assert.equal(await balanceOf(A), 70);
  const lines = await readLedger(A);
  assert.deepEqual(lines.map((l) => [l.delta, l.balance, l.reason]), [[-30, 70, 'shop'], [100, 100, 'admin gift']], 'newest first');
});

test('minutes in game per Vietnam day: split at midnight, an open session counted to now, a server start ends them', () => {
  const p = new PlayDays();
  p.onEvent({ type: 'session_start', t: MIDNIGHT - 10 * 60, steamId: A });   // 23:50 the day before
  p.onEvent({ type: 'session_end', t: MIDNIGHT + 20 * 60, steamId: A });     // 00:20
  assert.equal(p.minutesToday(A, MIDNIGHT + 3600), 20, 'only the minutes after midnight are today');
  assert.equal(p.minutesToday(A, MIDNIGHT - 1), 10, 'yesterday had 10');
  p.onEvent({ type: 'session_start', t: MIDNIGHT + 3600, steamId: A });
  assert.equal(p.minutesToday(A, MIDNIGHT + 3600 + 5 * 60), 25, 'still in game: counted to now');
  p.onEvent({ type: 'mod_loaded', t: MIDNIGHT + 3600 + 10 * 60, mod: 'DinoGarage' });   // crashed: no session_end
  assert.equal(p.minutesToday(A, MIDNIGHT + 5 * 3600), 30, 'the server start closed it');
  assert.equal(dayOf(MIDNIGHT), dayOf(MIDNIGHT + DAY - 1));
  assert.notEqual(dayOf(MIDNIGHT - 1), dayOf(MIDNIGHT));
});

test('the check-in: enough minutes, once a day, the streak goes on, a missed day starts again, 7 days round', async () => {
  const bonus = await createItem({ type: 'prime_ticket', name: 'Phiếu Prime', rarity: 'epic', data: {} }, null);
  await saveEconomySettings({ checkinMinutes: 15, checkinRewards: [10, 20, 30, 40, 50, 60, 70], checkinBonusItem: bonus.id });
  const at = (d, h = 12) => MIDNIGHT + d * DAY + h * 3600;
  assert.equal((await checkinStatus(B, 5, at(0))).ready, false);
  await assert.rejects(() => claimCheckin(B, 5, at(0)), /15 phút/);
  assert.deepEqual(await claimCheckin(B, 15, at(0)), { day: 1, reward: 10, balance: 10, item: null });
  await assert.rejects(() => claimCheckin(B, 60, at(0, 20)), /đã điểm danh/);
  assert.equal((await checkinStatus(B, 60, at(0, 20))).claimed, true);
  for (let d = 1; d <= 6; d++) await claimCheckin(B, 15, at(d));
  assert.equal(await balanceOf(B), 10 + 20 + 30 + 40 + 50 + 60 + 70);
  assert.equal((await inventoryOf(B)).filter((o) => o.itemId === bonus.id).length, 1, 'day 7 gives the item');
  assert.equal((await claimCheckin(B, 15, at(7))).day, 1, 'after day 7: day 1 again');
  assert.equal((await checkinStatus(B, 15, at(9))).day, 1, 'a day missed: back to day 1');
  assert.equal((await claimCheckin(B, 15, at(9, 0.5))).reward, 10, '00:30 Vietnam time is already the new day');
  const ledger = readFileSync(join(root, 'economy-ledger.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.steamId === B);
  assert.equal(ledger.length, 9, 'a line for each check-in');
  assert.equal(ledger[0].reason, 'Điểm danh ngày 1/7');
});
