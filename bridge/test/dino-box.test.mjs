// The dino boxes (dino-box.ts): a box opens into a dino item (species drawn or picked, growth drawn);
// the dino item, used, goes into the garage with the mutations of the slots its growth opens. npm test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'dino-box-'));
process.env.DATA_DIR = join(root, 'data');
process.env.GARAGE_ROOT = join(root, 'garage');
mkdirSync(join(root, 'garage', 'stored'), { recursive: true });
const B = await import('../dist/dino-box.js');
const I = await import('../dist/items.js');
after(() => rmSync(root, { recursive: true, force: true }));

const A = '76561198000000001';
const REX = 'BlueprintGeneratedClass /Game/TheIsle/Core/Characters/Dinosaurs/Tyrannosaurus/BP_Tyrannosaurus.BP_Tyrannosaurus_C';
const TRIKE = 'BlueprintGeneratedClass /Game/TheIsle/Core/Characters/Dinosaurs/Triceratops/BP_Triceratops.BP_Triceratops_C';
const CATALOG = [
  { species: 'BP_Tyrannosaurus_C', classPath: REX },
  { species: 'BP_Triceratops_C', classPath: TRIKE },
  { species: 'BP_Unknown_C', classPath: null },
];
const box = (pick, extra = {}) => I.createItem({ type: 'dino_box', name: `Hộp dino ${pick}`, rarity: 'epic', data: { pick, ...extra } }, null);
const carn = B.mutationOptions(false).find((m) => m.diet === 'carnivore' && !m.slot2 && !m.femaleOnly);

test('the items: a box\'s data checked; the dino item made by opening only; the old ticket read as a box', async () => {
  assert.throws(() => I.validateItem({ type: 'dino_box', name: 'x', data: { pick: 'any' } }), /pick must be/);
  assert.throws(() => I.validateItem({ type: 'dino_box', name: 'x', data: { growthMin: 0.9, growthMax: 0.5 } }), /growthMin/);
  assert.deepEqual(I.validateItem({ type: 'dino_ticket', name: 'x', data: {} }).type, 'dino_box', 'the panel\'s old type name');
  await assert.rejects(() => I.createItem({ type: 'dino', name: 'Dino', data: {} }, null), /hệ thống/);
  await I.ensureItem(B.DINO_ITEM_ID, { type: 'dino', name: 'Dino', rarity: 'legendary', data: {} });
  await assert.rejects(() => I.grantItem(A, B.DINO_ITEM_ID, 'admin', null), /mở hộp/);
});

test('the options: species the server knows, mutations with their Vietnamese description, slots by growth', () => {
  assert.deepEqual(B.speciesOptions(CATALOG).map((s) => s.key), ['triceratops', 'tyrannosaurus']);
  const muts = B.mutationOptions(false);
  assert.ok(muts.length > 10 && muts.every((m) => !m.quest && m.description.length > 0));
  assert.ok(B.mutationOptions(true).some((m) => m.quest));
  assert.deepEqual(B.openSlots(0.5), [1, 2]);
  assert.deepEqual(B.openSlots(0.74), [1, 2]);
  assert.deepEqual(B.openSlots(0.75), [1, 2, 3, 4]);
  assert.deepEqual(B.openSlots(0.2), []);
});

test('a random box: the species and growth drawn, the box gone, a dino in the bag; opened once', async () => {
  const it = await box('random');
  const own = await I.grantItem(A, it.id, 'admin', null);
  // 0.7 picks the 2nd of [triceratops, tyrannosaurus]; growth 50 % + 0.7 × 50 % = 85 %.
  const out = await B.openDinoBox(A, own.uid, { species: 'triceratops' }, CATALOG, () => 0.7);
  assert.deepEqual({ species: out.species, label: out.label, growth: out.growth, drawn: out.drawn },
    { species: 'tyrannosaurus', label: 'Tyrannosaurus', growth: 0.85, drawn: true }, 'a random box ignores a species sent');
  const inv = await I.inventoryOf(A);
  assert.equal(inv.some((o) => o.uid === own.uid), false, 'the box gone');
  const dino = inv.find((o) => o.uid === out.uid);
  assert.deepEqual(dino.dino, { species: 'tyrannosaurus', growth: 0.85, quest: false });
  assert.equal(dino.itemId, B.DINO_ITEM_ID);
  await assert.rejects(() => B.openDinoBox(A, own.uid, {}, CATALOG), /không có hộp/);
});

test('a box the species is picked in: a species needed, a refused one keeps the box; two opens at once: one dino', async () => {
  const it = await box('choose', { growthMin: 0.6, growthMax: 0.6 });
  const own = await I.grantItem(A, it.id, 'admin', null);
  assert.equal((await B.boxOptions(A, own.uid, CATALOG)).pick, 'choose');
  await assert.rejects(() => B.openDinoBox(A, own.uid, { species: 'Velociraptor' }, CATALOG), /loài/);
  assert.ok((await I.inventoryOf(A)).some((o) => o.uid === own.uid), 'kept');
  const before = (await I.inventoryOf(A)).length;
  const both = await Promise.allSettled([B.openDinoBox(A, own.uid, { species: 'Triceratops' }, CATALOG), B.openDinoBox(A, own.uid, { species: 'Triceratops' }, CATALOG)]);
  assert.deepEqual(both.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal((await I.inventoryOf(A)).length, before, 'one box out, one dino in');
});

test('using a dino: the sex and the mutations of the open slots; into the garage with every prime task; gone', async () => {
  const it = await box('choose', { growthMin: 0.6, growthMax: 0.6 });
  const own = await I.grantItem(A, it.id, 'admin', null);
  const opened = await B.openDinoBox(A, own.uid, { species: 'BP_Tyrannosaurus_C' }, CATALOG);
  const opts = await B.dinoItemOptions(A, opened.uid, CATALOG);
  assert.deepEqual({ species: opts.species, growth: opts.growth, openSlots: opts.openSlots }, { species: 'tyrannosaurus', growth: 0.6, openSlots: [1, 2] });
  assert.ok(opts.mutations.every((m) => m.diet !== 'herbivore'), 'the diet of a Rex');
  await assert.rejects(() => B.useDinoItem(A, opened.uid, { female: true, mutations: { 3: carn.name } }, CATALOG), /Ô 3 mở từ 75%.*60%/);
  await assert.rejects(() => B.useDinoItem(A, opened.uid, { mutations: {} }, CATALOG), /giới tính/);
  assert.ok((await I.inventoryOf(A)).some((o) => o.uid === opened.uid), 'a refused pick keeps the dino');
  const out = await B.useDinoItem(A, opened.uid, { female: false, mutations: { 1: carn.name, 2: '' } }, CATALOG);
  assert.deepEqual({ species: out.species, growth: out.growth, female: out.female }, { species: 'Tyrannosaurus', growth: 0.6, female: false });
  const slot = JSON.parse(readFileSync(join(root, 'garage', 'stored', `${A}__${out.slot}.json`), 'utf8'));
  assert.equal(slot.classPath, REX);
  assert.equal(slot.growth, 0.6);
  assert.deepEqual(slot.mutations, { Slot1: carn.name });
  assert.equal([...Array(10)].filter((_, i) => slot.primeData[`cond${i + 1}`] === true).length, B.ALL_PRIME_TASKS.length, 'all ten prime tasks');
  assert.equal((await I.inventoryOf(A)).some((o) => o.uid === opened.uid), false, 'used up');
  await assert.rejects(() => B.useDinoItem(A, opened.uid, { female: false }, CATALOG), /không có vật phẩm dino/);
});
