// Power orchestration with a virtual clock: countdown announcements, save,
// systemctl, waiting for the mods, cancel, one-at-a-time, schedule.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'power-test-'));
process.env.DATA_DIR = dir;
const { Power, phaseOf, scheduleTick, writeSchedule, readSchedule, validateSchedule, occurrences } =
  await import('../dist/power.js');
const { readAudit } = await import('../dist/audit.js');
const { parseShow } = await import('../dist/service.js');
after(() => rmSync(dir, { recursive: true, force: true }));

function rig({ modsComeUp = true, failVerb = null } = {}) {
  let t = Date.UTC(2026, 8, 24, 3, 50, 0);            // virtual ms
  let mods = null;
  const calls = [];
  const announced = [];
  const service = {
    async state() { return { activeState: 'active', subState: 'running', since: Math.floor(t / 1000), pid: 42 }; },
    async run(verb) {
      calls.push(['systemctl', verb, t]);
      if (verb === failVerb) throw new Error(`sudo: a password is required`);
      if (verb !== 'stop' && modsComeUp) mods = Math.floor(t / 1000) + 40;   // StatsLogger reports 40s later
    },
  };
  const rcon = {
    enabled: true,
    async run(name, args) {
      calls.push(['rcon', name, t]);
      if (name === 'announce') announced.push(args);
      return '';
    },
  };
  const sleep = (ms, signal) => new Promise((res, rej) => setImmediate(() => {
    if (signal.aborted) return rej(new Error('cancelled'));
    t += Math.max(0, ms);
    res();
  }));
  const power = new Power({
    service, rcon, modsLoadedAt: () => (mods !== null && mods <= Math.floor(t / 1000) ? mods : null),
    now: () => t, sleep, readyTimeoutMs: 5 * 60_000, pollMs: 5000,
  });
  const settle = async () => { while (power.current) await new Promise(setImmediate); };
  return { power, calls, announced, settle, now: () => t };
}

test('restart with a 5 minute countdown: warnings, save, restart, wait for mods', async () => {
  const r = rig();
  const op = r.power.request('restart', { countdownSeconds: 300, reason: 'cập nhật mod' });
  assert.equal(op.step, 'countdown');
  await r.settle();
  assert.equal(r.power.last.step, 'done', r.power.last.message);
  // 5m (with the reason), then 3m, 2m, 1m, 30s, 10s, then "restarting now"
  assert.equal(r.announced.length, 7, r.announced.join(' | '));
  assert.equal(r.announced[0], 'Server sẽ khởi động lại sau 5 phút / Server restarting in 5 min. cập nhật mod');
  assert.equal(r.announced[5], 'Server sẽ khởi động lại sau 10 giây / Server restarting in 10 s.');
  assert.equal(r.announced.at(-1), 'Server đang khởi động lại / Server restarting now.');
  const names = r.calls.map((c) => c[1]);
  assert.ok(names.indexOf('save') < names.indexOf('restart'), 'save before restart');
  const restartAt = r.calls.find((c) => c[1] === 'restart')[2];
  assert.ok(restartAt - op.startedAt >= 300_000, 'restart only after the countdown');
});

test('stop without countdown, and start does not announce or save', async () => {
  const r = rig();
  r.power.request('stop');
  await r.settle();
  assert.deepEqual(r.calls.filter((c) => c[0] === 'systemctl').map((c) => c[1]), ['stop']);
  const s = rig();
  s.power.request('start', { countdownSeconds: 600 });   // countdown ignored for start
  await s.settle();
  assert.deepEqual(s.calls.map((c) => c[1]), ['start']);
  assert.equal(s.power.last.step, 'done');
});

test('cancel during the countdown: nothing is stopped, players are told', async () => {
  const r = rig();
  r.power.request('restart', { countdownSeconds: 600 });
  assert.equal(r.power.cancel(), true);
  await r.settle();
  assert.equal(r.power.last.step, 'cancelled');
  assert.equal(r.calls.filter((c) => c[0] === 'systemctl').length, 0);
  assert.match(r.announced.at(-1), /huỷ/i);
  assert.equal(r.power.cancel(), false, 'nothing left to cancel');
});

