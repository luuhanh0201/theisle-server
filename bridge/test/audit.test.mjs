// The admin log: who (SteamID + name), what changed (old → new), when;
// paged, searchable, 7 days kept (audit.ts).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'audit-test-'));
process.env.DATA_DIR = root;
const { audit, actingAs, readAuditPage, pruneAudit, describeChanges, RETAIN_DAYS } = await import('../dist/audit.js');
after(() => rmSync(root, { recursive: true, force: true }));
const file = join(root, 'admin-audit.ndjson');

test('who: the request\'s admin (SteamID + name), or the one given; a script is ADMIN_TOKEN', async () => {
  await actingAs.run({ steamId: '76561190000000001', name: 'Dã Tượng' }, () => audit({ action: 'game config saved', detail: 'AIDensity: 1 → 0.5', ok: true }));
  await audit({ action: 'panel login', detail: 'từ 1.2.3.4', ok: true }, { steamId: '76561190000000002', name: null });
  await actingAs.run({ steamId: null, name: null }, () => audit({ action: 'garage slot created', ok: true }));
  const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].by, 'Dã Tượng (76561190000000001)');
  assert.equal(lines[0].byId, '76561190000000001');
  assert.equal(lines[0].byName, 'Dã Tượng');
  assert.ok(Number.isInteger(lines[0].t));
  assert.equal(lines[1].by, '? (76561190000000002)');
  assert.equal(lines[2].by, 'ADMIN_TOKEN');
});

test('what changed: old → new, lists as added / removed, nested settings, nothing when equal', () => {
  assert.equal(describeChanges({ AIDensity: 1, bSpawnAI: true }, { AIDensity: 0.5, bSpawnAI: true }), 'AIDensity: 1 → 0.5');
  assert.equal(describeChanges({ AdminsSteamIDs: ['1', '2'] }, { AdminsSteamIDs: ['2', '3'] }), 'AdminsSteamIDs: +3 −1');
  assert.equal(describeChanges({ enabled: { slay: true, prime: true } }, { enabled: { slay: false, prime: true } }), 'enabled { slay: true → false }');
  assert.equal(describeChanges({ Discord: 'a' }, {}), 'Discord: a → (mặc định)');
  assert.equal(describeChanges({ a: 1 }, { a: 1 }), '');
});

test('pages: newest first, a search, and a page past the end is the last one', async () => {
  rmSync(file, { force: true });
  const now = Math.floor(Date.now() / 1000);
  writeFileSync(file, Array.from({ length: 65 }, (_, i) => JSON.stringify({ t: now - 65 + i, action: i % 2 ? 'garage slot created' : 'game config saved', ok: true, by: 'A (1)' })).join('\n') + '\n');
  const p1 = await readAuditPage(1, 30);
  assert.deepEqual([p1.total, p1.pages, p1.page, p1.entries.length, p1.retainDays], [65, 3, 1, 30, RETAIN_DAYS]);
  assert.ok(p1.entries[0].t > p1.entries[29].t, 'newest first');
  const p3 = await readAuditPage(9, 30);
  assert.deepEqual([p3.page, p3.entries.length], [3, 5]);
  const found = await readAuditPage(1, 30, 'GARAGE');
  assert.equal(found.total, 32);
  assert.ok(found.entries.every((e) => e.action === 'garage slot created'));
});

test('kept 7 days: older lines are neither shown nor kept', async () => {
  mkdirSync(root, { recursive: true });
  const now = 2_000_000_000;
  const day = 86_400;
  writeFileSync(file, [now - 8 * day, now - 6 * day, now - day].map((t) => JSON.stringify({ t, action: 'x', ok: true })).join('\n') + '\n');
  assert.equal((await readAuditPage(1, 30, '', now)).total, 2, 'an 8-day-old line is not shown');
  assert.equal(await pruneAudit(now), 1);
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 2, 'and is gone from the file');
  assert.equal(await pruneAudit(now), 0);
});
