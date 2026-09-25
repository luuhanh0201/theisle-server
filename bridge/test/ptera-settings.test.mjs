// PteraCarry settings (ptera-settings.ts): limits, defaults, the mod's file.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'ptera-test-'));
process.env.DATA_DIR = join(root, 'data');
process.env.PTERA_ROOT = join(root, 'PteraCarry', 'Saved');
const { readPteraSettings, savePteraSettings, PTERA_DEFAULTS } = await import('../dist/ptera-settings.js');
after(() => rmSync(root, { recursive: true, force: true }));

test('defaults: off until an admin turns it on', async () => {
  assert.deepEqual(await readPteraSettings(), PTERA_DEFAULTS);
  assert.equal(PTERA_DEFAULTS.enabled, false);
});

test('save: whole numbers in range, written where the mod reads (its Saved/ created)', async () => {
  const s = await savePteraSettings({ enabled: true, maxKg: 200, maxSeconds: 30, cooldown: 10, hintMeters: 0 });
  assert.deepEqual(s, { enabled: true, maxKg: 200, maxSeconds: 30, cooldown: 10, hintMeters: 0 });
  assert.deepEqual(JSON.parse(readFileSync(join(process.env.PTERA_ROOT, 'settings.json'), 'utf8')), s);
  await assert.rejects(savePteraSettings({ maxKg: 0 }), /maxKg/);
  await assert.rejects(savePteraSettings({ maxSeconds: 500 }), /maxSeconds/);
  await assert.rejects(savePteraSettings({ enabled: 'yes' }), /enabled/);
});
