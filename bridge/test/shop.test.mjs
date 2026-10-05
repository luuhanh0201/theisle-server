// The Hổ phách shop (shop.ts): the suggested prices the first time, the panel's list checked, a buy paid
// first then given, the daily limit per player, never below 0, a skin once. npm test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'shop-'));
process.env.DATA_DIR = root;
const I = await import('../dist/items.js');
const E = await import('../dist/economy.js');
const S = await import('../dist/shop.js');
after(() => rmSync(root, { recursive: true, force: true }));

const A = '76561198000000001';
const DAY = 86400;
const NOON = Date.UTC(2026, 9, 5, 5) / 1000;   // 12:00 in Vietnam

test('the first time: the items there with the owner\'s suggested prices, cheapest first; never the dino item or the starter gift', async () => {
  const small = await I.createItem({ type: 'food_box', name: 'Hộp food nhỏ', rarity: 'common', data: { amount: 0.2 } }, null);
  const box = await I.createItem({ type: 'dino_box', name: 'Hộp dino ngẫu nhiên', rarity: 'epic', data: { pick: 'random' } }, null);
  await I.createItem({ type: 'mutation', name: 'Hydrodynamic', rarity: 'rare', data: { mutation: 'Hydrodynamic' } }, null);
  await I.ensureItem('starter_box', { type: 'dino_box', name: 'Quà tân thủ', rarity: 'legendary', data: { pick: 'choose' } });
  await I.ensureItem('dino', { type: 'dino', name: 'Dino', rarity: 'legendary', data: {} });
  const ls = await S.readShop();
  assert.deepEqual(ls.map((l) => [l.itemId, l.price, l.dailyLimit, l.enabled]), [[small.id, 50, 5, true], [box.id, 1500, 1, true]]);
  assert.deepEqual(await S.readShop(), ls, 'kept: the same ids the next time');
});

test('the panel\'s list: a real item, a whole price, a limit; the dino item refused', async () => {
  await assert.rejects(() => S.saveShop({ listings: [{ itemId: 'nope', price: 1 }] }), /không có vật phẩm/);
  await assert.rejects(() => S.saveShop({ listings: [{ itemId: 'dino', price: 1 }] }), /không bán được/);
  const [first] = await S.readShop();
  await assert.rejects(() => S.saveShop({ listings: [{ itemId: first.itemId, price: 1.5 }] }), /giá/);
  await assert.rejects(() => S.saveShop({ listings: [{ itemId: first.itemId, price: 10, dailyLimit: -1 }] }), /giới hạn/);
});

test('a buy: paid first, then given; the daily limit per player; never below 0; the next day again', async () => {
  const [food, box] = await S.readShop();
  await S.saveShop({ listings: [{ ...food, price: 50, dailyLimit: 3 }, { ...box, enabled: false }] });
  await E.credit(A, 200, 'test', null, NOON - 10);
  const view = await S.shopView(A, NOON);
  assert.deepEqual(view.map((v) => [v.id, v.left]), [[food.id, 3]], 'a listing switched off is not shown');
  assert.equal(view[0].item.name, 'Hộp food nhỏ');
  assert.equal('createdBy' in view[0].item, false, 'no admin data to the player');
  assert.deepEqual(await S.buy(A, food.id, 2, NOON), { item: 'Hộp food nhỏ', qty: 2, spent: 100, balance: 100, left: 1 });
  assert.equal((await I.inventoryOf(A)).filter((o) => o.itemId === food.itemId && o.source === 'shop').length, 2);
  await assert.rejects(() => S.buy(A, food.id, 2, NOON + 60), /còn mua được 1/);
  await assert.rejects(() => S.buy(A, box.id, 1, NOON), /không còn bán/);
  await assert.rejects(() => S.buy(A, food.id, 11, NOON), /Số lượng/);
  assert.equal((await S.buy(A, food.id, 1, NOON + 60)).balance, 50);
  await assert.rejects(() => S.buy(A, food.id, 1, NOON + 120), /tối đa 3/);
  // The next day (Vietnam time): the limit again; 50 left, 2 cost 100: refused, nothing given, nothing taken.
  await assert.rejects(() => S.buy(A, food.id, 2, NOON + DAY), /Không đủ Hổ phách: cần 100/);
  assert.equal(await E.balanceOf(A), 50);
  assert.equal((await I.inventoryOf(A)).filter((o) => o.itemId === food.itemId).length, 3);
  assert.equal((await S.buy(A, food.id, 1, NOON + DAY)).left, 2);
  const lines = await E.readLedger(A);
  assert.equal(lines[0].reason, 'Mua 1 × Hộp food nhỏ');
});

test('a skin: once per player; two buys at once: one each in turn, the limit holds', async () => {
  const skin = await I.createItem({ type: 'skin', name: 'Rex đỏ', rarity: 'epic', data: { species: 'Tyrannosaurus', colors: { Body: { r: 1, g: 0, b: 0 } } } }, null);
  const ls = await S.readShop();
  const saved = await S.saveShop({ listings: [...ls, { itemId: skin.id, price: 10, dailyLimit: 0 }] });
  const sk = saved.find((l) => l.itemId === skin.id);
  await E.credit(A, 1000, 'test', null, NOON + 2 * DAY);
  await assert.rejects(() => S.buy(A, sk.id, 2, NOON + 2 * DAY), /mỗi người 1 cái/);
  await S.buy(A, sk.id, 1, NOON + 2 * DAY);
  await assert.rejects(() => S.buy(A, sk.id, 1, NOON + 2 * DAY), /đã có/);
  assert.equal((await S.shopView(A, NOON + 2 * DAY)).find((v) => v.id === sk.id).owned, true);
  const food = saved[0];
  const both = await Promise.allSettled([S.buy(A, food.id, 3, NOON + 2 * DAY), S.buy(A, food.id, 3, NOON + 2 * DAY)]);
  assert.deepEqual(both.map((r) => r.status).sort(), ['fulfilled', 'rejected'], 'limit 3 a day: the second buy of 3 refused');
});
