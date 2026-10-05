// The server's items (panel → Vật phẩm): skins for now, saved by name for one species,
// each region lighter or darker than a player can pick, given to players' inventories,
// worn on the right dino (items.ts, /player-api skin { item }). npm test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'items-'));
process.env.DATA_DIR = join(root, 'data');
process.env.GARAGE_ROOT = join(root, 'garage');
process.env.PORTAL_TOKEN = 'portal-secret-token';
mkdirSync(join(root, 'garage', 'stored'), { recursive: true });
const I = await import('../dist/items.js');
const { handlePlayerApi } = await import('../dist/player-api.js');
const { Store } = await import('../dist/store.js');
after(() => rmSync(root, { recursive: true, force: true }));

const P1 = '76561198000000011';
const P2 = '76561198000000012';
const ADMIN = '76561199320940985';

const data = {
  species: 'BP_Carnotaurus_C',
  colors: { Body: { r: 0.2, g: 0.1, b: 0.05 }, Eyes: { r: 0.5, g: 0.9, b: 0.1 }, Markings: { r: 0, g: 0, b: 0 } },
  light: { Eyes: 3, Body: 0.25, Markings: 1 }, brightness: 1.2, pattern: 2, theme: 1, variation: 4,
};
const def = { type: 'skin', name: 'Hắc Long', rarity: 'epic', data };

test('what an admin may save', () => {
  assert.throws(() => I.validateItem({ ...def, type: 'sword' }), /unknown item type/);
  assert.throws(() => I.validateItem({ ...def, name: '' }), /name/);
  assert.throws(() => I.validateItem({ ...def, rarity: 'mythic' }), /rarity/);
  assert.throws(() => I.validateItem({ ...def, data: { ...data, species: '' } }), /species/);
  assert.throws(() => I.validateItem({ ...def, data: { ...data, colors: { Tail: { r: 0, g: 0, b: 0 } } } }), /unknown region/);
  assert.throws(() => I.validateItem({ ...def, data: { ...data, colors: { Body: { r: 1.5, g: 0, b: 0 } } } }), /0–1/, 'a picked colour is 0–1: brighter is `light`');
  assert.throws(() => I.validateItem({ ...def, data: { ...data, light: { Eyes: 5 } } }), /0.05–4/);
  assert.throws(() => I.validateItem({ ...def, data: { ...data, light: { Eyes: 0 } } }), /0.05–4/);
  assert.throws(() => I.validateItem({ ...def, data: { ...data, brightness: 0.01 } }), /brightness/);
  const d = I.validateItem(def);
  assert.equal(d.data.species, 'Carnotaurus', 'the short class name');
  assert.deepEqual(d.data.light, { Eyes: 3, Body: 0.25 }, '1 is the default: not kept');
});

test('the colours the game gets: × region light × brightness; never exactly black; at most 4', () => {
  const r = I.resolveSkin(I.validateSkinData(data));
  assert.deepEqual(r.colors.Eyes, { r: 1.8, g: 3.24, b: 0.36 }, 'brighter than a player can pick');
  assert.deepEqual(r.colors.Body, { r: 0.06, g: 0.03, b: 0.015 }, 'darker');
  assert.deepEqual(r.colors.Markings, { r: 0.0005, g: 0.0005, b: 0.0005 }, '(0, 0, 0) is an unused region to the game');
  assert.deepEqual([r.pattern, r.theme, r.variation], [undefined, undefined, undefined], 'colours only: the dino keeps its own pattern');
  const hot = I.resolveSkin(I.validateSkinData({ ...data, colors: { Eyes: { r: 1, g: 1, b: 1 } }, light: { Eyes: 4 }, brightness: 4 }));
  assert.deepEqual(hot.colors.Eyes, { r: 4, g: 4, b: 4 }, 'capped at what the game keeps');
});

