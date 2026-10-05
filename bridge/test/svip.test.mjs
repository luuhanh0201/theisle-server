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

const { readSvip, saveSvip, earlyAccess, featureAccess, isSvip, resetSvipCache, closedError } = await import('../dist/svip.js');
const ADMIN = '76561198000000090', OLD = '76561199248426579', NEW = '76561198000000077', PLAYER = '76561198000000055';

test('the bag\'s old list becomes SVip; a feature not set yet is for the admins only', async () => {
  const s = await readSvip();
  assert.deepEqual(s.players.map((p) => p.steamId), [OLD]);
  assert.equal(s.features.bag, 'admin', 'a new install: every feature Chỉ admin (đang phát triển)');
  assert.equal(await earlyAccess('bag', ADMIN), true, 'admin');
  assert.equal(await featureAccess('bag', OLD), 'hidden', 'not even SVip');
  assert.equal(await featureAccess('bag', PLAYER), 'hidden', 'a player sees nothing of it');
});

test('three levels (owner, 2026-10-06): Chỉ admin, SVip, Công khai', async () => {
  const at = async (mode) => {
    await saveSvip({ players: [{ steamId: OLD }], features: { bag: mode } }, null);
    return [await featureAccess('bag', ADMIN), await featureAccess('bag', OLD), await featureAccess('bag', PLAYER)];
  };
  assert.deepEqual(await at('admin'), ['open', 'hidden', 'hidden'], 'Chỉ admin: nobody else sees it');
  assert.deepEqual(await at('testing'), ['open', 'open', 'locked'], 'SVip: SVip use it, others see it locked');
  assert.deepEqual(await at('all'), ['open', 'open', 'open'], 'Công khai: everyone');
  await saveSvip({ players: [{ steamId: OLD }], features: { bag: 'nonsense' } }, null);
  assert.equal((await readSvip()).features.bag, 'admin', 'an unknown level: the admins only');
  // A file of before this change (no "admin" level): its modes are kept as they were.
  writeFileSync(join(process.env.DATA_DIR, 'svip.json'), JSON.stringify({ players: [{ steamId: OLD }], features: { bag: 'testing', shop: 'all' } }));
  resetSvipCache();
  const kept = await readSvip();
  assert.deepEqual([kept.features.bag, kept.features.shop, kept.features.quests], ['testing', 'all', 'admin'], 'set ones kept; a missing one Chỉ admin');
  assert.match(closedError('Cửa hàng', 'hidden'), /đang phát triển, chưa mở/);
  assert.match(closedError('Cửa hàng', 'locked'), /SVip dùng trước/);
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
