// Garage reads against a temp directory. config is read at import time, so
// GARAGE_ROOT is set before the module loads.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'garage-test-'));
process.env.GARAGE_ROOT = root;
const { readPlayerGarage, readGarageCatalog, createSlot, deleteSlot } = await import('../dist/garage.js');
const { queueKill } = await import('../dist/commands.js');
const { readNotes, setNote } = await import('../dist/notes.js');

const A = '76561198000000001';

before(() => {
  mkdirSync(join(root, 'stored'));
  const slot = (name, capturedAt, extra = {}) => writeFileSync(
    join(root, 'stored', `${A}__${name}.json`),
    JSON.stringify({ version: 1, slot: name, capturedAt, classPath: 'X.BP_Rex_C', growth: 0.7, ...extra }),
  );
  slot('old', 100);
  slot('new', 200, { mutations: { Slot1: 'MUT_Life' } });
  // An index entry whose name would escape stored/ if used as a path.
  writeFileSync(join(root, 'storage.json'), JSON.stringify({
    schema: 4, players: { [A]: { '../../etc/passwd': { classPath: 'x', growth: 1, capturedAt: 300 } } },
  }));
});
after(() => rmSync(root, { recursive: true, force: true }));

test('readPlayerGarage returns full states, newest first, and skips unsafe slot names', async () => {
  const dinos = await readPlayerGarage(A);
  assert.deepEqual(dinos.map((d) => d.slot), ['new', 'old']);
  assert.equal(dinos[0].state.mutations.Slot1, 'MUT_Life');
  assert.equal(dinos[1].meta.growth, 0.7);
});

test('readPlayerGarage rejects a malformed SteamID', async () => {
  await assert.rejects(() => readPlayerGarage('../x'), /17 digits/);
});

test('catalog from garage files ignores admin-created slots', async () => {
  writeFileSync(join(root, 'stored', `${A}__fake.json`), JSON.stringify({
    version: 1, slot: 'fake', capturedAt: 1, classPath: 'X.BP_Typo_C', createdBy: 'admin',
  }));
  const species = (await readGarageCatalog()).list().map((e) => e.species);
  assert.deepEqual(species, ['BP_Rex_C']);
});

test('createSlot stores chosen mutations; sex stays null unless given', async () => {
  await createSlot(A, 'mut', {
    classPath: 'X.BP_Rex_C', growth: 0.5, isFemale: true,
    mutations: { Slot1: 'MUT_Hematophagy', ParentSlot2: 'Reniculate Kidneys', Slot3: '' },
  });
  const [dino] = (await readPlayerGarage(A)).filter((d) => d.slot === 'mut');
  assert.deepEqual(dino.state.mutations, { Slot1: 'MUT_Hematophagy', ParentSlot2: 'Reniculate Kidneys' },
    'real in-game names have spaces and must be accepted');
  assert.equal(dino.state.isFemale, true);
  assert.equal(dino.state.growth, 0.5);

  await createSlot(A, 'plain', { classPath: 'X.BP_Rex_C', growth: 1 });
  const [plain] = (await readPlayerGarage(A)).filter((d) => d.slot === 'plain');
  assert.equal(plain.state.isFemale, null, 'must not claim male when nobody chose');
});

test('createSlot rejects bad mutation input', async () => {
  const base = { classPath: 'X.BP_Rex_C', growth: 1 };
  await assert.rejects(() => createSlot(A, 'bad', { ...base, mutations: { Slot9: 'MUT_A' } }), /unknown mutation slot/);
  await assert.rejects(() => createSlot(A, 'bad', { ...base, mutations: { Slot1: 'MUT A; drop' } }), /letters, digits/);
  await assert.rejects(() => createSlot(A, 'bad', { ...base, mutations: { Slot1: 42 } }), /letters, digits/);
  await assert.rejects(() => createSlot(A, 'bad', { ...base, mutations: ['MUT_A'] }), /object/);
  await assert.rejects(() => createSlot(A, 'bad', { ...base, isFemale: 'yes' }), /isFemale/);
});

