import { appendFile, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join } from 'node:path';

/**
 * Server performance over time, for the panel's "Hiệu năng" page: how many
 * players the machine really carries. Every SAMPLE_MS the bridge records
 *
 *   * the game's own tick rate (ServerFPS, from StatsLogger's live.json),
 *     the players online and the AI alive;
 *   * the machine: CPU % (all cores), RAM used, swap used (/proc);
 *   * the game process alone: CPU (% of ONE core — the game thread is the
 *     bottleneck) and resident memory (/proc/<pid> — the Wine process whose
 *     command line runs TheIsleServer-Win64-Shipping.exe).
 *
 * Samples live in memory (KEEP_S) and in DATA_DIR/metrics.ndjson, so a bridge
 * restart keeps the history. Read-only: /proc and a file of our own.
 */

export interface MetricSample {
  t: number;
  online: number | null;
  fps: number | null;
  ai: number | null;
  /** Machine CPU, % of all cores. */
  cpu: number | null;
  /** Game process CPU, % of one core (can exceed 100). */
  gameCpu: number | null;
  /** Game process resident memory, MB. */
  gameRss: number | null;
  /** Machine RAM in use (total − available), MB. */
  memUsed: number | null;
  memTotal: number | null;
  swapUsed: number | null;
}

export const SAMPLE_MS = 10_000;
const KEEP_S = 7 * 86400;
const r1 = (v: number): number => Math.round(v * 10) / 10;

// --- /proc parsing (pure, tested) -----------------------------------------------

/** The machine-wide "cpu" line of /proc/stat: idle and total jiffies. */
export function parseCpuTotals(procStat: string): { idle: number; total: number } | null {
  const line = procStat.split('\n').find((l) => l.startsWith('cpu '));
  if (line === undefined) return null;
  const v = line.trim().split(/\s+/).slice(1).map(Number);
  if (v.length < 4 || v.some((n) => !Number.isFinite(n))) return null;
  // user nice system idle iowait irq softirq steal: idle time = idle + iowait.
  const idle = (v[3] ?? 0) + (v[4] ?? 0);
  const total = v.slice(0, 8).reduce((a, b) => a + b, 0);
  return { idle, total };
}

export function cpuPercent(prev: { idle: number; total: number }, cur: { idle: number; total: number }): number | null {
  const dTotal = cur.total - prev.total;
  if (dTotal <= 0) return null;
  return r1(Math.min(100, Math.max(0, 100 * (1 - (cur.idle - prev.idle) / dTotal))));
}

export function parseMeminfo(text: string): { totalMb: number; availableMb: number; swapUsedMb: number } | null {
  const kb = (key: string): number | null => {
    const m = new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, 'm').exec(text);
    return m ? Number(m[1]) : null;
  };
  const total = kb('MemTotal'); const avail = kb('MemAvailable');
  if (total === null || avail === null) return null;
  const swapTotal = kb('SwapTotal') ?? 0; const swapFree = kb('SwapFree') ?? 0;
  return { totalMb: Math.round(total / 1024), availableMb: Math.round(avail / 1024), swapUsedMb: Math.round((swapTotal - swapFree) / 1024) };
}

/** utime + stime (clock ticks) from /proc/<pid>/stat — fields after the "(comm)". */
export function parseProcessTicks(stat: string): number | null {
  const end = stat.lastIndexOf(')');
  if (end < 0) return null;
  const f = stat.slice(end + 2).split(' ');
  // After "(comm) ": state is field 3 → index 0; utime is field 14 → index 11, stime index 12.
  const utime = Number(f[11]); const stime = Number(f[12]);
  return Number.isFinite(utime) && Number.isFinite(stime) ? utime + stime : null;
}

export function rssMb(status: string): number | null {
  const m = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
  return m ? r1(Number(m[1]) / 1024) : null;
}

// --- aggregation (pure, tested) ---------------------------------------------------

const avg = (xs: number[]): number | null => (xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const nums = (samples: MetricSample[], k: keyof MetricSample): number[] =>
  samples.map((s) => s[k]).filter((v): v is number => typeof v === 'number');
function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  // Nearest rank: the p-th percentile is the ceil(p·n)-th smallest value.
  return r1(s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] as number);
}

