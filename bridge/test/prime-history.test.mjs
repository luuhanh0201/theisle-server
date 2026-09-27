// The prime tasks an admin-made dino starts from (prime-history.ts): the
// player's event of that species with the most tasks done, not the last one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'prime-history-test-'));
process.env.DATA_DIR = join(root, 'data');
process.env.EVENTS_PATH = join(root, 'events.ndjson');
after(() => rmSync(root, { recursive: true, force: true }));

const P = '76561198000000051';
const conds = (on) => Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), on.includes(i + 1)]));
const prime = (t, on, species = 'BP_Stegosaurus_C', steamId = P) =>
  ({ type: 'prime', t, steamId, species, growth: 0.5, conditions: conds(on), eligible: on.length >= 5, prime: false });
writeFileSync(process.env.EVENTS_PATH, [
  prime(100, [3, 7, 8]),
  prime(200, [1, 3, 5, 6, 7, 8]),        // the dino they lost
  prime(300, [7, 8]),                    // the fresh one spawned after
  prime(400, [1, 2, 3, 4, 5, 6, 7, 8], 'BP_Tyrannosaurus_C'),
  prime(500, [1, 2, 3, 4, 5, 6, 7, 8, 9], 'BP_Stegosaurus_C', '76561198000000099'),
].map((e) => JSON.stringify(e)).join('\n') + '\n');

const { lastPrimeOf } = await import('../dist/prime-history.js');

test('the most tasks of that player and species, not the fresh dino spawned after', async () => {
  const best = await lastPrimeOf(P, 'X.BP_Stegosaurus_C');
  assert.equal(best.code, '1010111100');
  assert.equal(best.t, 200);
  assert.equal(await lastPrimeOf(P, 'BP_Carnotaurus_C'), null);
});
