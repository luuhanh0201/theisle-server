// AI zones: the panel's settings, the file the AIZones mod reads, the ground
// points it spawns on (ai-zones.ts, ground-points.ts, ai-species.ts).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'ai-zones-test-'));
process.env.DATA_DIR = join(root, 'data');
process.env.AI_ZONES_ROOT = join(root, 'AIZones', 'Saved');
const { validateAiZones, saveAiZones, readAiZones, readAiZonesStatus, modFile } = await import('../dist/ai-zones.js');
const { GroundPoints, CELL_CM } = await import('../dist/ground-points.js');
const { AI_SPECIES, AI_BY_KEY } = await import('../dist/ai-species.js');
after(() => rmSync(root, { recursive: true, force: true }));

const zone = (over = {}) => ({
  name: 'Đồng cỏ', x: 100000, y: 200000, radiusM: 300, species: ['Boar', 'Deer'],
  max: 10, min: 3, perTurnMin: 1, perTurnMax: 3, everySec: 60, growthMin: 1, growthMax: 1, ...over,
});

test('species: every pair has a pawn and a controller class, keys unique', () => {
  assert.equal(new Set(AI_SPECIES.map((s) => s.key)).size, AI_SPECIES.length);
  for (const s of AI_SPECIES) {
    assert.match(s.pawn, /^\/Game\/.+\.BP_\w+_C$/, s.key);
    assert.match(s.ctrl, /^\/(Script\/TheIsle\.TIAI\w+|Game\/.+_Controller_C)$/, s.key);
    assert.equal(s.pawn.split('.').pop(), s.cls, `${s.key}: cls is the pawn's short class`);
  }
  assert.ok(!AI_BY_KEY.has('Kentrosaurus'), 'not re-verified since 0.21.720: left out');
});

test('ground points: one per 25 m cell, fliers and swimmers left out, a circle query', () => {
  const g = new GroundPoints();
  g.add(100000, 200000, 5000, 'BP_Carnotaurus_C');
  g.add(100000 + CELL_CM / 2, 200000, 5100, 'BP_Carnotaurus_C');   // same cell: replaces
  g.add(100000 + CELL_CM * 2, 200000, 5000, 'BP_Boar_C');
  g.add(100000, 200000 + CELL_CM * 3, 90000, 'BP_Pteranodon_C');    // in the air
  g.add(100000, 200000 + CELL_CM * 4, 0, 'BP_Deinosuchus_C');       // in water
  g.add(900000, 900000, 5000, 'BP_Boar_C');                         // far away
  assert.equal(g.size, 3);
  const inside = g.within(100000, 200000, 300 * 100);
  assert.equal(inside.length, 2);
  assert.ok(inside.every((p) => p[2] < 10000));
  const many = new GroundPoints();
  for (let i = 0; i < 1000; i++) many.add(i * CELL_CM, 0, 0);
  const spread = many.within(500 * CELL_CM, 0, 1000 * CELL_CM, 50);
  assert.equal(spread.length, 50);
  assert.ok(spread[49][0] - spread[0][0] > 800 * CELL_CM, 'spread over the area, not the first 50');
});

test('validation: names, known species, min under max, a per-turn range 1–5, growth order', () => {
  const ok = validateAiZones({ enabled: true, globalMax: 150, zones: [zone()] });
  assert.equal(ok.zones.length, 1);
  assert.match(ok.zones[0].id, /^[a-z0-9]{1,16}$/, 'a zone without an id gets one');
  assert.throws(() => validateAiZones({ enabled: true, globalMax: 150, zones: [zone({ name: '' })] }), /name/);
  assert.throws(() => validateAiZones({ enabled: true, globalMax: 150, zones: [zone({ species: ['Dragon'] })] }), /unknown AI/);
  assert.throws(() => validateAiZones({ enabled: true, globalMax: 150, zones: [zone({ min: 20 })] }), /minimum/);
  assert.throws(() => validateAiZones({ enabled: true, globalMax: 150, zones: [zone({ growthMin: 0.9, growthMax: 0.5 })] }), /growthMin/);
  assert.throws(() => validateAiZones({ enabled: true, globalMax: 150, zones: [zone({ perTurnMax: 6 })] }), /perTurnMax/);
  assert.throws(() => validateAiZones({ enabled: true, globalMax: 150, zones: [zone({ perTurnMin: 0 })] }), /perTurnMin/);
  assert.throws(() => validateAiZones({ enabled: true, globalMax: 150, zones: [zone({ perTurnMin: 4, perTurnMax: 2 })] }), /perTurnMin is above/);
  assert.throws(() => validateAiZones({ enabled: true, globalMax: 150, zones: [zone({ spacingM: 500 })] }), /spacingM/);
  assert.throws(() => validateAiZones({ enabled: 'yes', globalMax: 150, zones: [] }), /enabled/);
  assert.throws(() => validateAiZones({ enabled: true, globalMax: -1, zones: [] }), /globalMax/);
});

test('a file saved before the rename: idleMax is the min, perTurn both ends of the range', () => {
  const { min: _m, perTurnMin: _a, perTurnMax: _b, ...rest } = zone();
  const z = validateAiZones({ enabled: true, globalMax: 150, zones: [{ ...rest, idleMax: 2, perTurn: 4 }] }).zones[0];
  assert.deepEqual([z.min, z.perTurnMin, z.perTurnMax], [2, 4, 4]);
  assert.equal(z.spacingM, 40, 'no spacing saved: 40 m');
  assert.ok(!('idleMax' in z) && !('perTurn' in z), 'saved under the new names only');
});

test('save: the panel\'s file and the mod\'s file (classes, radius in cm, the zone\'s points)', async () => {
  const g = new GroundPoints();
  g.add(100000, 200000, 5000, 'BP_Boar_C');
  g.add(100500, 203000, 5200, 'BP_Deer_C');
  const saved = await saveAiZones({ enabled: true, globalMax: 120, zones: [zone({ id: 'meadow' })] }, g);
  assert.deepEqual((await readAiZones()).zones[0], saved.zones[0]);
  const mod = JSON.parse(readFileSync(join(process.env.AI_ZONES_ROOT, 'zones.json'), 'utf8'));
  assert.equal(mod.enabled, true);
  assert.equal(mod.globalMax, 120);
  const z = mod.zones[0];
  assert.equal(z.radius, 30000);
  assert.deepEqual([z.min, z.max, z.perTurnMin, z.perTurnMax], [3, 10, 1, 3]);
  assert.equal(z.spacing, 4000, 'spacing in cm');
  assert.equal(z.every, 60);
  assert.deepEqual(z.species.map((s) => s.cls), ['BP_Boar_C', 'BP_Deer_C']);
  assert.ok(z.species.every((s) => s.pawn && s.ctrl && s.lift > 0));
  assert.equal(z.points.length, 2);
  assert.deepEqual(modFile({ enabled: false, globalMax: 0, zones: [] }, g), { enabled: false, globalMax: 0, zones: [] });
});

test('status from the mod: read back, stale after a minute, null when none', async () => {
  assert.equal(await readAiZonesStatus(), null);
  mkdirSync(process.env.AI_ZONES_ROOT, { recursive: true });
  writeFileSync(join(process.env.AI_ZONES_ROOT, 'status.json'),
    JSON.stringify({ t: 1000, enabled: true, total: 42, cap: 120, zones: { meadow: { occupied: false, count: 3, limit: 3, spawned: 3 } } }));
  const fresh = await readAiZonesStatus(1030);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.total, 42);
  assert.equal(fresh.zones.meadow.limit, 3);
  assert.equal((await readAiZonesStatus(2000)).stale, true);
});
