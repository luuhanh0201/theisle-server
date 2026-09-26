// Prime progress given back (prime-fixes.ts): validation, the file the
// DinoGarage mod reads (primefix.lua), and "applied" read back from the mod's file.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'prime-fixes-test-'));
process.env.DATA_DIR = join(root, 'data');
process.env.GARAGE_ROOT = join(root, 'DinoGarage', 'Saved');
const { addPrimeFix, listPrimeFixes } = await import('../dist/prime-fixes.js');
after(() => rmSync(root, { recursive: true, force: true }));

const trike = { steamId: '76561198658379556', species: 'BP_Triceratops_C', minGrowth: 0.55, maxGrowth: 0.65, conditions: '1010101100', eligible: true };

test('a fix: the conditions as the mod reads them, a week to be applied', async () => {
  const fix = await addPrimeFix(trike, 1000);
  assert.deepEqual(fix.primeData, { cond1: true, cond2: false, cond3: true, cond4: false, cond5: true, cond6: false,
    cond7: true, cond8: true, cond9: false, cond10: false, eligible: true });
  assert.equal(fix.prime, false);
  assert.equal(fix.expiresAt, 1000 + 7 * 86400);
  const onDisk = JSON.parse(readFileSync(join(root, 'DinoGarage', 'Saved', 'prime-fixes.json'), 'utf8'));
  assert.equal(onDisk.fixes.length, 1);
  assert.equal(onDisk.fixes[0].id, fix.id);
});

test('prime only; ids stay unique; applied read back from the mod', async () => {
  const p = await addPrimeFix({ steamId: '76561198859683351', species: 'BP_Pachycephalosaurus_C', minGrowth: 0.75, maxGrowth: 0.85, prime: true }, 1000);
  const all = await listPrimeFixes();
  assert.equal(new Set(all.map((f) => f.id)).size, 2);
  writeFileSync(join(root, 'DinoGarage', 'Saved', 'prime-fixes.done.json'), JSON.stringify({ done: { [p.id]: 1234 } }));
  const again = await listPrimeFixes();
  assert.equal(again.find((f) => f.id === p.id).doneAt, 1234);
  assert.equal(again.find((f) => f.id !== p.id).doneAt, null);
});

test('refused: bad ids, species, growth, conditions, nothing to give', async () => {
  await assert.rejects(() => addPrimeFix({ ...trike, steamId: '123' }), /SteamID64/);
  await assert.rejects(() => addPrimeFix({ ...trike, species: 'Triceratops' }), /class name/);
  await assert.rejects(() => addPrimeFix({ ...trike, minGrowth: 0.7, maxGrowth: 0.6 }), /growth range/);
  await assert.rejects(() => addPrimeFix({ ...trike, conditions: '10101' }), /ten 0\/1/);
  await assert.rejects(() => addPrimeFix({ ...trike, conditions: null }), /nothing to give back/);
  await assert.rejects(() => addPrimeFix({ ...trike, days: 90 }), /1–30/);
});

test('primeAt, and replacing a fix not applied yet (an applied one is kept)', async () => {
  const f = await addPrimeFix({ ...trike, maxGrowth: 0.74 }, 2000);
  const up = await addPrimeFix({ ...trike, id: f.id, maxGrowth: 1, primeAt: 0.75 }, 3000);
  assert.equal(up.id, f.id);
  assert.equal(up.createdAt, 2000);
  assert.equal(up.maxGrowth, 1);
  assert.equal(up.primeAt, 0.75);
  const all = await listPrimeFixes();
  assert.equal(all.filter((x) => x.id === f.id).length, 1, 'replaced, not added');
  await assert.rejects(() => addPrimeFix({ ...trike, id: 'nope' }), /no fix/);
  await assert.rejects(() => addPrimeFix({ ...trike, primeAt: 2 }), /primeAt/);
  const done = JSON.parse(readFileSync(join(root, 'DinoGarage', 'Saved', 'prime-fixes.done.json'), 'utf8'));
  done.done[f.id] = 9;
  writeFileSync(join(root, 'DinoGarage', 'Saved', 'prime-fixes.done.json'), JSON.stringify(done));
  await assert.rejects(() => addPrimeFix({ ...trike, id: f.id }), /already applied/);
});