export interface MetricPoint {
  t: number;
  online: number | null; fps: number | null; fpsMin: number | null; ai: number | null;
  cpu: number | null; gameCpu: number | null; gameRss: number | null; memUsed: number | null; swapUsed: number | null;
}

/** At most `maxPoints` points over [from, to]: averages per time bucket, and the lowest FPS in it. */
export function downsample(samples: MetricSample[], from: number, to: number, maxPoints: number): MetricPoint[] {
  const inRange = samples.filter((s) => s.t >= from && s.t <= to);
  if (inRange.length === 0) return [];
  const width = Math.max(1, Math.ceil((to - from) / maxPoints));
  const buckets = new Map<number, MetricSample[]>();
  for (const s of inRange) {
    const k = Math.floor((s.t - from) / width);
    const b = buckets.get(k);
    if (b) b.push(s); else buckets.set(k, [s]);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([k, b]) => {
    const fps = nums(b, 'fps');
    const online = nums(b, 'online');
    return {
      t: from + k * width + Math.floor(width / 2),
      online: online.length ? Math.max(...online) : null,
      fps: avg(fps), fpsMin: fps.length ? Math.min(...fps) : null,
      ai: avg(nums(b, 'ai')), cpu: avg(nums(b, 'cpu')), gameCpu: avg(nums(b, 'gameCpu')),
      gameRss: avg(nums(b, 'gameRss')), memUsed: avg(nums(b, 'memUsed')), swapUsed: avg(nums(b, 'swapUsed')),
    };
  });
}

/** Player-count bands the capacity table uses. */
export const BANDS: Array<{ label: string; min: number; max: number }> = [
  { label: '0', min: 0, max: 0 }, { label: '1–5', min: 1, max: 5 }, { label: '6–10', min: 6, max: 10 },
  { label: '11–20', min: 11, max: 20 }, { label: '21–30', min: 21, max: 30 }, { label: '31–40', min: 31, max: 40 },
  { label: '41–60', min: 41, max: 60 }, { label: '61–80', min: 61, max: 80 }, { label: '81+', min: 81, max: Infinity },
];

export interface CapacityRow {
  band: string; samples: number; minutes: number;
  fpsAvg: number | null; fpsLow: number | null; gameCpuAvg: number | null; gameRssMax: number | null;
  memUsedMax: number | null; swapUsedMax: number | null; aiAvg: number | null;
}

/** How the server behaved at each player count: the answer to "how many can it carry". */
export function capacity(samples: MetricSample[]): CapacityRow[] {
  return BANDS.map((band) => {
    const b = samples.filter((s) => typeof s.online === 'number' && s.online >= band.min && s.online <= band.max);
    const max = (k: keyof MetricSample): number | null => { const x = nums(b, k); return x.length ? Math.max(...x) : null; };
    return {
      band: band.label, samples: b.length, minutes: Math.round((b.length * SAMPLE_MS) / 60_000),
      fpsAvg: avg(nums(b, 'fps')), fpsLow: percentile(nums(b, 'fps'), 0.05),
      gameCpuAvg: avg(nums(b, 'gameCpu')), gameRssMax: max('gameRss'),
      memUsedMax: max('memUsed'), swapUsedMax: max('swapUsed'), aiAvg: avg(nums(b, 'ai')),
    };
  }).filter((r) => r.samples > 0);
}

// --- the sampler ------------------------------------------------------------------

const CLK_TCK = 100;   // Linux USER_HZ; getconf CLK_TCK on the VPS = 100

async function findGamePid(): Promise<number | null> {
  let best: { pid: number; rss: number } | null = null;
  for (const name of await readdir('/proc').catch(() => [] as string[])) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const cmd = (await readFile(`/proc/${name}/cmdline`, 'utf8')).replace(/\0/g, ' ');
      if (!cmd.includes('TheIsleServer-Win64-Shipping.exe') || /start\.exe/i.test(cmd)) continue;
      const rss = rssMb(await readFile(`/proc/${name}/status`, 'utf8')) ?? 0;
      if (best === null || rss > best.rss) best = { pid: Number(name), rss };
    } catch {
      // The process ended between readdir and read: skip it.
    }
  }
  return best?.pid ?? null;
}

export interface LiveNumbers { online: number | null; fps: number | null; ai: number | null }

