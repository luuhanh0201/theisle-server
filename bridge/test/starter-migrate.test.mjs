// The starter gift before the home page (starter.ts): tickets put straight into the bags. Read once:
// a ticket still unused goes back to "offered" (out of the bag, kept in a copy first); a used one is taken.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'starter-migrate-'));
const data = join(root, 'data');
process.env.DATA_DIR = data;
process.env.GARAGE_ROOT = join(root, 'garage');
mkdirSync(data, { recursive: true });
const { grantStarters, claimStarter, starterOffered, STARTER_ITEM_ID } = await import('../dist/starter.js');
const { inventoryOf, grantItem, getItem } = await import('../dist/items.js');
after(() => rmSync(root, { recursive: true, force: true }));

const OLD = 'starter_dino';   // the first hours' ticket (type dino_ticket, read since as a dino box)
const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003';

test('the old tickets: unused back to the home page, used ones taken, the bags kept in a copy', async () => {
  // As the first hours left it: A and B given one, B used theirs; A also owns something else.
  writeFileSync(join(data, 'items.json'), JSON.stringify({ items: { [OLD]: { id: OLD, type: 'dino_ticket', name: 'Phiếu chọn dino', rarity: 'legendary',
    retired: false, data: { growthMin: 0.5, growthMax: 1, quest: false }, createdAt: 1, createdBy: null, updatedAt: 1 } } }));
  await grantItem(A, OLD, 'event', null, 'old');
  writeFileSync(join(data, 'starter-granted.json'), JSON.stringify({ players: { [A]: 100, [B]: 100 } }));
  assert.deepEqual((await getItem(OLD)).data, { pick: 'choose', growthMin: 0.5, growthMax: 1, quest: false }, 'the old ticket read as a box the species is picked in');
  assert.equal((await getItem(OLD)).type, 'dino_box');
  assert.deepEqual(await grantStarters([A, B, C], 500), [C], 'A and B not offered twice');
  assert.equal((await inventoryOf(A)).length, 0, 'the unused ticket out of the bag');
  assert.equal(await starterOffered(A), true, 'A: on the home page');
  assert.equal(await starterOffered(B), false, 'B used theirs');
  assert.ok(readdirSync(data).some((f) => f.startsWith('item-inventory.json.bak-starter-')), 'the bags copied first');
  assert.equal(existsSync(join(data, 'starter-granted.json')), false, 'read once');
  await claimStarter(A);
  assert.equal((await inventoryOf(A)).filter((o) => o.itemId === STARTER_ITEM_ID).length, 1, 'taken again: one box, the new one');
  assert.equal((await inventoryOf(A)).some((o) => o.itemId === OLD), false);
});
