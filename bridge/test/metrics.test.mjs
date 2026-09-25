// Performance history for the panel: /proc parsing, CPU %, downsampling and
// the capacity table (how the server behaves at each player count).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseCpuTotals, cpuPercent, parseMeminfo, parseProcessTicks, rssMb, downsample, capacity, Metrics,
} from '../dist/metrics.js';

test('/proc/stat: idle (+iowait) and total, and the CPU % between two readings', () => {
  const a = parseCpuTotals('cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 2 3 4\n');
  assert.deepEqual(a, { idle: 800, total: 1000 });
  const b = parseCpuTotals('cpu  400 0 200 1000 100 0 0 0 0 0\n');
  assert.equal(cpuPercent(a, b), 57.1, '(1 - 300/700) * 100');
  assert.equal(cpuPercent(b, b), null, 'no time passed');
  assert.equal(parseCpuTotals('nonsense'), null);
});

test('/proc/meminfo: used = total - available; swap in use', () => {
  const m = parseMeminfo('MemTotal:        6067200 kB\nMemFree:  100 kB\nMemAvailable:    3852288 kB\nSwapTotal:  8388604 kB\nSwapFree:   8388604 kB\n');
  assert.deepEqual(m, { totalMb: 5925, availableMb: 3762, swapUsedMb: 0 });
  assert.equal(parseMeminfo('MemTotal: 1 kB\n'), null);
});

test('/proc/<pid>/stat: utime + stime, even with spaces and parens in the name; VmRSS in MB', () => {
  const stat = '47114 (Game (Thread) x) R 1 47042 47042 0 -1 4194304 747011 34 5 0 7119 1409 0 2 20 0 50 0 3370043';
  assert.equal(parseProcessTicks(stat), 7119 + 1409);
  assert.equal(parseProcessTicks('garbage'), null);
  assert.equal(rssMb('Name:\tx\nVmRSS:\t 1541596 kB\n'), 1505.5);
});

const S = (t, online, fps, extra = {}) => ({ t, online, fps, ai: null, cpu: 10, gameCpu: 50, gameRss: 1500, memUsed: 2000, memTotal: 6000, swapUsed: 0, ...extra });

test('downsample: at most N points, averages, and the worst FPS kept', () => {
  const samples = [];
  for (let i = 0; i < 100; i++) samples.push(S(1000 + i * 10, i < 50 ? 2 : 5, i === 7 ? 12 : 30));
  const pts = downsample(samples, 1000, 2000, 10);
  assert.ok(pts.length <= 10 && pts.length >= 9, String(pts.length));
  assert.equal(pts[0].fpsMin, 12, 'a dip is not averaged away');
  assert.equal(pts[pts.length - 1].online, 5);
  assert.deepEqual(downsample(samples, 5000, 6000, 10), []);
});

test('capacity: FPS and memory per player-count band, only bands with data', () => {
  const samples = [
    ...Array.from({ length: 60 }, (_, i) => S(i, 0, 30)),
    ...Array.from({ length: 60 }, (_, i) => S(1000 + i, 3, i < 3 ? 18 : 29, { gameRss: 2000 + i })),
    ...Array.from({ length: 30 }, (_, i) => S(2000 + i, 25, 21, { gameRss: 4200, swapUsed: 300 })),
  ];
  const rows = capacity(samples);
  assert.deepEqual(rows.map((r) => r.band), ['0', '1–5', '21–30']);
  const small = rows[1];
  assert.equal(small.minutes, 10, '60 samples × 10 s');
  assert.equal(small.fpsLow, 18, 'the bad 5 % shows');
  assert.equal(small.gameRssMax, 2059);
  assert.equal(rows[2].swapUsedMax, 300);
});

test('Metrics: history survives a restart; older than 7 days is dropped from the file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'metrics-'));
  try {
    const now = 2_000_000_000;
    writeFileSync(join(dir, 'metrics.ndjson'), [
      JSON.stringify(S(now - 8 * 86400, 1, 30)), JSON.stringify(S(now - 100, 2, 29)), 'not json',
    ].join('\n') + '\n');
    const m = new Metrics(dir, async () => ({ online: 4, fps: 27, ai: 12 }));
    await m.load(now);
    assert.equal(readFileSync(join(dir, 'metrics.ndjson'), 'utf8').trim().split('\n').length, 1, 'file trimmed');
    const s = await m.sample(now);
    assert.equal(s.online, 4);
    assert.equal(s.fps, 27);
    assert.equal(s.ai, 12);
    assert.equal(typeof s.memTotal, 'number', 'read from this machine\'s /proc');
    const v = m.view(3600, now);
    assert.equal(v.now.t, now);
    assert.equal(v.points.length, 2);
    assert.ok(v.cores >= 1);
    assert.equal(readFileSync(join(dir, 'metrics.ndjson'), 'utf8').trim().split('\n').length, 2, 'appended');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
