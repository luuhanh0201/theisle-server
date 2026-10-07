// Tin cập nhật (news.ts): the panel's list checked and saved, what players get, the audit line, the permission.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'news-'));
process.env.DATA_DIR = root;
process.env.GARAGE_ROOT = root;
process.env.PORTAL_TOKEN = 'portal-secret-token';
after(() => rmSync(root, { recursive: true, force: true }));

const { validateNews, saveNews, readNews, newsForPlayers, describeNewsChanges, NEWS_LIMITS, NEWS_FOR_PLAYERS } = await import('../dist/news.js');
const { handlePlayerApi } = await import('../dist/player-api.js');
const { Store } = await import('../dist/store.js');
const { permissionFor } = await import('../dist/permissions.js');

test('a new note gets an id and the date; an edited one keeps both; the text is trimmed, line breaks kept', () => {
  const first = validateNews({ items: [{ title: '  Bản 1.0  ', body: 'Dòng 1\r\nDòng 2 ' }] }, { items: [] }, 1000);
  assert.equal(first.items.length, 1);
  const [n] = first.items;
  assert.match(n.id, /^n_[0-9a-f]{8}$/);
  assert.deepEqual({ title: n.title, body: n.body, at: n.at, shown: n.shown }, { title: 'Bản 1.0', body: 'Dòng 1\nDòng 2', at: 1000, shown: true });
  const edited = validateNews({ items: [{ id: n.id, title: 'Bản 1.0 (sửa)', body: 'x', shown: false }, { title: 'Bản 1.1' }] }, first, 2000);
  assert.equal(edited.items[0].id, n.id);
  assert.equal(edited.items[0].at, 1000, 'an edit keeps the first date');
  assert.equal(edited.items[0].shown, false);
  assert.equal(edited.items[1].at, 2000);
  assert.notEqual(edited.items[1].id, n.id);
  // An id the panel made up (or sent twice) is not trusted: a new one.
  const twice = validateNews({ items: [{ id: n.id, title: 'a' }, { id: n.id, title: 'b' }, { id: 'n_forged', title: 'c' }] }, first, 3000);
  assert.equal(new Set(twice.items.map((x) => x.id)).size, 3);
  assert.equal(twice.items[2].at, 3000);
});

test('refused: no list, no title, too long, too many', () => {
  assert.throws(() => validateNews({}, { items: [] }), /items must be a list/);
  assert.throws(() => validateNews({ items: [{ title: '   ' }] }, { items: [] }), /title is required/);
  assert.throws(() => validateNews({ items: [{ title: 'x'.repeat(NEWS_LIMITS.title + 1) }] }, { items: [] }), /too long/);
  assert.throws(() => validateNews({ items: [{ title: 'a', body: 'x'.repeat(NEWS_LIMITS.body + 1) }] }, { items: [] }), /too long/);
  assert.throws(() => validateNews({ items: Array.from({ length: NEWS_LIMITS.items + 1 }, () => ({ title: 'a' })) }, { items: [] }), /at most/);
  assert.throws(() => validateNews({ items: [{ title: 5 }] }, { items: [] }), /must be text/);
});

test('saved and read back; the audit line says what changed', async () => {
  assert.deepEqual(await readNews(), { items: [] }, 'nothing yet');
  const a = await saveNews({ items: [{ title: 'Bản 1.0', body: 'a' }] });
  assert.deepEqual(await readNews(), a);
  const b = await saveNews({ items: [{ ...a.items[0], body: 'b', shown: false }, { title: 'Bản 1.1' }] });
  assert.equal(describeNewsChanges(a, b), 'sửa "Bản 1.0" (ẩn) · thêm "Bản 1.1"');
  assert.equal(describeNewsChanges(b, { items: [b.items[1]] }), 'xoá "Bản 1.0"');
  assert.equal(describeNewsChanges(b, b), '');
});

test('players get the newest shown notes, only id, title, text and date', async () => {
  const items = Array.from({ length: NEWS_FOR_PLAYERS + 3 }, (_, i) => ({ id: `n_${i}`, title: `T${i}`, body: 'x', at: 100 + i, shown: i !== 12 }));
  const out = newsForPlayers({ items });
  assert.equal(out.length, NEWS_FOR_PLAYERS);
  assert.deepEqual(out.slice(0, 2).map((n) => n.title), ['T11', 'T10'], 'newest first, the hidden one (12) left out');
  assert.deepEqual(Object.keys(out[0]).sort(), ['at', 'body', 'id', 'title']);

  await saveNews({ items: [{ title: 'Hiện', body: 'a' }, { title: 'Ẩn', body: 'b', shown: false }] });
  const chunks = [];
  const req = { method: 'GET', headers: { 'x-portal-token': 'portal-secret-token' }, async *[Symbol.asyncIterator]() { yield* chunks; } };
  let status = 0; let body = '';
  const res = { writeHead: (s) => { status = s; }, end: (b) => { body = b; } };
  assert.equal(await handlePlayerApi(req, res, '/player-api/news', { store: new Store(), serverPhase: async () => 'running' }), true);
  assert.equal(status, 200);
  assert.deepEqual(JSON.parse(body).items.map((n) => n.title), ['Hiện']);
  assert.ok(!body.includes('"shown"'), 'the panel-only field stays in the panel');
});

test('the panel: reading needs mods.view, saving mods.edit', () => {
  assert.equal(permissionFor('GET', '/api/news'), 'mods.view');
  assert.equal(permissionFor('PUT', '/api/news'), 'mods.edit');
});
