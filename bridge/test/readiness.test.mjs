// Readiness checklist: parsing the game's own log and /proc/net, and the verdict.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseGameLog, parseProcNet, assess, checkListApi } = await import('../dist/readiness.js');

// Lines as the live server wrote them (TheIsle.log, 2026-09-23), trimmed.
const LOG = [
  'Log file open, 09/23/26 20:51:59',
  'LogRedpointEOSIdentity: Verbose: DedicatedServer: Performed Login on dedicated server.',
  'LogRedpointEOSIdentity: Verbose: Local user 0 is now signed in as (dedicated server)',
  'LogSteamShared: Warning: Steam Dedicated Server API failed to initialize.',
  '[2026.09.23-20.52.02:552][  0]LogGlobalStatus: UEngine::Browse Started Browse: "/Game/TheIsle/Maps/Game/Gateway/Gateway?Name=Player?Port=7777"',
  '[2026.09.23-20.52.02:572][  0]LogLoad: LoadMap: /Game/TheIsle/Maps/Game/Gateway/Gateway?Name=Player?Port=7777',
  '[2026.09.23-20.52.24:900][  0]LogWorld: Bringing World /Game/TheIsle/Maps/Game/Gateway/Gateway.Gateway up for play (max tick rate 30) at 2026.09.24-03.52.24',
  '[2026.09.23-20.52.25:243][  0]LogLoad: (Engine Initialization) Total time: 26.35 seconds',
].join('\r\n');
const T = (iso) => Math.floor(Date.parse(iso) / 1000);

test('game log: run start, world up, EOS sign-in (UTC timestamps)', () => {
  const f = parseGameLog(LOG);
  assert.equal(f.startedAt, T('2026-09-23T20:52:02Z'));
  assert.equal(f.mapLoadedAt, T('2026-09-23T20:52:24Z'));
  assert.equal(f.map, 'Gateway');
  assert.equal(f.eosSignedIn, true);
  assert.equal(f.eosError, null, 'a Steam warning is not an EOS error');
  const bad = parseGameLog(LOG + '\r\n[2026.09.23-20.52.30:000][  0]LogRedpointEOSCore: Error: Invalid credentials');
  assert.match(bad.eosError, /LogRedpointEOSCore: Error: Invalid credentials/);
});

test('/proc/net: TCP counts LISTEN only, UDP every bound socket', () => {
  const tcp = [
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
    '   0: 00000000:22B8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1 1',   // 8888 LISTEN
    '   1: 00000000:2710 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 2 1',   // 10000 LISTEN
    '   2: 0100007F:1F90 0100007F:D431 01 00000000:00000000 00:00000000 00000000  1000        0 3 1',   // 8080 ESTABLISHED
  ].join('\n');
  assert.deepEqual([...parseProcNet(tcp, 'tcp')].sort((a, b) => a - b), [8888, 10000]);
  const udp = [
    '   sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops',
    '  410: 00000000:1E61 00000000:0000 07 00000000:00000000 00:00000000 00000000  1000        0 6272102 2 0000000000000000 0',
  ].join('\n');
  assert.deepEqual([...parseProcNet(udp, 'udp')], [7777]);
  // IPv6 table format: the port is still after the last colon.
  assert.deepEqual([...parseProcNet('h\n   0: 00000000000000000000000000000000:1E61 00000000000000000000000000000000:0000 07 x x x x', 'udp')], [7777]);
});

const since = T('2026-09-23T20:51:57Z');
const running = { unit: { activeState: 'active', since }, phase: 'running', modsLoadedAt: since + 10, lastJoin: null };
const allPorts = { udp: new Set([7777]), tcp: new Set([8888, 10000]) };
const want = { game: 7777, queue: 10000, rcon: 8888 };

test('everything up: ready', () => {
  const r = assess(running, parseGameLog(LOG), null, allPorts, want, since + 60);
  assert.equal(r.verdict, 'ready', r.summary);
  assert.equal(r.checks.length, 7);
  assert.ok(r.checks.every((c) => c.state === 'ok'));
});

test('game port not bound yet while starting: waits, never "ready"', () => {
  const r = assess(running, parseGameLog(LOG), null, { udp: new Set(), tcp: allPorts.tcp }, want, since + 30);
  assert.equal(r.verdict, 'starting');
  assert.match(r.summary, /Cổng game 7777\/udp/);
});

test('an EOS error is a problem, named in the summary', () => {
  const log = parseGameLog(LOG + '\n[2026.09.23-20.52.30:000][  0]LogRedpointEOSCore: Error: Invalid credentials');
  const r = assess(running, log, null, allPorts, want, since + 60);
  assert.equal(r.verdict, 'problem');
  assert.equal(r.checks.find((c) => c.id === 'eos').state, 'fail');
});

test('a log left over from the previous run is not trusted', () => {
  const later = { ...running, unit: { activeState: 'active', since: since + 3600 } };
  const r = assess(later, parseGameLog(LOG), null, allPorts, want, since + 3700);
  assert.equal(r.checks.find((c) => c.id === 'map').state, 'wait');
  assert.equal(r.checks.find((c) => c.id === 'eos').state, 'wait');
  assert.equal(r.verdict, 'starting');
});

test('server stopped: down, and an unreadable log is reported, not hidden', () => {
  const r = assess({ unit: { activeState: 'inactive', since: null }, phase: 'stopped', modsLoadedAt: null, lastJoin: null },
    null, 'không đọc được TheIsle.log: ENOENT', { udp: new Set(), tcp: new Set() }, want, since);
  assert.equal(r.verdict, 'down');
  assert.equal(r.checks.find((c) => c.id === 'log').state, 'fail');
});

test('queue / RCON disabled in Game.ini: not checked', () => {
  const r = assess(running, parseGameLog(LOG), null, allPorts, { game: 7777, queue: null, rcon: null }, since + 60);
  assert.deepEqual(r.checks.map((c) => c.id), ['unit', 'mods', 'map', 'eos', 'port-game']);
});

test('server-list API: up, down, unreachable; checked at most every 5 minutes', async () => {
  let calls = 0;
  const reply = (status) => async () => { calls += 1; return { status }; };
  const up = await checkListApi(1000, reply(405));
  assert.equal(up.ok, true, '405 = the API answered');
  assert.equal((await checkListApi(1200, reply(500))).ok, true, 'cached for 5 minutes');
  assert.equal(calls, 1);
  const down = await checkListApi(1400, reply(502));
  assert.equal(down.ok, false);
  assert.match(down.detail, /502/);
  const gone = await checkListApi(1800, async () => { throw new Error('getaddrinfo ENOTFOUND'); });
  assert.equal(gone.ok, false);
  assert.match(gone.detail, /ENOTFOUND/);
  const r = assess(running, parseGameLog(LOG), null, allPorts, want, since + 60, gone);
  assert.equal(r.verdict, 'problem', 'a dead list API means players cannot see the server');
  assert.equal(r.checks.at(-1).id, 'list-api');
});
