// The starter ticket (starter.ts): one per account, any dino into the garage with every prime task
// done, a growth drawn 50–100 %, the four slots' mutations picked by the player. npm test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'starter-'));
process.env.DATA_DIR = join(root, 'data');
process.env.GARAGE_ROOT = join(root, 'garage');
mkdirSync(join(root, 'garage', 'stored'), { recursive: true });
const { grantStarters, dinoOptions, checkChoice, useDinoTicket, STARTER_ITEM_ID, ALL_PRIME_TASKS } = await import('../dist/starter.js');
const { inventoryOf, getItem } = await import('../dist/items.js');
after(() => rmSync(root, { recursive: true, force: true }));

const A = '76561198000000001';
const B = '76561198000000002';
const REX = 'BlueprintGeneratedClass /Game/TheIsle/Core/Characters/Dinosaurs/Tyrannosaurus/BP_Tyrannosaurus.BP_Tyrannosaurus_C';
const TRIKE = 'BlueprintGeneratedClass /Game/TheIsle/Core/Characters/Dinosaurs/Triceratops/BP_Triceratops.BP_Triceratops_C';
const CATALOG = [
  { species: 'BP_Tyrannosaurus_C', classPath: REX },
  { species: 'BP_Triceratops_C', classPath: TRIKE },
  { species: 'BP_Unknown_C', classPath: null },
];

test('every account once: the ones who played, then each new one; the ticket item made once', async () => {
  assert.deepEqual(await grantStarters([A, A, 'not-a-steamid']), [A]);
  assert.deepEqual(await grantStarters([A, B]), [B], 'A had theirs');
  assert.deepEqual(await grantStarters([A, B]), []);
  const item = await getItem(STARTER_ITEM_ID);
  assert.equal(item.type, 'dino_ticket');
  assert.deepEqual(item.data, { growthMin: 0.5, growthMax: 1, quest: false });
  assert.equal((await inventoryOf(A)).filter((o) => o.itemId === STARTER_ITEM_ID).length, 1);
});

test('the options: species the server knows with their class, mutations without the quest ones', () => {
  const o = dinoOptions(CATALOG, { growthMin: 0.5, growthMax: 1, quest: false });
  assert.deepEqual(o.species.map((s) => s.key), ['triceratops', 'tyrannosaurus']);
  assert.ok(o.mutations.length > 10);
  assert.ok(o.mutations.every((m) => !m.quest), 'no quest mutation unless the ticket says so');
  assert.ok(dinoOptions(CATALOG, { growthMin: 0.5, growthMax: 1, quest: true }).mutations.some((m) => m.quest));
});

test('the pick is checked: species, sex, diet, slots 2 / 4, female only, none twice', () => {
  const o = dinoOptions(CATALOG, { growthMin: 0.5, growthMax: 1, quest: false });
  const carn = o.mutations.find((m) => m.diet === 'carnivore' && !m.slot2 && !m.femaleOnly);
  const herb = o.mutations.find((m) => m.diet === 'herbivore');
  const slot2 = o.mutations.find((m) => m.slot2 && (m.diet === 'all' || m.diet === 'carnivore') && !m.femaleOnly);
  const female = o.mutations.find((m) => m.femaleOnly && (m.diet === 'all' || m.diet === 'carnivore'));
  assert.throws(() => checkChoice({ species: 'Velociraptor', female: true }, o), /loài/);
  assert.throws(() => checkChoice({ species: 'Tyrannosaurus' }, o), /giới tính/);
  if (herb) assert.throws(() => checkChoice({ species: 'Tyrannosaurus', female: false, mutations: { 1: herb.name } }, o), /chỉ dành cho/);
  if (slot2) assert.throws(() => checkChoice({ species: 'Tyrannosaurus', female: false, mutations: { 1: slot2.name } }, o), /ô 2 hoặc 4/);
  if (female) assert.throws(() => checkChoice({ species: 'Tyrannosaurus', female: false, mutations: { 1: female.name } }, o), /con cái/);
  assert.throws(() => checkChoice({ species: 'Tyrannosaurus', female: false, mutations: { 1: carn.name, 3: carn.name } }, o), /ô khác/);
  assert.throws(() => checkChoice({ species: 'Tyrannosaurus', female: false, mutations: { 5: carn.name } }, o), /4 ô/);
  const ok = checkChoice({ species: 'BP_Tyrannosaurus_C', female: false, mutations: { 1: carn.name, 2: '', ...(slot2 ? { 4: slot2.name } : {}) } }, o);
  assert.equal(ok.option.classPath, REX);
  assert.deepEqual(ok.mutations, { Slot1: carn.name, ...(slot2 ? { Slot4: slot2.name } : {}) });
});

test('using it: the dino in the next free garage slot, every prime task, the drawn growth; the ticket gone', async () => {
  const uid = (await inventoryOf(A)).find((o) => o.itemId === STARTER_ITEM_ID).uid;
  const carn = dinoOptions(CATALOG, { growthMin: 0.5, growthMax: 1, quest: false }).mutations.find((m) => m.diet === 'carnivore' && !m.slot2 && !m.femaleOnly);
  const out = await useDinoTicket(A, uid, { species: 'Tyrannosaurus', female: true, mutations: { 1: carn.name } }, CATALOG, () => 0.6);
  assert.deepEqual({ slot: out.slot, growth: out.growth, female: out.female }, { slot: '1', growth: 0.8, female: true }, '50 % + 60 % of the 50 % range');
  const slot = JSON.parse(readFileSync(join(root, 'garage', 'stored', `${A}__1.json`), 'utf8'));
  assert.equal(slot.classPath, REX);
  assert.equal(slot.growth, 0.8);
  assert.equal(slot.isFemale, true);
  assert.deepEqual(slot.mutations, { Slot1: carn.name });
  assert.equal([...Array(10)].filter((_, i) => slot.primeData[`cond${i + 1}`] === true).length, ALL_PRIME_TASKS.length, 'all ten prime tasks');
  assert.equal(slot.primeData.eligible, true, 'eligible: prime from about 75 %');
  assert.equal((await inventoryOf(A)).some((o) => o.uid === uid), false, 'used up');
  await assert.rejects(() => useDinoTicket(A, uid, { species: 'Tyrannosaurus', female: true }, CATALOG), /không có phiếu/);
});

test('a refused pick keeps the ticket', async () => {
  const uid = (await inventoryOf(B)).find((o) => o.itemId === STARTER_ITEM_ID).uid;
  await assert.rejects(() => useDinoTicket(B, uid, { species: 'Velociraptor', female: true }, CATALOG), /loài/);
  assert.ok((await inventoryOf(B)).some((o) => o.uid === uid));
});