test('deleteSlot moves the file to deleted/ and drops the index entry', async () => {
  await createSlot(A, 'gone', { classPath: 'X.BP_Rex_C', growth: 1 });
  const { trashedAs } = await deleteSlot(A, 'gone');
  assert.match(trashedAs, new RegExp(`^${A}__gone__\\d+\\.json$`));
  assert.ok(existsSync(join(root, 'deleted', trashedAs)), 'kept in deleted/');
  assert.ok(!existsSync(join(root, 'stored', `${A}__gone.json`)));
  const index = JSON.parse(readFileSync(join(root, 'storage.json'), 'utf8'));
  assert.equal(index.players[A]?.gone, undefined);
  assert.ok(!(await readPlayerGarage(A)).some((d) => d.slot === 'gone'), 'not listed any more');
  await assert.rejects(() => deleteSlot(A, 'gone'), /not found/);
  await assert.rejects(() => deleteSlot(A, '../x'), /slot must be/);
});

test('queueKill: growing ids, drops acked and expired commands, cleans the reason', async () => {
  const inbox = () => JSON.parse(readFileSync(join(root, 'inbox.json'), 'utf8')).commands;
  const [c1, c2] = await Promise.all([queueKill(A, 'hack\u0007 speed'), queueKill(A, undefined)]);
  assert.deepEqual([c1.id, c2.id].sort(), [1, 2], 'concurrent calls both land, no duplicate id');
  assert.equal(inbox().length, 2);
  assert.equal(c1.reason, 'hack  speed');
  assert.equal(c1.expiresAt - c1.createdAt, 60);

  writeFileSync(join(root, 'inbox.ack.json'), JSON.stringify({ lastId: 2 }));
  const c3 = await queueKill(A, '');
  assert.equal(c3.id, 3);
  assert.deepEqual(inbox().map((c) => c.id), [3], 'handled commands pruned');

  await assert.rejects(() => queueKill('123', ''), /17 digits/);
  await assert.rejects(() => queueKill(A, 'x'.repeat(201)), /200/);
  await assert.rejects(() => queueKill(A, 42), /text/);
});

test('createSlot refuses an occupied slot unless overwrite, and backs the old dino up', async () => {
  await createSlot(A, 'taken', { classPath: 'X.BP_Rex_C', growth: 0.3 });
  await assert.rejects(
    () => createSlot(A, 'taken', { classPath: 'X.BP_Rex_C', growth: 1 }),
    (err) => err.constructor.name === 'ConflictError' && /overwrite/.test(err.message),
  );
  const before = (await readPlayerGarage(A)).find((d) => d.slot === 'taken');
  assert.equal(before.state.growth, 0.3, 'refused write changed nothing');

  const meta = await createSlot(A, 'taken', { classPath: 'X.BP_Rex_C', growth: 1, overwrite: true });
  assert.match(meta.replaced, /^\d{17}__taken__\d+\.json$/);
  const backup = JSON.parse(readFileSync(join(root, 'deleted', meta.replaced), 'utf8'));
  assert.equal(backup.growth, 0.3, 'old dino kept in deleted/');
  assert.equal((await readPlayerGarage(A)).find((d) => d.slot === 'taken').state.growth, 1);

  const fresh = await createSlot(A, 'free', { classPath: 'X.BP_Rex_C', growth: 1, overwrite: true });
  assert.equal(fresh.replaced, null, 'overwrite on an empty slot replaces nothing');
  await assert.rejects(() => createSlot(A, 'x', { classPath: 'X', growth: 1, overwrite: 'yes' }), /overwrite/);
});

test('a slot known only to the index still counts as taken', async () => {
  const index = JSON.parse(readFileSync(join(root, 'storage.json'), 'utf8'));
  index.players[A].ghost = { classPath: 'X.BP_Rex_C', growth: 1, capturedAt: 1 };
  writeFileSync(join(root, 'storage.json'), JSON.stringify(index));
  await assert.rejects(() => createSlot(A, 'ghost', { classPath: 'X.BP_Rex_C', growth: 1 }), /overwrite/);
});

test('mutation notes: set, clear, and reject bad input', async () => {
  await setNote('MUT_Hematophagy', '  Hồi máu khi uống máu.\nDòng 2\u0007  ');
  let notes = await readNotes();
  assert.equal(notes.MUT_Hematophagy.description, 'Hồi máu khi uống máu.\nDòng 2', 'newline kept, bell stripped, trimmed');
  assert.ok(notes.MUT_Hematophagy.updatedAt > 0);

  const [a, b] = await Promise.all([setNote('MUT_A', 'a'), setNote('MUT_B', 'b')]);
  assert.ok(a && b);
  notes = await readNotes();
  assert.deepEqual(Object.keys(notes).sort(), ['MUT_A', 'MUT_B', 'MUT_Hematophagy'], 'concurrent writes both kept');

  assert.equal(await setNote('MUT_A', ''), null);
  assert.equal((await readNotes()).MUT_A, undefined, 'empty text clears');

  await setNote('Reniculate Kidneys', 'tên thật có dấu cách');
  assert.equal((await readNotes())['Reniculate Kidneys'].description, 'tên thật có dấu cách');
  await assert.rejects(() => setNote('../x', 'a'), /letters/);
  await assert.rejects(() => setNote('MUT_A', 5), /text/);
  await assert.rejects(() => setNote('MUT_A', 'x'.repeat(501)), /500/);
});

