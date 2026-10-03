// Site / launcher traffic (traffic.ts): counted per day for the panel's "Truy cập".
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'traffic-test-'));
process.env.DATA_DIR = root;
after(() => rmSync(root, { recursive: true, force: true }));
const { Traffic, parseTrafficEvent, dayKey, KEEP_DAYS } = await import('../dist/traffic.js');

const DAY = 86_400_000;
const t0 = new Date(2026, 9, 3, 12, 0).getTime();
const ID1 = 'a'.repeat(32), ID2 = 'b'.repeat(32);
const S1 = '76561198000000001', S2 = '76561198000000002';

test('a day: views and distinct visitors per place, clicks, installers served, launchers, logins, players using it', () => {
  const tr = new Traffic(join(root, 't1.json'));
  for (const e of [
    { kind: 'view', where: 'web', visitor: 'f'.repeat(24) },
    { kind: 'view', where: 'web', visitor: 'f'.repeat(24) },
    { kind: 'view', where: 'launcher', visitor: 'e'.repeat(24) },
    { kind: 'download_click', os: 'win' },
    { kind: 'download_file', os: 'linux', update: false },
    { kind: 'download_file', os: 'win', update: true },
    { kind: 'launcher', id: ID1, os: 'win', version: '1.0.33', first: true },
    { kind: 'launcher', id: ID1, os: 'win', version: '1.0.33', first: true },     // again (6 h later): one launcher, one install
    { kind: 'launcher', id: ID2, os: 'linux', version: '1.0.32', first: false },  // an update, not an install
    { kind: 'login', via: 'web', steamId: S1 },
    { kind: 'login', via: 'launcher', steamId: S1 },
    { kind: 'active', where: 'web', steamId: S1 },
    { kind: 'active', where: 'web', steamId: S1 },
  ]) tr.record(parseTrafficEvent(e), t0);
  const { days, total } = tr.view(7, t0);
  const d = days[days.length - 1];
  assert.equal(d.day, dayKey(t0));
  assert.deepEqual(d.views, { web: 2, launcher: 1 });
  assert.deepEqual(d.visitors, { web: 1, launcher: 1 });
  assert.deepEqual(d.downloadClicks, { win: 1, linux: 0 });
  assert.deepEqual(d.downloadFiles, { win: 0, linux: 1, update: 1 });
  assert.deepEqual(d.installs, { win: 1, linux: 0, other: 0 });
  assert.equal(d.launchers, 2);
  assert.deepEqual(d.logins, { web: 1, launcher: 1 });
  assert.equal(d.loginUsers, 1);
  assert.equal(d.newUsers, 1);
  assert.deepEqual(d.active, { web: 1, launcher: 0 });
  assert.equal(days.length, 7, 'empty days are there too');
  assert.deepEqual(total, { visitors: 2, launchers: 2, users: 1, active: 1 });
  assert.deepEqual(tr.versions(7, t0), { '1.0.33': 1, '1.0.32': 1 });
});

test('across days: a player’s first login is new once; a known launcher’s "first" is not an install again; old days go', async () => {
  const path = join(root, 't2.json');
  const tr = new Traffic(path);
  tr.record({ kind: 'login', via: 'web', steamId: S2 }, t0);
  tr.record({ kind: 'launcher', id: ID1, os: 'win', version: '1.0.33', first: true }, t0);
  tr.record({ kind: 'login', via: 'web', steamId: S2 }, t0 + DAY);
  tr.record({ kind: 'launcher', id: ID1, os: 'win', version: '1.0.33', first: true }, t0 + DAY);
  await tr.flush();
  const again = new Traffic(path);
  await again.load();
  again.record({ kind: 'login', via: 'web', steamId: S2 }, t0 + 2 * DAY);
  const days = again.view(3, t0 + 2 * DAY).days;
  assert.deepEqual(days.map((d) => d.newUsers), [1, 0, 0]);
  assert.deepEqual(days.map((d) => d.installs.win), [1, 0, 0]);
  assert.equal(again.view(30, t0 + 2 * DAY).total.users, 1);
  again.record({ kind: 'view', where: 'web', visitor: 'c'.repeat(24) }, t0 + (KEEP_DAYS + 5) * DAY);
  assert.equal(again.view(KEEP_DAYS, t0 + (KEEP_DAYS + 5) * DAY).days.some((d) => d.newUsers > 0), false, 'days past KEEP_DAYS are gone');
});

test('parseTrafficEvent: only what it should hold', () => {
  assert.throws(() => parseTrafficEvent({ kind: 'view', where: 'web', visitor: 'not hex!' }), /visitor/);
  assert.throws(() => parseTrafficEvent({ kind: 'view', where: 'moon', visitor: 'f'.repeat(24) }), /where/);
  assert.throws(() => parseTrafficEvent({ kind: 'launcher', id: ID1, os: 'win', version: '<script>' }), /version/);
  assert.throws(() => parseTrafficEvent({ kind: 'login', via: 'web', steamId: '123' }), /steamId/);
  assert.throws(() => parseTrafficEvent({ kind: 'nope' }), /kind/);
  assert.deepEqual(parseTrafficEvent({ kind: 'download_file', os: 'win', update: 'yes' }), { kind: 'download_file', os: 'win', update: false });
});

test('range: one day is hour by hour; several days are day by day; totals count people / machines once', () => {
  const tr = new Traffic(join(root, 't3.json'));
  const at = (dayOffset, hour) => new Date(2026, 9, 3 + dayOffset, hour, 15).getTime();
  tr.record({ kind: 'view', where: 'web', visitor: 'a'.repeat(24) }, at(0, 9));
  tr.record({ kind: 'view', where: 'web', visitor: 'a'.repeat(24) }, at(0, 9));
  tr.record({ kind: 'view', where: 'launcher', visitor: 'b'.repeat(24) }, at(0, 21));
  tr.record({ kind: 'launcher', id: ID1, os: 'win', version: '1.0.33', first: true }, at(0, 21));
  tr.record({ kind: 'view', where: 'web', visitor: 'a'.repeat(24) }, at(1, 10));
  const day = tr.range('2026-10-03', '2026-10-03');
  assert.equal(day.unit, 'hour');
  assert.equal(day.points.length, 24);
  assert.equal(day.points[9].label, '09:00');
  assert.equal(day.points[9].viewsWeb, 2);
  assert.equal(day.points[9].visitorsWeb, 1, 'the same visitor twice in an hour: one new visitor');
  assert.equal(day.points[21].viewsLauncher, 1);
  assert.equal(day.points[21].installs, 1);
  const days = tr.range('2026-10-02', '2026-10-04');
  assert.equal(days.unit, 'day');
  assert.deepEqual(days.points.map((p) => [p.label, p.viewsWeb]), [['2026-10-02', 0], ['2026-10-03', 2], ['2026-10-04', 1]]);
  assert.equal(days.total.viewsWeb, 3);
  assert.equal(days.total.visitors, 2, 'a and b');
  assert.equal(days.total.launcherMachines, 1);
});
