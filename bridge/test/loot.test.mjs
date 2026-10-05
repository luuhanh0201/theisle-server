// Hòm (loot.ts): the admin's prizes checked, a draw by weight, the swap in one write, a skin owned left
// out, an admin's hòm kept. npm test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'loot-'));
process.env.DATA_DIR = root;
const I = await import('../dist/items.js');
const L = await import('../dist/loot.js');
after(() => rmSync(root, { recursive: true, force: true }));

const A = '76561198000000001';
const food = await I.createItem({ type: 'food_box', name: 'Hộp food nhỏ', rarity: 'common', data: { amount: 0.2 } }, null);
const prime = await I.createItem({ type: 'prime_ticket', name: 'Phiếu Prime', rarity: 'legendary', data: {} }, null);
const skin = await I.createItem({ type: 'skin', name: 'Rex đỏ', rarity: 'epic', data: { species: 'Tyrannosaurus', colors: { Body: { r: 1, g: 0, b: 0 } } } }, null);
const hom = async (pool) => I.createItem({ type: 'loot_box', name: 'Hòm cổ đại', rarity: 'epic', data: { pool } }, null);

test('the admin\'s list: items that exist, no hòm in a hòm, no dino item; whole qty and weight', async () => {
  await assert.rejects(() => hom([{ itemId: 'nope', weight: 1 }]), /không có vật phẩm/);
  await assert.rejects(() => hom([{ itemId: food.id, weight: 0 }]), /trọng số/);
  await assert.rejects(() => hom([{ itemId: food.id, weight: 1, qty: 11 }]), /số lượng/);
  const h = await hom([{ itemId: food.id, weight: 1 }]);
  await assert.rejects(() => hom([{ itemId: h.id, weight: 1 }]), /hòm khác/);
  await I.ensureItem('dino', { type: 'dino', name: 'Dino', rarity: 'legendary', data: {} });
  await assert.rejects(() => hom([{ itemId: 'dino', weight: 1 }]), /hộp dino/);
  await assert.rejects(async () => I.updateItem(h.id, { type: 'loot_box', name: 'x', data: { pool: [{ itemId: h.id, weight: 1 }] } }), /hòm khác/);
});

test('the chances; a draw by weight: the prize in, the hòm out, once', async () => {
  const h = await hom([{ itemId: food.id, qty: 3, weight: 75 }, { itemId: prime.id, weight: 25 }]);
  const own = await I.grantItem(A, h.id, 'shop', null);
  const opts = await L.lootOptions(A, own.uid);
  assert.deepEqual(opts.pool.map((p) => [p.name, p.qty]), [['Hộp food nhỏ', 3], ['Phiếu Prime', 1]]);
  assert.ok(!/chance|weight/.test(JSON.stringify(opts)), 'the player never sees a chance or a weight');
  const box = await I.getItem(h.id);
  assert.deepEqual((await L.lootPool(A, box)).map((p) => p.chance), [0.75, 0.25], 'the chances, server side');
  // 0.8 × 100 = 80: past the food's 75 → the ticket.
  const out = await L.openLootBox(A, own.uid, false, () => 0.8);
  assert.equal(out.won.name, 'Phiếu Prime');
  assert.equal(out.chance, 0.25, 'for the audit');
  assert.ok(!/chance|weight/.test(JSON.stringify(out.won)), 'the prize sent: no chance');
  const inv = await I.inventoryOf(A);
  assert.equal(inv.some((o) => o.uid === own.uid), false, 'the hòm gone');
  assert.equal(inv.filter((o) => o.itemId === prime.id && o.source === 'gacha').length, 1);
  await assert.rejects(() => L.openLootBox(A, own.uid), /không có hòm/);
  const own2 = await I.grantItem(A, h.id, 'shop', null);
  assert.equal((await L.openLootBox(A, own2.uid, false, () => 0.1)).won.qty, 3);
  assert.equal((await I.inventoryOf(A)).filter((o) => o.itemId === food.id).length, 3, '3 copies');
});

test('a skin owned already is left out of the draw; nothing left: the hòm stays; an admin keeps the hòm; two opens at once: one prize', async () => {
  const h = await hom([{ itemId: skin.id, weight: 1 }]);
  const own = await I.grantItem(A, h.id, 'shop', null);
  assert.equal((await L.openLootBox(A, own.uid, false, () => 0.5)).won.name, 'Rex đỏ');
  const again = await I.grantItem(A, h.id, 'shop', null);
  assert.deepEqual((await L.lootOptions(A, again.uid)).pool, [], 'the skin owned: out');
  await assert.rejects(() => L.openLootBox(A, again.uid), /chưa có gì để mở/);
  assert.ok((await I.inventoryOf(A)).some((o) => o.uid === again.uid), 'the hòm kept');
  const h2 = await hom([{ itemId: food.id, weight: 1 }]);
  const adm = await I.grantItem(A, h2.id, 'admin', null);
  await L.openLootBox(A, adm.uid, true);
  assert.ok((await I.inventoryOf(A)).some((o) => o.uid === adm.uid), 'an admin\'s bag: the hòm stays');
  const once = await I.grantItem(A, h2.id, 'shop', null);
  const before = (await I.inventoryOf(A)).filter((o) => o.itemId === food.id).length;
  const both = await Promise.allSettled([L.openLootBox(A, once.uid), L.openLootBox(A, once.uid)]);
  assert.equal(both.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await I.inventoryOf(A)).filter((o) => o.itemId === food.id).length, before + 1);
});

test('the shop never shows a hòm\'s prizes or weights, only how many', async () => {
  const S = await import('../dist/shop.js');
  const h = await hom([{ itemId: food.id, weight: 7 }, { itemId: prime.id, weight: 3 }]);
  await S.saveShop({ listings: [{ itemId: h.id, price: 300, dailyLimit: 5 }] });
  const [l] = await S.shopView(A);
  assert.deepEqual(l.item.data, { prizes: 2 });
});