export class Metrics {
  readonly #samples: MetricSample[] = [];
  #prevCpu: { idle: number; total: number } | null = null;
  #game: { pid: number; ticks: number; at: number } | null = null;
  readonly #file: string;

  constructor(dataDir: string, readonly live: () => Promise<LiveNumbers>) {
    this.#file = join(dataDir, 'metrics.ndjson');
  }

  get cores(): number { return cpus().length; }

  /** Load the kept history (and drop what is older than KEEP_S from the file). */
  async load(now = Math.floor(Date.now() / 1000)): Promise<void> {
    let text = '';
    try { text = await readFile(this.#file, 'utf8'); } catch { return; }
    const kept: MetricSample[] = [];
    let dropped = 0;
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const s = JSON.parse(line) as MetricSample;
        if (typeof s.t === 'number' && now - s.t <= KEEP_S) kept.push(s); else dropped += 1;
      } catch { dropped += 1; }
    }
    this.#samples.push(...kept);
    if (dropped > 0) {
      const tmp = `${this.#file}.tmp`;
      await writeFile(tmp, kept.map((s) => JSON.stringify(s)).join('\n') + (kept.length ? '\n' : ''), 'utf8');
      await rename(tmp, this.#file);
    }
  }

  /** One sample now (the first one has no CPU yet: it needs a previous reading). */
  async sample(now = Math.floor(Date.now() / 1000)): Promise<MetricSample> {
    const [stat, mem, liveNums] = await Promise.all([
      readFile('/proc/stat', 'utf8').catch(() => ''),
      readFile('/proc/meminfo', 'utf8').catch(() => ''),
      this.live().catch(() => ({ online: null, fps: null, ai: null })),
    ]);
    const cur = parseCpuTotals(stat);
    const cpu = cur && this.#prevCpu ? cpuPercent(this.#prevCpu, cur) : null;
    if (cur) this.#prevCpu = cur;
    const m = parseMeminfo(mem);

    let gameCpu: number | null = null; let gameRss: number | null = null;
    const pid = this.#game?.pid ?? await findGamePid();
    if (pid !== null) {
      try {
        const [pstat, pstatus] = await Promise.all([readFile(`/proc/${pid}/stat`, 'utf8'), readFile(`/proc/${pid}/status`, 'utf8')]);
        const ticks = parseProcessTicks(pstat);
        gameRss = rssMb(pstatus);
        if (ticks !== null && this.#game?.pid === pid && now > this.#game.at) {
          gameCpu = r1(((ticks - this.#game.ticks) / CLK_TCK / (now - this.#game.at)) * 100);
        }
        this.#game = ticks === null ? null : { pid, ticks, at: now };
      } catch {
        this.#game = null;   // the game restarted: find the new process next time
      }
    }

    const s: MetricSample = {
      t: now, online: liveNums.online, fps: liveNums.fps, ai: liveNums.ai, cpu,
      gameCpu: gameCpu !== null && gameCpu >= 0 ? gameCpu : null, gameRss,
      memUsed: m ? m.totalMb - m.availableMb : null, memTotal: m?.totalMb ?? null, swapUsed: m?.swapUsedMb ?? null,
    };
    this.#samples.push(s);
    while (this.#samples.length > 0 && now - (this.#samples[0] as MetricSample).t > KEEP_S) this.#samples.shift();
    await appendFile(this.#file, JSON.stringify(s) + '\n', 'utf8').catch((e: unknown) => console.error('[metrics] write failed:', e));
    return s;
  }

  start(): void {
    void this.load().catch((e: unknown) => console.error('[metrics] load failed:', e));
    setInterval(() => {
      this.sample().catch((e: unknown) => console.error('[metrics] sample failed:', e));
    }, SAMPLE_MS);
  }

  /** The panel's view: the latest sample, the range downsampled, and the capacity table. */
  view(rangeS: number, now = Math.floor(Date.now() / 1000)): {
    now: MetricSample | null; cores: number; points: MetricPoint[]; capacity: CapacityRow[]; rangeS: number;
  } {
    return {
      now: this.#samples[this.#samples.length - 1] ?? null,
      cores: this.cores,
      points: downsample(this.#samples, now - rangeS, now, 360),
      capacity: capacity(this.#samples),
      rangeS,
    };
  }
}
