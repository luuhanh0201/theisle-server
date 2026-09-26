// Backups, wipe, restore, settings export (backup.ts) on a fake server tree;
// and the daily restart's backup while the game is down (power.ts pause).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'backup-test-'));
process.env.DATA_DIR = join(root, 'bridge', 'data');
const { createDataBackup, exportSettings, listBackups, wipe, restore, prune, backupPath, validateBackupSettings } = await import('../dist/backup.js');
const { Power } = await import('../dist/power.js');
after(() => rmSync(root, { recursive: true, force: true }));

const P = (...p) => join(root, ...p);
const put = (p, s) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, s); };
const roots = {
  playerData: P('Saved', 'PlayerData'), garage: P('Mods', 'DinoGarage', 'Saved'), stats: P('Mods', 'StatsLogger', 'Saved'),
  bridgeData: P('bridge', 'data'), backups: P('backups', 'panel'),
  settings: { 'game/Game.ini': P('Saved', 'Config', 'Game.ini'), 'env/bridge.env': P('bridge', '.env'), 'env/missing.env': P('nope', '.env') },
};
function seed() {
  put(P('Saved', 'PlayerData', 'TheIslePersistence.db'), 'DB');
  put(P('Saved', 'PlayerData', 'TheIslePersistence.db-wal'), 'WAL');
  put(P('Saved', 'PlayerData', 'PlayerBans.json'), '{"bannedPlayerData":[]}');
  put(P('Mods', 'DinoGarage', 'Saved', 'stored', '7656__1.json'), 'slot');
  put(P('Mods', 'DinoGarage', 'Saved', 'garage-settings.json'), '{"keep":true}');
  put(P('Mods', 'DinoGarage', 'Saved', 'storage.json'), '{}');
  put(P('Mods', 'StatsLogger', 'Saved', 'events.ndjson'), 'e\n');
  put(P('bridge', 'data', 'ban-edits.json'), '[]');
  put(P('Saved', 'Config', 'Game.ini'), '[x]\nA=1\n');
  put(P('bridge', '.env'), 'ADMIN_TOKEN=secret\n');
  mkdirSync(roots.backups, { recursive: true });
}

test('a data backup, a wipe (the garage settings kept), a restore', async () => {
  seed();
  const b = await createDataBackup(roots, 'manual');
  assert.match(b.name, /^data-\d{8}-\d{6}-manual\.tar\.gz$/);
  assert.deepEqual((await listBackups(roots)).map((x) => x.kind), ['data']);
  await wipe(roots, ['dinos', 'garage', 'stats', 'bans']);
  assert.ok(!existsSync(P('Saved', 'PlayerData', 'TheIslePersistence.db')));
  assert.ok(!existsSync(P('Saved', 'PlayerData', 'PlayerBans.json')));
  assert.ok(!existsSync(P('bridge', 'data', 'ban-edits.json')), 'the bridge\'s ban edits go with the bans');
  assert.deepEqual(readdirSync(P('Mods', 'DinoGarage', 'Saved', 'stored')), [], 'stored emptied, the folder kept');
  assert.ok(existsSync(P('Mods', 'DinoGarage', 'Saved', 'garage-settings.json')), 'the garage settings kept');
  assert.ok(!existsSync(P('Mods', 'StatsLogger', 'Saved', 'events.ndjson')));
  const r = await restore(roots, backupPath(roots, b.name));
  assert.equal(r.kind, 'data');
  assert.equal(readFileSync(P('Saved', 'PlayerData', 'TheIslePersistence.db-wal'), 'utf8'), 'WAL');
  assert.equal(readFileSync(P('Mods', 'DinoGarage', 'Saved', 'stored', '7656__1.json'), 'utf8'), 'slot');
  assert.equal(readFileSync(P('Mods', 'StatsLogger', 'Saved', 'events.ndjson'), 'utf8'), 'e\n');
});

test('only some parts wiped', async () => {
  seed();
  await wipe(roots, ['stats']);
  assert.ok(existsSync(P('Saved', 'PlayerData', 'TheIslePersistence.db')));
  assert.ok(!existsSync(P('Mods', 'StatsLogger', 'Saved', 'events.ndjson')));
});

test('settings export (secrets included, missing files skipped) and restore', async () => {
  seed();
  const s = await exportSettings(roots);
  assert.deepEqual(s.skipped, ['env/missing.env']);
  writeFileSync(P('bridge', '.env'), 'changed');
  rmSync(P('Saved', 'Config', 'Game.ini'));
  const r = await restore(roots, backupPath(roots, s.name));
  assert.equal(r.kind, 'settings');
  assert.equal(readFileSync(P('bridge', '.env'), 'utf8'), 'ADMIN_TOKEN=secret\n');
  assert.equal(readFileSync(P('Saved', 'Config', 'Game.ini'), 'utf8'), '[x]\nA=1\n');
});

test('names checked, old data backups pruned, a non-backup refused', async () => {
  assert.throws(() => backupPath(roots, '../etc/passwd'), /không có/);
  seed();
  for (let i = 0; i < 3; i++) { await createDataBackup(roots, `t${i}`); await new Promise((r) => setTimeout(r, 1100)); }
  const before = (await listBackups(roots)).filter((b) => b.kind === 'data').length;
  await prune(roots, 2);
  assert.equal((await listBackups(roots)).filter((b) => b.kind === 'data').length, 2);
  assert.ok(before > 2);
  assert.ok((await listBackups(roots)).some((b) => b.kind === 'settings'), 'settings exports are not pruned');
  const junk = P('backups', 'junk.tar.gz');
  const { execFileSync } = await import('node:child_process');
  mkdirSync(P('junkdir'), { recursive: true }); writeFileSync(P('junkdir', 'a.txt'), 'x');
  execFileSync('tar', ['-czf', junk, '-C', P('junkdir'), '.']);
  await assert.rejects(restore(roots, junk), /manifest/);
  assert.throws(() => validateBackupSettings({ atScheduledRestart: true, keep: 0 }), /keep/);
});

test('the daily restart: stop, the backup while down, start', async () => {
  const calls = [];
  const power = new Power({
    service: { state: async () => ({ active: 'active', sub: 'running' }), run: async (v) => { calls.push(v); } },
    rcon: { enabled: false, run: async () => '' },
    modsLoadedAt: () => Math.floor(Date.now() / 1000) + 10,
    sleep: async () => undefined, pollMs: 1,
    pause: { wanted: async (op) => op.source === 'schedule', run: async () => { calls.push('backup'); } },
  });
  power.request('restart', { countdownSeconds: 0, source: 'schedule' });
  for (let i = 0; i < 50 && power.current; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls, ['stop', 'backup', 'start']);
  calls.length = 0;
  power.request('restart', { countdownSeconds: 0, source: 'admin' });
  for (let i = 0; i < 50 && power.current; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls, ['restart'], 'an admin restart is one step, no backup');
});