test('one operation at a time', async () => {
  const r = rig();
  r.power.request('restart', { countdownSeconds: 60 });
  assert.throws(() => r.power.request('stop'), /in progress/);
  await r.settle();
  assert.doesNotThrow(() => r.power.request('stop'));
  await r.settle();
});

test('a systemctl failure is reported, not swallowed', async () => {
  const r = rig({ failVerb: 'restart' });
  r.power.request('restart');
  await r.settle();
  assert.equal(r.power.last.step, 'failed');
  assert.match(r.power.last.message, /password is required/);
  const [entry] = await readAudit(1);
  assert.equal(entry.ok, false);
});

test('mods that never report in: done, but with a warning', async () => {
  const r = rig({ modsComeUp: false });
  r.power.request('start');
  await r.settle();
  assert.equal(r.power.last.step, 'done');
  assert.match(r.power.last.message, /mods have not reported/);
});

test('bad countdowns are refused', () => {
  const r = rig();
  assert.throws(() => r.power.request('restart', { countdownSeconds: -1 }), /countdown/);
  assert.throws(() => r.power.request('restart', { countdownSeconds: 99999 }), /countdown/);
});

test('phase from systemd + mods', () => {
  const unit = (activeState, since = 1000) => ({ activeState, subState: '', since, pid: 1 });
  assert.equal(phaseOf(unit('active'), 1010), 'running');
  assert.equal(phaseOf(unit('active'), 900), 'starting', 'mods from the previous run do not count');
  assert.equal(phaseOf(unit('active'), null), 'starting');
  assert.equal(phaseOf(unit('inactive'), 1010), 'stopped');
  assert.equal(phaseOf(unit('failed'), null), 'failed');
  assert.equal(phaseOf(unit('deactivating'), null), 'stopping');
});

test('systemctl show parsing', () => {
  const s = parseShow('ActiveState=active\nSubState=running\nActiveEnterTimestamp=@1790000000\nMainPID=4242\n');
  assert.deepEqual(s, { activeState: 'active', subState: 'running', since: 1790000000, pid: 4242 });
  const off = parseShow('ActiveState=inactive\nSubState=dead\nActiveEnterTimestamp=\nMainPID=0\n');
  assert.equal(off.since, null);
  assert.equal(off.pid, null);
});

test('schedule: validation, next occurrences, fires once in the window', async () => {
  assert.throws(() => validateSchedule({ daily: ['25:00'] }), /HH:MM/);
  assert.throws(() => validateSchedule({ daily: ['04:00'], countdownMinutes: 90 }), /0–30/);
  assert.deepEqual(validateSchedule({ daily: ['16:00', '04:00', '04:00'] }).daily, ['04:00', '16:00']);

  const base = new Date(2026, 8, 24, 3, 50, 0).getTime();       // 03:50 local
  const [first] = occurrences({ daily: ['04:00'] }, base);
  assert.equal(first.getHours(), 4);

  await writeSchedule({ daily: ['04:00'], countdownMinutes: 5, lastFired: null });
  const r = rig();
  await scheduleTick(r.power, base);                            // 10 min before: window not open
  assert.equal(r.power.current, null);
  await scheduleTick(r.power, base + 6 * 60_000);               // 03:56: inside the 5-min window
  assert.equal(r.power.current?.kind, 'restart');
  assert.equal(r.power.current.source, 'schedule');
  assert.equal(Math.round((r.power.current.runAt - r.power.current.startedAt) / 1000), 240, 'lands on 04:00');
  await r.settle();
  await scheduleTick(r.power, base + 7 * 60_000);
  assert.equal(r.power.current, null, 'the same slot never fires twice');
  assert.match((await readSchedule()).lastFired, / 04:00$/);
});