test('items: create, edit, retire; a skin owned once; owners and counts; revoke', async () => {
  const item = await I.createItem(def, ADMIN);
  assert.match(item.id, /^it_[0-9a-f]{8}$/);
  assert.equal(item.createdBy, ADMIN);
  const { after: edited } = await I.updateItem(item.id, { ...def, name: 'Hắc Long II' });
  assert.equal(edited.name, 'Hắc Long II');
  assert.equal(edited.createdAt, item.createdAt);
  assert.equal((await I.listItems()).length, 1);

  const own = await I.grantItem(P1, item.id, 'admin', ADMIN, 'quà sự kiện');
  assert.match(own.uid, /^own_[0-9a-f]{8}$/);
  await assert.rejects(I.grantItem(P1, item.id, 'admin', ADMIN), /đã có/);
  await assert.rejects(I.grantItem(P1, 'it_nope', 'admin', ADMIN), /no such item/);
  await I.grantItem(P2, item.id, 'gacha', null);   // later: a loot box adds the same way
  assert.deepEqual((await I.ownersOf(item.id)).map((o) => o.steamId).sort(), [P1, P2]);
  assert.deepEqual(await I.ownerCounts(), { [item.id]: 2 });
  assert.equal((await I.inventoryOf(P1))[0].note, 'quà sự kiện');

  await I.updateItem(item.id, { ...def, name: 'Hắc Long II', retired: true });
  await assert.rejects(I.grantItem('76561198000000013', item.id, 'admin', ADMIN), /ngừng phát hành/);
  assert.equal((await I.inventoryOf(P1)).length, 1, 'a retired item stays with its owners');
  const { after: kept } = await I.updateItem(item.id, { ...def, name: 'Hắc Long II' });
  assert.equal(kept.retired, true, 'an edit without "retired" leaves it as it was');

  assert.equal(await I.revokeItem(P2, item.id), true);
  assert.equal(await I.revokeItem(P2, item.id), false);
  assert.deepEqual(await I.inventoryOf(P2), []);
  assert.ok(readFileSync(join(root, 'data', 'item-inventory.json'), 'utf8').includes(P1));
});

test('a player sees their items and wears a skin on a dino of its species', async () => {
  const store = new Store();
  const t = Math.floor(Date.now() / 1000);
  store.apply({ type: 'session_start', t, steamId: P1, name: 'P1' });
  store.apply({ type: 'spawn', t, steamId: P1, name: 'P1', species: 'BP_Troodon_C', growth: 0.5 });
  const call = async (path, method = 'GET', payload) => {
    const chunks = payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))];
    const req = { method, headers: { 'x-portal-token': 'portal-secret-token' }, async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; } };
    let status = 0; let body = '';
    await handlePlayerApi(req, { writeHead: (s) => { status = s; }, end: (b) => { body = b; } }, path, { store, serverPhase: async () => 'running' });
    return { status, body: body ? JSON.parse(body) : null };
  };
  const [item] = await I.listItems();
  const me = (await call(`/player-api/me/${P1}`)).body;
  assert.equal(me.items.length, 1);
  const mine = me.items[0];
  assert.deepEqual([mine.id, mine.type, mine.name, mine.species, mine.rarity, mine.source], [item.id, 'skin', 'Hắc Long II', 'Carnotaurus', 'epic', 'admin']);
  assert.equal(mine.skin.colors.Eyes.g, 3.24, 'the colours it paints');

  assert.equal((await call(`/player-api/skin/${P1}`, 'POST', { item: item.id })).status, 409, 'a Troodon cannot wear a Carnotaurus skin');
  assert.equal((await call(`/player-api/skin/${P2}`, 'POST', { item: item.id })).status, 403, 'not theirs (revoked)');
  store.apply({ type: 'spawn', t: t + 5, steamId: P1, name: 'P1', species: 'BP_Carnotaurus_C', growth: 0.5 });
  const r = await call(`/player-api/skin/${P1}`, 'POST', { item: item.id });
  assert.equal(r.status, 202);
  const inbox = JSON.parse(readFileSync(join(root, 'garage', 'inbox.json'), 'utf8'));
  const cmd = inbox.commands.find((c) => c.id === r.body.id);
  assert.deepEqual(cmd.skin.colors.Eyes, { r: 1.8, g: 3.24, b: 0.36 }, 'brighter than a player may pick: allowed for an owned skin');
});
