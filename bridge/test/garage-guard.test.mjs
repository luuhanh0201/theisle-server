// The garage across a crash or a restart (garage-guard.ts): a dino taken out or stored while the
// server went down, before the game saved it, is put back / the store undone. npm test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'garage-guard-'));
process.env.GARAGE_ROOT = join(root, 'garage');
process.env.DATA_DIR = join(root, 'data');
mkdirSync(join(root, 'garage', 'stored'), { recursive: true });
mkdirSync(join(root, 'garage', 'deleted'), { recursive: true });
const { GarageGuard, runGuardAction, loadGuard, saveGuard, speciesName } = await import('../dist/garage-guard.js');
after(() => rmSync(root, { recursive: true, force: true }));

const ME = '76561199249248628';
const REX = 'BlueprintGeneratedClass /Game/TheIsle/Core/Characters/Dinosaurs/Tyrannosaurus/BP_Tyrannosaurus.BP_Tyrannosaurus_C';
const CARNO = 'BlueprintGeneratedClass /Game/TheIsle/Core/Characters/Dinosaurs/Carnotaurus/BP_Carnotaurus.BP_Carnotaurus_C';
const FILE = `${ME}__1__redeemed-1000.json`;
// Real times for the files (the history names carry a 9–11 digit time).
const B = 1791110356;
const start = (t = 1000, slot = '1', growth = 0.7529) =>
  ({ type: 'garage_redeem_start', t, steamId: ME, slot, file: `${ME}__${slot}__redeemed-${t}.json`, species: REX, growth });
const redeemed = (t = 1004, ok = true, slot = '1', growth = 0.7529) =>
  ({ type: 'garage_redeem', t, steamId: ME, slot, ok, species: REX, growth, at: 'stored' });
const started = (t) => ({ type: 'mod_loaded', t, mod: 'DinoGarage' });
const spawn = (t, classPath, growth) => ({ type: 'spawn', t, steamId: ME, classPath, growth, species: speciesName(classPath) });
const run = (g, events) => events.flatMap((e) => g.onEvent(e));

test('Dev-Lucii, 2026-10-04: taken out, the server crashed, back on a hatchling: the slot goes back', () => {
  const g = new GarageGuard(500);
  const acts = run(g, [start(), redeemed(), started(1058), spawn(1100, REX, 0.25)]);
  assert.equal(acts.length, 1);
  assert.deepEqual({ kind: acts[0].kind, slot: acts[0].slot, file: acts[0].file, growth: acts[0].growth },
    { kind: 'put-back', slot: '1', file: FILE, growth: 0.7529 });
  assert.equal(g.pending.length, 0);
});

test('down during the restore itself: the slot goes back at the start, before any spawn', () => {
  const g = new GarageGuard(500);
  assert.deepEqual(run(g, [start()]), []);
  const acts = g.onEvent(started(1003));
  assert.equal(acts.length, 1);
  assert.equal(acts[0].kind, 'put-back');
  assert.match(acts[0].why, /during the restore/);
});

test('the game kept the restored dino (saved before the crash, grown a little since): nothing to do', () => {
  const g = new GarageGuard(500);
  assert.deepEqual(run(g, [start(), redeemed(), started(1200), spawn(1300, REX, 0.7612)]), []);
  assert.equal(g.pending.length, 0);
  assert.ok(g.resolved.includes(`${ME}:redeem:1:1000`), 'settled: not looked at again');
});

test('settled in the same run: a logout, a death, a new dino or a new garage action — a later start changes nothing', () => {
  for (const between of [
    { type: 'session_end', t: 1100, steamId: ME },
    { type: 'death', t: 1100, steamId: ME, growth: 0.75 },
    spawn(1100, CARNO, 0.25),
    { type: 'garage_store', t: 1100, steamId: ME, slot: '2', species: CARNO, growth: 0.3 },
  ]) {
    const g = new GarageGuard(500);
    const acts = run(g, [start(), redeemed(), between, started(1200), spawn(1300, REX, 0.25)]);
    assert.deepEqual(acts.filter((a) => a.kind === 'put-back'), [], `after ${between.type}`);
  }
});

test('a failed restore (the mod put the slot back itself) is not followed', () => {
  const g = new GarageGuard(500);
  assert.deepEqual(run(g, [start(), redeemed(1004, false), started(1200), spawn(1300, REX, 0.25)]), []);
});

test('stored, then down before the game saved: back on the stored dino → the store is undone; on a hatchling → it stands', () => {
  const store = { type: 'garage_store', t: 1000, steamId: ME, slot: '2', species: REX, growth: 0.6 };
  const g = new GarageGuard(500);
  const acts = run(g, [store, { type: 'death', t: 1000, steamId: ME }, started(1050), spawn(1100, REX, 0.6)]);
  assert.deepEqual(acts.map((a) => [a.kind, a.slot]), [['undo-store', '2']], 'its own corpse dying does not settle it');
  const h = new GarageGuard(500);
  assert.deepEqual(run(h, [store, started(1050), spawn(1100, REX, 0.25)]), [], 'a fresh dino: the store held');
  const k = new GarageGuard(500);
  assert.deepEqual(run(k, [store, { type: 'session_end', t: 1010, steamId: ME }, started(1050), spawn(1100, REX, 0.6)]), [],
    'logged off first: the game saved the store');
  const young = new GarageGuard(500);
  assert.deepEqual(run(young, [{ ...store, growth: 0.25 }, started(1050), spawn(1100, REX, 0.25)]), [],
    'a hatchling stored cannot be told from a fresh spawn: the store stands');
});

