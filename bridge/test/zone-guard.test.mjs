// Small dinos only (zone-guard.ts): validation, the map's sanctuaries in game
// units, and the file the ZoneGuard mod reads (AI zones marked + sanctuaries ticked).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'zone-guard-test-'));
process.env.DATA_DIR = join(root, 'data');
process.env.AI_ZONES_ROOT = join(root, 'AIZones', 'Saved');
process.env.ZONE_GUARD_ROOT = join(root, 'ZoneGuard', 'Saved');
const { validateZoneGuard, sanctuariesOf, readSanctuaries, modFile, saveZoneGuard, readZoneGuard, ZONE_GUARD_DEFAULTS } = await import('../dist/zone-guard.js');
const { validateAiZones, saveAiZones } = await import('../dist/ai-zones.js');
const { GroundPoints } = await import('../dist/ground-points.js');
after(() => rmSync(root, { recursive: true, force: true }));

const ok = (over = {}) => ({ enabled: true, graceSec: 30, everySec: 5, pct: 5, defaultMax: 0.5, maxBySpecies: { Carnotaurus: 0.3 }, sanctuaries: [], ...over });

test('validation: ranges, species limits as growth, known sanctuaries only', () => {
  const s = validateZoneGuard(ok({ maxBySpecies: { Carnotaurus: 0.333 } }));
  assert.equal(s.maxBySpecies.Carnotaurus, 0.33);
  assert.throws(() => validateZoneGuard(ok({ pct: 0 })), /pct/);
  assert.throws(() => validateZoneGuard(ok({ everySec: 61 })), /everySec/);
  assert.throws(() => validateZoneGuard(ok({ graceSec: 1.5 })), /graceSec/);
  assert.throws(() => validateZoneGuard(ok({ defaultMax: 1.2 })), /defaultMax/);
  assert.throws(() => validateZoneGuard(ok({ maxBySpecies: { 'Rex!': 0.3 } })), /not a species/);
  assert.throws(() => validateZoneGuard(ok({ sanctuaries: ['Nope'] }), new Set(['Sanctuary 67'])), /unknown sanctuary/);
  assert.deepEqual(validateZoneGuard(ok({ sanctuaries: ['Sanctuary 67', 'Sanctuary 67'] }), new Set(['Sanctuary 67'])).sanctuaries, ['Sanctuary 67']);
  assert.throws(() => validateZoneGuard({}), /enabled/);
});

test('sanctuaries: the map\'s shapes in game units ([game Y, game X] / 1000 on the map)', () => {
  const map = { features: [
    { layer: 'sanctuary', kind: 'poly', name: 'Sanctuary 1', pts: [[[1, 2], [3, 2], [3, 4]]] },
    { layer: 'sanctuary', kind: 'circle', name: 'Sanctuary 2', at: [10, 20], r: [0.1, 0.1], rot: 0 },
    { layer: 'water', kind: 'poly', name: 'Lake', pts: [[[1, 2], [3, 2], [3, 4]]] },
  ] };
  const s = sanctuariesOf(map);
  assert.deepEqual(s.map((c) => c.name), ['Sanctuary 1', 'Sanctuary 2']);
  assert.deepEqual(s[0].poly, [[2000, 1000], [2000, 3000], [4000, 3000]]);
  const circle = s[1];
  assert.equal(circle.poly.length, 24);
  assert.ok(circle.poly.every(([x, y]) => Math.abs(Math.hypot(x - 20000, y - 10000) - 100) <= 1), 'a 100 cm circle round (20000, 10000)');
});

test('the map shipped with the panel has its sanctuaries', async () => {
  const s = await readSanctuaries();
  assert.ok(s.length >= 5, `found ${s.length}`);
  assert.ok(s.every((c) => c.poly.length >= 3 && Math.abs(c.x) < 1_000_000));
});

test('the mod\'s file: AI zones marked small-only and the sanctuaries ticked, nothing else', () => {
  const zone = (over) => ({ name: 'A', x: 0, y: 0, radiusM: 100, species: ['Boar'], max: 1, min: 0, perTurnMin: 1, perTurnMax: 1, everySec: 60, growthMin: 1, growthMax: 1, ...over });
  const zones = validateAiZones({ enabled: true, globalMax: 10, zones: [zone({ name: 'Nhỏ', smallOnly: true }), zone({ name: 'Thường' })] });
  const sanct = [{ name: 'Sanctuary 1', x: 1000, y: 1000, poly: [[0, 0], [2000, 0], [2000, 2000], [0, 2000]] }, { name: 'Sanctuary 2', x: 0, y: 0, poly: [[0, 0], [1, 0], [0, 1]] }];
  const f = modFile(validateZoneGuard(ok({ sanctuaries: ['Sanctuary 1'] })), zones, sanct);
  assert.deepEqual(f.zones.map((z) => z.name), ['Nhỏ', 'Sanctuary 1']);
  assert.equal(f.zones[0].radius, 10000);
  assert.equal(f.zones[1].radius, 1415, 'its bounding circle');
  assert.deepEqual({ ...f, zones: undefined }, { enabled: true, grace: 30, every: 5, pct: 5, defaultMax: 0.5, max: { Carnotaurus: 0.3 }, zones: undefined });
});

test('save: kept for the panel, the mod file rewritten (with the AI zones as saved)', async () => {
  assert.deepEqual(await readZoneGuard(), ZONE_GUARD_DEFAULTS);
  await saveAiZones({ enabled: true, globalMax: 10, zones: [{ name: 'Nhỏ', x: 0, y: 0, radiusM: 100, species: ['Boar'], max: 1, min: 0, perTurnMin: 1, perTurnMax: 1, everySec: 60, growthMin: 1, growthMax: 1, smallOnly: true }] }, new GroundPoints());
  const names = (await readSanctuaries()).map((c) => c.name);
  await saveZoneGuard(ok({ sanctuaries: [names[0]] }));
  assert.equal((await readZoneGuard()).sanctuaries[0], names[0]);
  const mod = JSON.parse(readFileSync(join(root, 'ZoneGuard', 'Saved', 'guard.json'), 'utf8'));
  assert.deepEqual(mod.zones.map((z) => z.name), ['Nhỏ', names[0]]);
  await assert.rejects(saveZoneGuard(ok({ sanctuaries: ['Nope'] })), /unknown sanctuary/);
});
