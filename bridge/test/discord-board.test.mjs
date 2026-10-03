// The status board on Discord (discord-board.ts): one message, edited in place.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'discord-board-test-'));
process.env.DATA_DIR = root;
after(() => rmSync(root, { recursive: true, force: true }));

const { boardEmbed, firedAt, StatusBoard, boardPath } = await import('../dist/discord-board.js');
const { validateDiscord } = await import('../dist/discord.js');

const HOOK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123';

test('the board: name, online, players, next restart and the last one (scheduled or not), as Discord timestamps', () => {
  const e = boardEmbed({ name: 'XG EVO', phase: 'running', online: 3, maxPlayers: 100, next: 1_800_000_000,
    last: { t: 1_799_970_000, scheduled: true }, now: 1_799_990_000 });
  assert.equal(e.title, 'XG EVO');
  assert.match(e.description, /🟢 {2}\*\*Online\*\*/);
  assert.match(e.description, /\*\*Người chơi\*\* {2}3 \/ 100/);
  assert.match(e.description, /Lần khởi động lại tới\*\* {2}\d\d:\d\d {2}· {2}<t:1800000000:R>/);
  assert.match(e.description, /Lần khởi động lại trước\*\* {2}lúc <t:1799970000:f> {2}· {2}<t:1799970000:R> {2}\(đã lên lịch\)/);
  const off = boardEmbed({ name: null, phase: 'stopped', online: 0, maxPlayers: null, next: null, last: { t: 1, scheduled: false }, now: 2 });
  assert.equal(off.title, 'Server');
  assert.match(off.description, /🔴 {2}\*\*Offline\*\*/);
  assert.match(off.description, /chưa có lịch/);
  assert.match(off.description, /\(ngoài lịch\)/);
  assert.equal(boardEmbed({ name: 'a*b_c', phase: 'running', online: 0, maxPlayers: null, next: null, last: null, now: 1 }).title, 'a\\*b\\_c');
});

test('firedAt: the schedule\'s last key in server time', () => {
  const t = firedAt('2026-10-03 11:00');
  const d = new Date(t * 1000);
  assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()], [2026, 10, 3, 11, 0]);
  assert.equal(firedAt(null), null);
  assert.equal(firedAt('nope'), null);
});

test('posted once, then the same message edited; deleted in Discord: posted again; unchanged: not sent again soon', async () => {
  const calls = [];
  let deleted = false;
  const fetch = async (url, init) => {
    calls.push(`${init.method} ${url.replace(HOOK, 'HOOK')}`);
    if (init.method === 'PATCH') return deleted ? { status: 404, text: async () => '' } : { status: 200, text: async () => '{}' };
    return { status: 200, text: async () => JSON.stringify({ id: calls.length === 1 ? '111111111111111111' : '222222222222222222' }) };
  };
  const saved = [];
  const board = new StatusBoard({ fetch, save: async (v) => { saved.push(v); writeFileSync(boardPath(), JSON.stringify(v)); } });
  const emb = (online) => boardEmbed({ name: 'S', phase: 'running', online, maxPlayers: 10, next: null, last: null, now: 1 });
  await board.update(HOOK, emb(1), 1_000_000);
  await board.update(HOOK, emb(2), 1_060_000);
  await board.update(HOOK, emb(2), 1_120_000);          // nothing new, a minute later: not sent
  deleted = true;
  await board.update(HOOK, emb(3), 1_180_000);
  assert.deepEqual(calls, [
    'POST HOOK?wait=true',
    'PATCH HOOK/messages/111111111111111111',
    'PATCH HOOK/messages/111111111111111111',
    'POST HOOK?wait=true',
  ]);
  assert.equal(JSON.parse(readFileSync(boardPath(), 'utf8')).id, '222222222222222222', 'the new message is kept');
  assert.equal(board.lastError, null);
  // A bridge restart: the kept message is edited, not a new one posted.
  calls.length = 0; deleted = false;
  const again = new StatusBoard({ fetch, save: async () => undefined });
  await again.update(HOOK, emb(4), 2_000_000);
  assert.deepEqual(calls, ['PATCH HOOK/messages/222222222222222222']);
});

test('settings: the board\'s channel must be one of the channels; none is fine', () => {
  const base = { enabled: true, channels: [{ id: 'abc', name: 'status', url: HOOK }], routes: {} };
  assert.equal(validateDiscord({ ...base, board: 'abc' }).board, 'abc');
  assert.equal(validateDiscord({ ...base }).board, null);
  assert.throws(() => validateDiscord({ ...base, board: 'zzz' }), /kênh không tồn tại/);
});
