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
  await assert.rejects(saveFloraSettings({ migrationMaxPerArea: 0 }), /migrationMaxPerArea/);
  assert.equal((await saveFloraSettings({ outsideMaxPerArea: 0 })).outsideMaxPerArea, 0, 'no plants at all outside is allowed');
});

test('the map\'s "Tải lại thực vật": a request file for the mod, not twice in 30 s, plantsT passed on', async () => {
  const { requestFloraRefresh, readFlora, REFRESH_GAP_S } = await import('../dist/flora.js');
  const { permissionFor } = await import('../dist/permissions.js');
  const { mkdirSync, writeFileSync, existsSync } = await import('node:fs');
  mkdirSync(process.env.FLORA_ROOT, { recursive: true });
  writeFileSync(join(process.env.FLORA_ROOT, 'flora.json'), JSON.stringify({ t: 1000, plantsT: 900, spawners: [], plants: [], fruits: [] }));
  assert.equal((await readFlora(1000)).plantsT, 900);
  const req = join(process.env.FLORA_ROOT, 'refresh.request');
  assert.deepEqual(await requestFloraRefresh(910), { ok: false, retryIn: REFRESH_GAP_S - 10 }, 'the plants were read 10 s ago');
  assert.equal(existsSync(req), false);
  assert.deepEqual(await requestFloraRefresh(1000), { ok: true, plantsT: 900 });
  assert.equal(readFileSync(req, 'utf8'), '1000');
  assert.equal((await requestFloraRefresh(1005)).ok, false, 'asked 5 s ago');
  assert.equal(permissionFor('POST', '/api/map/flora/refresh'), 'map.view');
});
