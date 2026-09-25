// "Drop AI next to a player" (ai-drop.ts): validation, the spots picked
// around the player, the file the AIZones mod polls, its outcome read back.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'ai-drop-test-'));
process.env.DATA_DIR = join(root, 'data');
process.env.AI_ZONES_ROOT = join(root, 'AIZones', 'Saved');
const { validateDrop, dropSpots, queueDrop, dropResult, DROP_MIN_M } = await import('../dist/ai-drop.js');
const { GroundPoints, CELL_CM } = await import('../dist/ground-points.js');
after(() => rmSync(root, { recursive: true, force: true }));

const ok = { steamId: '76561190000000001', species: 'Tyrannosaurus', count: 2, distanceM: 30, growth: 0.8 };

test('validation: a SteamID, a known AI, 1–5 of them, 15–200 m, growth 10–100%', () => {
  assert.deepEqual(validateDrop(ok), ok);
  assert.throws(() => validateDrop({ ...ok, steamId: 'abc' }));
  assert.throws(() => validateDrop({ ...ok, species: 'Dragon' }), /unknown AI/);
  assert.throws(() => validateDrop({ ...ok, count: 6 }), /count/);
  assert.throws(() => validateDrop({ ...ok, distanceM: 5 }), /distanceM/);
  assert.throws(() => validateDrop({ ...ok, growth: 0 }), /growth/);
});

test('spots: ground around the player, nearest to the distance first, none on top of them', () => {
  const g = new GroundPoints();
  g.add(0, 0, 100);                          // where the player stands
  g.add(3000, 0, 100);                       // 30 m
  g.add(0, 5 * CELL_CM, 100);                // 125 m
  g.add(-2 * CELL_CM, 0, 100);               // 50 m
  g.add(100000, 0, 100);                     // 1 km: out
  const spots = dropSpots(g, 0, 0, 30);
  assert.deepEqual(spots.map((p) => Math.hypot(p[0], p[1]) / 100), [30, 50]);
  assert.ok(spots.every((p) => Math.hypot(p[0], p[1]) >= DROP_MIN_M * 100));
  assert.deepEqual(dropSpots(new GroundPoints(), 0, 0, 30), []);
});

test('queue: ids grow, what the mod ran or can no longer run is dropped; the outcome reads back', async () => {
  const g = new GroundPoints();
  g.add(3000, 0, 100);
  const a = await queueDrop(ok, { x: 0, y: 0 }, g, 1000);
  const b = await queueDrop({ ...ok, species: 'Boar' }, { x: 0, y: 0 }, g, 1001);
  assert.deepEqual([a.id, b.id], [1, 2]);
  const file = JSON.parse(readFileSync(join(process.env.AI_ZONES_ROOT, 'drops.json'), 'utf8'));
  assert.equal(file.drops.length, 2);
  assert.equal(file.drops[1].sp.cls, 'BP_Boar_C');
  assert.ok(file.drops[1].sp.pawn && file.drops[1].sp.ctrl && file.drops[1].sp.lift > 0);
  assert.equal(file.drops[0].expiresAt, 1030);
  // The mod ran id 1.
  mkdirSync(process.env.AI_ZONES_ROOT, { recursive: true });
  writeFileSync(join(process.env.AI_ZONES_ROOT, 'drops.done.json'), JSON.stringify({ lastId: 1, results: [{ id: 1, ok: true, made: 2 }] }));
  assert.deepEqual(await dropResult(1), { id: 1, ok: true, made: 2 });
  assert.equal(await dropResult(2), null);
  const c = await queueDrop(ok, { x: 0, y: 0 }, g, 1100);   // id 2 expired meanwhile
  assert.equal(c.id, 3);
  const after = JSON.parse(readFileSync(join(process.env.AI_ZONES_ROOT, 'drops.json'), 'utf8'));
  assert.deepEqual(after.drops.map((d) => d.id), [3]);
  await assert.rejects(queueDrop(ok, { x: 500000, y: 0 }, g, 1100), /no known ground/);
});
