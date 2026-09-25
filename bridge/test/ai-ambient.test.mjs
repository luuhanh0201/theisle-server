// The game's own AI on/off (ai-ambient.ts): read from ServerDetails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { parseSpawnAi } = await import('../dist/ai-ambient.js');

test('bSpawnAI from a real ServerDetails reply', () => {
  const reply = '[2026.09.26-02.01.07] ServerDetailsServerName: X, ServerMap: Gateway, bEnableHumans: false, bSpawnAI: true, bAllowRecordingReplay: true';
  assert.equal(parseSpawnAi(reply), true);
  assert.equal(parseSpawnAi(reply.replace('bSpawnAI: true', 'bSpawnAI: false')), false);
  assert.equal(parseSpawnAi('no such field'), null);
});
