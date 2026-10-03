// SVip (svip.ts): players who try the features being tested, besides the admins.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'svip-test-'));
process.env.DATA_DIR = join(root, 'data');
process.env.GARAGE_ROOT = join(root, 'garage');
process.env.ADMIN_STEAM_IDS = '76561198000000090';
mkdirSync(process.env.DATA_DIR, { recursive: true });
after(() => rmSync(root, { recursive: true, force: true }));
// The bag's own list before SVip: taken over.
writeFileSync(join(process.env.DATA_DIR, 'bag-access.json'), JSON.stringify({ players: ['76561199248426579'] }));

const { readSvip, saveSvip, earlyAccess, isSvip, resetSvipCache } = await import('../dist/svip.js');
const ADMIN = '76561198000000090', OLD = '76561199248426579', NEW = '76561198000000077', PLAYER = '76561198000000055';

test('the bag\'s old list becomes SVip; the bag is for admins + SVip while it is being tried', async () => {
  const s = await readSvip();
  assert.deepEqual(s.players.map((p) => p.steamId), [OLD]);
  assert.equal(s.features.bag, 'testing');
  assert.equal(await earlyAccess('bag', OLD), true, 'SVip');
  assert.equal(await earlyAccess('bag', ADMIN), true, 'admin');
  assert.equal(await earlyAccess('bag', PLAYER), false, 'a player');
});

test('saving: a new SVip gets its time and who added it, the old keep theirs; "all" opens the feature to everyone', async () => {
  const first = await readSvip();
  const saved = await saveSvip({ players: [{ steamId: OLD, note: 'boss' }, { steamId: NEW, note: 'tester' }], features: { bag: 'testing' } }, 'Dã Tượng', 2_000_000_000_000);
  assert.equal(saved.players[0].addedAt, first.players[0].addedAt, 'kept');
  assert.equal(saved.players[0].note, 'boss');
  assert.deepEqual([saved.players[1].addedAt, saved.players[1].by], [2_000_000_000, 'Dã Tượng']);
  resetSvipCache();
  assert.equal(await isSvip(NEW), true, 'read back from the file');
  await saveSvip({ players: [], features: { bag: 'all' } }, 'Dã Tượng');
  assert.equal(await earlyAccess('bag', PLAYER), true, 'open to all');
  assert.equal(await isSvip(OLD), false, 'removed');
});

test('a bad SteamID is refused, nothing saved', async () => {
  await assert.rejects(() => saveSvip({ players: [{ steamId: '123' }], features: {} }, null), /SteamID/);
  await assert.rejects(() => saveSvip({ players: 'x', features: {} }, null), /players/);
});
