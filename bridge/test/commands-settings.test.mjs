// PlayerCommands settings: what the panel saves is what the mod reads.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'cmds-test-'));
process.env.PLAYER_COMMANDS_ROOT = root;
const { readCommandsSettings, saveCommandsSettings, COMMANDS_DEFAULTS } = await import('../dist/commands-settings.js');
after(() => rmSync(root, { recursive: true, force: true }));

test('defaults when nothing is saved: slay 5 min, unstuck 10 min, all on', async () => {
  assert.deepEqual(await readCommandsSettings(), COMMANDS_DEFAULTS);
  assert.deepEqual(COMMANDS_DEFAULTS, { slayCooldown: 300, unstuckCooldown: 600, foodCooldown: 30,
    enabled: { slay: true, unstuck: true, prime: true, status: true, food: true } }, 'same as the mod');
});

test('save: validated, partial input merged onto defaults, written for the mod', async () => {
  const saved = await saveCommandsSettings({ slayCooldown: 60, enabled: { status: false } });
  assert.deepEqual(saved, { slayCooldown: 60, unstuckCooldown: 600, foodCooldown: 30,
    enabled: { slay: true, unstuck: true, prime: true, status: false, food: true } });
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')), saved);
  await assert.rejects(() => saveCommandsSettings({ slayCooldown: -1 }), /0–86400/);
  await assert.rejects(() => saveCommandsSettings({ enabled: { slay: 'yes' } }), /true or false/);
  assert.deepEqual(await readCommandsSettings(), saved, 'a rejected save changes nothing');
  writeFileSync(join(root, 'settings.json'), 'nope');
  assert.deepEqual(await readCommandsSettings(), COMMANDS_DEFAULTS, 'broken file = defaults, like the mod');
});
