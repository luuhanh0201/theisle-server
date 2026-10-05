// The starter gift (starter.ts): offered once per account, taken on the home page, only then a
// "Hộp dino tự chọn" in the bag (opened and used: dino-box.test.mjs). npm test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'starter-'));
process.env.DATA_DIR = join(root, 'data');
process.env.GARAGE_ROOT = join(root, 'garage');
mkdirSync(join(root, 'garage', 'stored'), { recursive: true });
const { grantStarters, claimStarter, starterOffered, STARTER_ITEM_ID } = await import('../dist/starter.js');
const { inventoryOf, getItem } = await import('../dist/items.js');
after(() => rmSync(root, { recursive: true, force: true }));

const A = '76561198000000001';
const B = '76561198000000002';
test('every account offered once: the ones who played, then each new one; taken once, only then in the bag', async () => {
  assert.deepEqual(await grantStarters([A, A, 'not-a-steamid']), [A]);
  assert.deepEqual(await grantStarters([A, B]), [B], 'A was offered theirs');
  assert.deepEqual(await grantStarters([A, B]), []);
  const item = await getItem(STARTER_ITEM_ID);
  assert.equal(item.type, 'dino_box');
  assert.deepEqual(item.data, { pick: 'choose', growthMin: 0.5, growthMax: 1, quest: false });
  assert.equal((await inventoryOf(A)).length, 0, 'offered: not in the bag yet');
  assert.equal(await starterOffered(A), true);
  assert.deepEqual(await claimStarter(A), { item: item.name });
  assert.equal((await inventoryOf(A)).filter((o) => o.itemId === STARTER_ITEM_ID).length, 1, 'taken: in the bag');
  assert.equal(await starterOffered(A), false, 'the home page box gone');
  await assert.rejects(() => claimStarter(A), /đã nhận/);
  assert.deepEqual(await grantStarters([A]), [], 'taken: never offered again');
  await assert.rejects(() => claimStarter('76561198000000003'), /chưa có/);
  const both = await Promise.allSettled([claimStarter(B), claimStarter(B)]);
  assert.deepEqual(both.map((r) => r.status).sort(), ['fulfilled', 'rejected'], 'two clicks at once: one ticket');
  assert.equal((await inventoryOf(B)).filter((o) => o.itemId === STARTER_ITEM_ID).length, 1);
});
