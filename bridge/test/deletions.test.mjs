// The super admin deletes chat lines (kept hidden: the chat is read again from the game's
// events at every start) and admin log lines (taken out of the file, a copy kept first).
// Nothing is written to the admin log. deletions.ts; the routes are the super admin's only. npm test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'deletions-'));
process.env.DATA_DIR = join(root, 'data');
mkdirSync(process.env.DATA_DIR, { recursive: true });
const D = await import('../dist/deletions.js');
const { permissionFor } = await import('../dist/permissions.js');
after(() => rmSync(root, { recursive: true, force: true }));

test('chat: deleted lines stay hidden, also after a restart', async () => {
  const a = { type: 'chat', t: 100, steamId: '76561198000000001', message: 'hello' };
  const b = { type: 'chat', t: 101, steamId: '76561198000000001', message: 'bad word' };
  await D.hiddenChat();
  assert.equal(D.isHiddenChat(b), false);
  assert.equal(await D.hideChat([D.chatKey(b), 'not-a-key']), 1);
  assert.equal(D.isHiddenChat(b), true);
  assert.equal(D.isHiddenChat(a), false);
  assert.equal(D.isHiddenChat({ ...b, type: 'death' }), false, 'only chat lines');
  D.resetHiddenChat();
  await D.hiddenChat();
  assert.equal(D.isHiddenChat(b), true, 'read back from the file (a bridge restart)');
  assert.equal(D.chatKey(b), D.chatKey({ ...b }), 'the same line, the same key');
});

test('admin log: lines taken out by key, a copy kept, nothing else touched', async () => {
  const file = join(process.env.DATA_DIR, 'admin-audit.ndjson');
  const l1 = { t: 200, action: 'panel login', ok: true, byId: '76561199320940985', detail: 'từ 1.2.3.4' };
  const l2 = { t: 201, action: 'skin applied', ok: true, byId: '76561199320940985', detail: 'tọoc' };
  const l3 = { t: 202, action: 'item granted', ok: true, byId: null, detail: 'x' };
  writeFileSync(file, [l1, l2, l3].map((l) => JSON.stringify(l)).join('\n') + '\n');
  assert.equal(await D.deleteAuditLines([D.auditKey(l2), D.auditKey(l3), 'a1-zzz']), 2);
  const left = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(left.map((l) => l.action), ['panel login']);
  const copies = readdirSync(process.env.DATA_DIR).filter((n) => n.startsWith('admin-audit.ndjson.bak-del-'));
  assert.equal(copies.length, 1, 'a copy before');
  assert.equal(readFileSync(join(process.env.DATA_DIR, copies[0]), 'utf8').trim().split('\n').length, 3);
  assert.equal(await D.deleteAuditLines([D.auditKey(l2)]), 0, 'gone already');
  assert.equal(left.length, 1);
});

test('only the super admin may call the delete routes', () => {
  assert.equal(permissionFor('POST', '/api/chat/delete'), '*');
  assert.equal(permissionFor('POST', '/api/server/audit/delete'), '*');
});
