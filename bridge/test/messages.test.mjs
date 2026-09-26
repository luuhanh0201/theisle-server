// Players' texts and announcement timings (messages.ts, announcer.ts), and
// the catalog against the mods' own calls (mods/**/*.lua, Msg.*).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'messages-test-'));
process.env.DATA_DIR = join(root, 'data');
process.env.MESSAGES_MOD_PATH = join(root, 'Mods', 'shared', 'isle-messages.json');
const { MESSAGES, MESSAGE_BY_KEY, validateMessages, renderMessage, saveMessages, loadMessages, currentMessages, MESSAGES_DEFAULTS }
  = await import('../dist/messages.js');
const { Announcer } = await import('../dist/announcer.js');
after(() => rmSync(root, { recursive: true, force: true }));

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function luaFiles(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? luaFiles(p) : n.endsWith('.lua') ? [p] : [];
  });
}

test('the catalog is what the mods send: every Msg call has its key, with the same default', () => {
  const found = new Map();
  const str = '"((?:[^"\\\\]|\\\\.)*)"';
  const call = new RegExp(`Msg\\.(?:notify|say)\\(\\s*[^,]+,\\s*"([\\w.]+)",\\s*${str}`, 'g');
  const text = new RegExp(`Msg\\.text\\(\\s*"([\\w.]+)",\\s*${str}`, 'g');
  for (const file of luaFiles(join(REPO, 'mods'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of [...src.matchAll(call), ...src.matchAll(text)]) found.set(m[1], m[2]);
    // DinoGarage's failure reasons: garage.reason.<key> with the table's text.
    const table = /local REASON_VI = \{([\s\S]*?)\n\}/.exec(src);
    if (table) for (const m of table[1].matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) found.set(`garage.reason.${m[1]}`, m[2]);
  }
  assert.ok(found.size > 40, `found ${found.size}`);
  for (const [key, def] of found) {
    assert.ok(MESSAGE_BY_KEY.has(key), `${key} is sent by a mod but missing from messages.ts`);
    assert.equal(MESSAGE_BY_KEY.get(key).default, def, `${key}: default differs from the mod`);
    for (const [, v] of def.matchAll(/\{(\w+)\}/g)) assert.ok(MESSAGE_BY_KEY.get(key).vars.includes(v), `${key}: {${v}} not listed`);
  }
  for (const m of MESSAGES) {
    if (m.group === 'server' || m.group === 'corpses' || m.group === 'ai' || m.group === 'ban') continue;
    assert.ok(found.has(m.key), `${m.key} is in messages.ts but no mod sends it`);
  }
});

test('validation: known keys, only their {vars}, the default is not an edit, "" turns one off', () => {
  const s = validateMessages({ texts: { 'garage.cooldown': 'Chờ {seconds}s', 'cmd.slay.done': '', 'redeem.empty': 'Your garage is empty.' } });
  assert.deepEqual(s.texts, { 'garage.cooldown': 'Chờ {seconds}s', 'cmd.slay.done': '' });
  assert.throws(() => validateMessages({ texts: { 'nope': 'x' } }), /unknown message/);
  assert.throws(() => validateMessages({ texts: { 'garage.cooldown': 'Chờ {secs}' } }), /\{secs\} is not available.*\{seconds\}/);
  assert.throws(() => validateMessages({ texts: { 'garage.stored': 'x'.repeat(301) } }), /300/);
  assert.equal(validateMessages({ texts: { 'garage.stored': 'a\nb' } }).texts['garage.stored'], 'a b', 'one line');
  assert.deepEqual(validateMessages({ countdownMarks: [60, 600, 60, 10] }).countdownMarks, [600, 60, 10]);
  assert.throws(() => validateMessages({ countdownMarks: [2] }), /countdownMarks/);
  assert.throws(() => validateMessages({ periodic: [{ text: 'hi', everyMin: 1 }] }), /everyMin/);
  assert.throws(() => validateMessages({ periodic: [{ text: '  ', everyMin: 30 }] }), /empty/);
  assert.throws(() => validateMessages({ periodic: [{ text: 'hi {x}', everyMin: 30 }] }), /not available/);
  assert.match(validateMessages({ periodic: [{ text: 'Discord: x', everyMin: 30 }] }).periodic[0].id, /^[a-z0-9]+$/);
  assert.throws(() => validateMessages({ corpseWipe: { everyMin: 3, warnSec: 30 } }), /at least 5/);
  assert.deepEqual(validateMessages({}), MESSAGES_DEFAULTS);
});

test('render: the admin\'s text or the default, vars filled, an empty {reason} leaves no gap', () => {
  const s = validateMessages({ texts: { 'server.restart.now': '', 'corpses.done': 'Xác đã được dọn!' } });
  assert.equal(renderMessage('server.restart.countdown', { left: '5 phút', leftEn: '5 min', reason: '' }, s),
    'Server sẽ khởi động lại sau 5 phút / Server restarting in 5 min.');
  assert.equal(renderMessage('server.restart.now', {}, s), null);
  assert.equal(renderMessage('corpses.done', {}, s), 'Xác đã được dọn!');
});

test('off by default: not sent until the admin writes a text (the suggested one counts)', () => {
  assert.equal(MESSAGE_BY_KEY.get('ptera.carry.hint').offByDefault, true);
  assert.equal(renderMessage('ptera.carry.victim', {}, validateMessages({})), null);
  const def = MESSAGE_BY_KEY.get('ptera.carry.victim').default;
  const on = validateMessages({ texts: { 'ptera.carry.victim': def, 'ptera.carry.hint': '' } });
  assert.deepEqual(on.texts, { 'ptera.carry.victim': def }, 'the default text kept (= on), "" dropped (= off)');
  assert.equal(renderMessage('ptera.carry.victim', {}, on), def);
});

test('save: kept for the bridge, the mods get only their own texts; loaded back at start', async () => {
  await saveMessages({ texts: { 'garage.stored': 'Cất rồi!', 'server.stop.now': 'Tắt đây' }, countdownMarks: [300, 60] });
  const mod = JSON.parse(readFileSync(process.env.MESSAGES_MOD_PATH, 'utf8'));
  const offs = Object.fromEntries(MESSAGES.filter((m) => m.offByDefault && !['server', 'corpses', 'ai', 'ban'].includes(m.group)).map((m) => [m.key, '']));
  assert.deepEqual(mod, { texts: { 'garage.stored': 'Cất rồi!', ...offs } }, 'the ones off by default are written off');
  await loadMessages();
  assert.deepEqual(currentMessages().countdownMarks, [300, 60]);
  assert.equal(renderMessage('server.stop.now'), 'Tắt đây');
});

test('announcer: periodic texts and the corpse wipe, on time, only while someone plays', async () => {
  let now = 0;
  let online = 1;
  const sent = [];
  const rcon = { enabled: true, run: async (name, args) => { sent.push(args === undefined ? name : `${name}: ${args}`); return ''; } };
  let settings = validateMessages({
    periodic: [{ id: 'a', text: 'Discord: xomgay', everyMin: 10 }, { id: 'b', text: 'off', everyMin: 5, enabled: false }],
    corpseWipe: { everyMin: 30, warnSec: 60 },
  });
  const a = new Announcer({ rcon, online: () => online, settings: () => settings, now: () => now, log: () => {} });
  const at = async (min) => { now = min * 60_000; await a.tick(); };
  await at(0);
  assert.deepEqual(sent, [], 'nothing at start');
  await at(10);
  assert.deepEqual(sent, ['announce: Discord: xomgay']);
  await at(15);
  assert.equal(sent.length, 1, 'not before the next 10 min; the disabled one never');
  await at(20);
  assert.equal(sent.at(-1), 'announce: Discord: xomgay', 'every 10 min');
  await at(29);
  assert.equal(sent.at(-1), 'announce: Dọn xác sau 1 phút / Clearing corpses in 1 min.');
  await at(30);
  assert.deepEqual(sent.slice(-3), ['announce: Discord: xomgay', 'wipeCorpses', 'announce: Đã dọn xác / Corpses cleared.']);
  online = 0;
  sent.length = 0;
  await at(60);
  assert.deepEqual(sent, [], 'nobody online: nothing said, nothing wiped');
  online = 1;
  settings = validateMessages({ periodic: [{ id: 'a', text: 'Discord: xomgay', everyMin: 20 }] });
  await at(61);
  await at(75);
  assert.deepEqual(sent, [], 'a changed interval starts over');
  await at(81);
  assert.deepEqual(sent, ['announce: Discord: xomgay']);
});
