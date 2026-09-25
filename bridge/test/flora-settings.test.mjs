// Flora control settings (flora-settings.ts): off by default, limits, the mod's file.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'flora-test-'));
process.env.DATA_DIR = join(root, 'data');
process.env.FLORA_ROOT = join(root, 'Flora', 'Saved');
const { readFloraSettings, saveFloraSettings, FLORA_DEFAULTS } = await import('../dist/flora-settings.js');
after(() => rmSync(root, { recursive: true, force: true }));

test('off until turned on; saved where the mod reads; limits', async () => {
  assert.equal((await readFloraSettings()).control, false);
  const s = await saveFloraSettings({ ...FLORA_DEFAULTS, control: true, migrationNutrientPct: 25, massMultiplier: 5 });
  assert.deepEqual(JSON.parse(readFileSync(join(process.env.FLORA_ROOT, 'settings.json'), 'utf8')), s);
  assert.equal(s.migrationNutrientPct, 25);
  await assert.rejects(saveFloraSettings({ migrationNutrientPct: 101 }), /migrationNutrientPct/);
  await assert.rejects(saveFloraSettings({ massMultiplier: 0 }), /massMultiplier/);
  await assert.rejects(saveFloraSettings({ control: 'on' }), /control/);
});
