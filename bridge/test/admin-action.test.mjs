// The game's /adminpanel actions from the panel: checked, then queued to the
// DinoGarage inbox (commands.ts; the mod side is tests/test_admin.lua). npm test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'admin-action-'));
process.env.GARAGE_ROOT = root;
const { validateAdminAction, queueAdminAction } = await import('../dist/commands.js');
after(() => rmSync(root, { recursive: true, force: true }));
const P = '76561198000000041';

test('what an admin may send', () => {
  assert.deepEqual(validateAdminAction({ action: 'heal', extra: 1 }), { action: 'heal' });
  assert.deepEqual(validateAdminAction({ action: 'vitals', values: { health: 0.5, carb: 1 } }), { action: 'vitals', values: { health: 0.5, carb: 1 } });
  assert.throws(() => validateAdminAction({ action: 'vitals', values: { health: 1.5 } }), /0–1/);
  assert.throws(() => validateAdminAction({ action: 'vitals', values: { mana: 1 } }), /unknown vital/);
  assert.throws(() => validateAdminAction({ action: 'vitals', values: {} }), /at least one/);
  assert.deepEqual(validateAdminAction({ action: 'grow', growth: 0.755555 }), { action: 'grow', growth: 0.7556 });
  assert.throws(() => validateAdminAction({ action: 'grow', growth: 0.05 }), /0.1–1/);
  assert.deepEqual(validateAdminAction({ action: 'grow', growth: 1, prime: true }), { action: 'grow', growth: 1, prime: true });
  assert.deepEqual(validateAdminAction({ action: 'grow', growth: 1, prime: false }), { action: 'grow', growth: 1 }, 'prime off: as before');
  assert.throws(() => validateAdminAction({ action: 'grow', growth: 0.9, prime: true }), /100%/, 'prime: a grown dino only');
  assert.deepEqual(validateAdminAction({ action: 'teleport', x: 1.4, y: -2, z: 300 }), { action: 'teleport', x: 1, y: -2, z: 300 });
  assert.throws(() => validateAdminAction({ action: 'teleport', x: 1, y: 2 }), /x, y, z/);
  assert.throws(() => validateAdminAction({ action: 'fly' }), /heal, vitals, grow, teleport, mutslots or probe/);
  assert.deepEqual(validateAdminAction({ action: 'mutslots', slots: { MutationSlot1: 'Hydrodynamic', ElderMutationSlot1A: null } }),
    { action: 'mutslots', slots: { MutationSlot1: 'Hydrodynamic', ElderMutationSlot1A: null } });
  assert.throws(() => validateAdminAction({ action: 'mutslots', slots: { Slot9: 'X' } }), /unknown slot/);
  assert.throws(() => validateAdminAction({ action: 'mutslots', slots: { MutationSlot1: '../x' } }), /mutation name/);
});

test('queued to the inbox as an "admin" command for that player', async () => {
  const cmd = await queueAdminAction(P, { action: 'grow', growth: 0.8 });
  const inbox = JSON.parse(readFileSync(join(root, 'inbox.json'), 'utf8'));
  const saved = inbox.commands.find((c) => c.id === cmd.id);
  assert.deepEqual([saved.type, saved.steamId, saved.action, saved.growth], ['admin', P, 'grow', 0.8]);
  assert.ok(saved.expiresAt > saved.createdAt);
  await assert.rejects(queueAdminAction('nope', { action: 'heal' }));
});