test('garage settings: defaults, validated save, the file the mod reads', async () => {
  const { readGarageSettings, saveGarageSettings } = await import('../dist/garage.js');
  const D = { redeemAt: 'current', maxSlots: 2, storeCountdown: 30, cooldown: 60 };
  assert.deepEqual(await readGarageSettings(), D, 'no file = the mod\'s defaults (2 slots, 30 s, 60 s)');
  const want = { redeemAt: 'choice', maxSlots: 3, storeCountdown: 10, cooldown: 0 };
  assert.deepEqual(await saveGarageSettings(want), want);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'garage-settings.json'), 'utf8')), want);
  assert.deepEqual(await readGarageSettings(), want);
  await assert.rejects(() => saveGarageSettings({ ...want, redeemAt: 'sideways' }), /current, stored, choice/);
  await assert.rejects(() => saveGarageSettings({ ...want, maxSlots: 0 }), /maxSlots.*1–20/);
  await assert.rejects(() => saveGarageSettings({ ...want, storeCountdown: 301 }), /storeCountdown.*0–300/);
  await assert.rejects(() => saveGarageSettings({ ...want, cooldown: 1.5 }), /cooldown/);
  assert.deepEqual(await readGarageSettings(), want, 'a rejected save changes nothing');
  writeFileSync(join(root, 'garage-settings.json'), '{broken');
  assert.deepEqual(await readGarageSettings(), D, 'a broken file = defaults, like the mod');
});

test('admin-made slots carry the fill the mod applies on redeem', async () => {
  await createSlot('76561198000000055', 'gift', { classPath: 'BlueprintGeneratedClass /Game/X.X_C', growth: 1 });
  const state = JSON.parse(readFileSync(join(root, 'stored', '76561198000000055__gift.json'), 'utf8'));
  assert.deepEqual(state.fill, { stomachFull: true, nutrientPct: 50 }, 'defaults: full stomach, 50 %');
  await createSlot('76561198000000055', 'lean', { classPath: 'BlueprintGeneratedClass /Game/X.X_C', growth: 1, stomachFull: false, nutrientPct: 80 });
  const lean = JSON.parse(readFileSync(join(root, 'stored', '76561198000000055__lean.json'), 'utf8'));
  assert.deepEqual(lean.fill, { stomachFull: false, nutrientPct: 80 });
  await assert.rejects(() => createSlot('76561198000000055', 'bad', { classPath: 'C', growth: 1, nutrientPct: 101 }), /0–100/);
});

test('admin-made prime: isPrime + elderStacks stored for restore.lua; prime needs 75 % growth', async () => {
  await createSlot(A, 'prime', { classPath: 'X.BP_Rex_C', growth: 1, isPrime: true, elderStacks: 2 });
  const st = JSON.parse(readFileSync(join(root, 'stored', `${A}__prime.json`), 'utf8'));
  assert.equal(st.isPrime, true);
  assert.equal(st.elderStacks, 2);
  await createSlot(A, 'plainprime', { classPath: 'X.BP_Rex_C', growth: 1 });
  const plain = JSON.parse(readFileSync(join(root, 'stored', `${A}__plainprime.json`), 'utf8'));
  assert.equal(plain.isPrime, null, 'not asked = left as the game has it');
  assert.equal(plain.elderStacks, null);
  await assert.rejects(() => createSlot(A, 'young', { classPath: 'X.BP_Rex_C', growth: 0.5, isPrime: true }), /at least 75/);
  await assert.rejects(() => createSlot(A, 'bad1', { classPath: 'X.BP_Rex_C', growth: 1, isPrime: 'yes' }), /isPrime/);
  await assert.rejects(() => createSlot(A, 'bad2', { classPath: 'X.BP_Rex_C', growth: 1, elderStacks: 1.5 }), /elderStacks/);
  await assert.rejects(() => createSlot(A, 'bad3', { classPath: 'X.BP_Rex_C', growth: 1, elderStacks: 99 }), /elderStacks/);
});