test('the past before the guard began, and actions already settled, are never acted on (the events are read again at every start)', () => {
  const events = [start(), redeemed(), started(1058), spawn(1100, REX, 0.25)];
  assert.deepEqual(run(new GarageGuard(2000), events), [], 'before `since`');
  const first = new GarageGuard(500);
  const [a] = run(first, events);
  first.resolve(a.key);
  assert.deepEqual(run(new GarageGuard(500, first.resolved), events), [], 'once');
});

test('a mod from before garage_redeem_start: the redeem is still guarded, its history file found by time', async () => {
  const g = new GarageGuard(500);
  const [a] = run(g, [redeemed(B + 4), started(B + 58), spawn(B + 100, REX, 0.25)]);
  assert.equal(a.kind, 'put-back');
  assert.equal(a.file, null);
  writeFileSync(join(root, 'garage', 'deleted', `${ME}__1__redeemed-${B}.json`),
    JSON.stringify({ version: 1, slot: '1', classPath: REX, growth: 0.7529, capturedAt: B - 100 }));
  const out = await runGuardAction(a);
  assert.equal(out.slot, '1');
  const slot = JSON.parse(readFileSync(join(root, 'garage', 'stored', `${ME}__1.json`), 'utf8'));
  assert.deepEqual([slot.classPath, slot.growth, slot.slot], [REX, 0.7529, '1']);
  const index = JSON.parse(readFileSync(join(root, 'garage', 'storage.json'), 'utf8'));
  assert.equal(index.players[ME]['1'].growth, 0.7529);
});

test('putting back: into the next free slot when the old one holds a dino now; nothing when the mod put it back already', async () => {
  // Slot 1 holds the dino put back by the test above.
  const file = `${ME}__1__redeemed-${B + 2000}.json`;
  writeFileSync(join(root, 'garage', 'deleted', file), JSON.stringify({ version: 1, slot: '1', classPath: CARNO, growth: 0.5, capturedAt: B + 1900 }));
  const action = { kind: 'put-back', key: 'k', steamId: ME, slot: '1', file, species: CARNO, growth: 0.5, t: B + 2000, why: 'test' };
  const out = await runGuardAction(action);
  assert.equal(out.slot, '2');
  assert.equal(JSON.parse(readFileSync(join(root, 'garage', 'stored', `${ME}__2.json`), 'utf8')).classPath, CARNO);
  const gone = await runGuardAction({ ...action, file: `${ME}__1__redeemed-${B + 2999}.json` });
  assert.deepEqual(gone, { done: null, slot: null }, 'no history file: nothing written');
});

test('undoing a store: only the dino stored, moved to deleted/ (crashundo), the index entry dropped', async () => {
  const undo = (growth) => ({ kind: 'undo-store', key: 'u', steamId: ME, slot: '2', species: CARNO, growth, t: 4000, why: 'test' });
  assert.deepEqual(await runGuardAction(undo(0.6)), { done: null, slot: null }, 'another dino in that slot now: left alone');
  assert.ok(existsSync(join(root, 'garage', 'stored', `${ME}__2.json`)));
  const out = await runGuardAction(undo(0.5));
  assert.equal(out.slot, '2');
  assert.ok(!existsSync(join(root, 'garage', 'stored', `${ME}__2.json`)));
  assert.ok(readdirSync(join(root, 'garage', 'deleted')).some((n) => n.startsWith(`${ME}__2__crashundo-`)));
  const index = JSON.parse(readFileSync(join(root, 'garage', 'storage.json'), 'utf8'));
  assert.equal(index.players[ME]['2'], undefined);
  assert.notEqual(index.players[ME]['1'], undefined, 'the other slot stays');
});

test('kept on disk: `since` from the first start, the settled actions across bridge restarts', async () => {
  const g = await loadGuard(7000);
  assert.equal(g.since, 7000);
  g.resolve('a:redeem:1:7100');
  await saveGuard(g, g.since);
  const again = await loadGuard(9000);
  assert.equal(again.since, 7000, 'not moved by a later start');
  assert.deepEqual(again.resolved, ['a:redeem:1:7100']);
});

test('its two player messages are the bridge\'s: editable on the panel (Gara), never written for the mod', async () => {
  const { modTexts, renderMessage } = await import('../dist/messages.js');
  const texts = modTexts({ texts: { 'garage.guard.putBack': 'x', 'garage.guard.undoStore': 'y', 'garage.stored': 'z' } }).texts;
  assert.deepEqual([texts['garage.guard.putBack'], texts['garage.guard.undoStore'], texts['garage.stored']], [undefined, undefined, 'z']);
  assert.match(renderMessage('garage.guard.putBack', { species: 'Tyrannosaurus', slot: '1' }), /Tyrannosaurus.*slot 1/);
});

test('garage_redeem_start gets past the event reader (an unknown type is dropped before any handler)', async () => {
  const { parseEvent } = await import('../dist/events.js');
  assert.notEqual(parseEvent(start(1791110356)), null);
  assert.equal(parseEvent({ ...start(1791110356), file: 5 }), null, 'a malformed one is dropped');
});
