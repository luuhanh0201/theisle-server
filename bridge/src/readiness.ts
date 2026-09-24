import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';

/**
 * "Can players see and join the server?", answered from the server side.
 *
 * The in-game browser lists servers from Epic Online Services; the panel
 * cannot read that list (see docs/NHAT-KY-VAN-HANH.md). What it can check is
 * every precondition the game needs to be listed and joinable, each one from
 * a primary source: systemd, the mods' own "loaded" event, the game's log
 * (world up, EOS sign-in) and the kernel's socket tables (/proc/net) for the
 * ports. All reads, nothing executed.
 */

export interface GameLogFacts {
  /** First timestamped line: when this log file (= this server run) began. */
  startedAt: number | null;
  mapLoadedAt: number | null;
  map: string | null;
  /** "Local user 0 is now signed in as (dedicated server)". */
  eosSignedIn: boolean;
  /** First EOS error line, if any. */
  eosError: string | null;
}

// UE log prefix: [2026.09.23-20.52.25:043] — UTC.
const STAMP = /^\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):\d{3}\]/;

function stampOf(line: string): number | null {
  const m = STAMP.exec(line);
  if (m === null) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  return Math.floor(Date.UTC(y as number, (mo as number) - 1, d as number, h as number, mi as number, s as number) / 1000);
}

export function parseGameLog(text: string): GameLogFacts {
  const facts: GameLogFacts = { startedAt: null, mapLoadedAt: null, map: null, eosSignedIn: false, eosError: null };
  for (const line of text.split(/\r?\n/)) {
    const t = stampOf(line);
    if (t !== null && facts.startedAt === null) facts.startedAt = t;
    const world = /Bringing World (\S+) up for play/.exec(line);
    if (world !== null) {
      facts.map = (world[1] as string).split('/').pop()?.split('.')[0] ?? world[1] as string;
      facts.mapLoadedAt = t;
    }
    if (line.includes('Local user 0 is now signed in as (dedicated server)')) facts.eosSignedIn = true;
    if (facts.eosError === null && /Log(OnlineSubsystem)?RedpointEOS\w*: Error:/.test(line)) {
      facts.eosError = line.replace(STAMP, '').replace(/^\[\s*\d+\]/, '').trim().slice(0, 200);
    }
  }
  return facts;
}

/**
 * Local ports with a listening/bound socket in a /proc/net/{tcp,udp}[6] table.
 * TCP counts only LISTEN (state 0A); UDP counts every bound socket (07 = unconnected).
 */
export function parseProcNet(text: string, proto: 'tcp' | 'udp'): Set<number> {
  const ports = new Set<number>();
  for (const line of text.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const local = cols[1] as string;
    const state = cols[3] as string;
    const port = Number.parseInt(local.slice(local.lastIndexOf(':') + 1), 16);
    if (!Number.isFinite(port)) continue;
    if (proto === 'tcp' ? state === '0A' : true) ports.add(port);
  }
  return ports;
}

async function readProcNet(proto: 'tcp' | 'udp'): Promise<Set<number>> {
  const out = new Set<number>();
  for (const file of [proto, `${proto}6`]) {
    try {
      for (const p of parseProcNet(await readFile(`/proc/net/${file}`, 'utf8'), proto)) out.add(p);
    } catch {
      // No IPv6 table on this host — the other one still counts.
    }
  }
  return out;
}

/** The first `head` bytes plus the last `tail` bytes: startup lines sit at the top. */
async function readHeadTail(path: string, head = 512 * 1024, tail = 256 * 1024): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    if (size <= head + tail) return (await fh.readFile()).toString('utf8');
    const a = Buffer.alloc(head);
    const b = Buffer.alloc(tail);
    await fh.read(a, 0, head, 0);
    await fh.read(b, 0, tail, size - tail);
    return `${a.toString('utf8')}\n${b.toString('utf8')}`;
  } finally {
    await fh.close();
  }
}

export type CheckState = 'ok' | 'fail' | 'wait';
export interface Check { id: string; label: string; state: CheckState; detail: string; /** Unix seconds the check turned ok. */ at?: number }
export interface Readiness {
  verdict: 'ready' | 'starting' | 'down' | 'problem';
  summary: string;
  checks: Check[];
  lastJoin: { t: number; name?: string } | null;
  checkedAt: number;
}

/**
 * The server list is served by Warp Hosting's API (api.warphosting.com.au —
 * the URLs are in the server binary: /v1/presence/server, /v1/servers/active…),
 * not read from EOS by the client. Its list endpoint needs a Steam ticket from
 * a player's client, so the panel cannot read the list itself; it can check
 * that the API is up and reachable from this VPS — when it is not, servers
 * drop off the in-game list while running fine. A GET is answered 405 without
 * the API doing any work; checked at most every 5 minutes.
 */
export const LIST_API = 'https://api.warphosting.com.au/v1/servers/active';
export interface ListApiState { ok: boolean; detail: string; at: number }
let listCache: ListApiState | null = null;

export async function checkListApi(now: number, fetchImpl: typeof fetch = fetch): Promise<ListApiState> {
  if (listCache !== null && now - listCache.at < 300) return listCache;
  let state: ListApiState;
  try {
    const res = await fetchImpl(LIST_API, { method: 'GET', signal: AbortSignal.timeout(8000) });
    state = res.status < 500
      ? { ok: true, detail: `api.warphosting.com.au trả lời (HTTP ${res.status})`, at: now }
      : { ok: false, detail: `api.warphosting.com.au lỗi HTTP ${res.status} — danh sách server có thể không cập nhật`, at: now };
  } catch (error) {
    state = { ok: false, detail: `không gọi được api.warphosting.com.au từ VPS: ${(error as Error).message}`, at: now };
  }
  listCache = state;
  return state;
}

export interface ReadinessInput {
  unit: { activeState: string; since: number | null } | null;
  phase: string;
  modsLoadedAt: number | null;
  lastJoin: { t: number; name?: string } | null;
}

/** Pure: the checklist from facts already read. Exported for the tests. */
export function assess(input: ReadinessInput, log: GameLogFacts | null, logError: string | null,
  ports: { udp: Set<number>; tcp: Set<number> }, want: { game: number; queue: number | null; rcon: number | null },
  now: number, listApi: ListApiState | null = null): Readiness {
  const checks: Check[] = [];
  const up = input.unit?.activeState === 'active';
  const since = input.unit?.since ?? null;
  // The log belongs to this run only if it started after the unit did.
  const logIsCurrent = log !== null && log.startedAt !== null && since !== null && log.startedAt >= since - 120;

  checks.push({ id: 'unit', label: 'Tiến trình game (systemd)', state: up ? 'ok' : input.phase === 'starting' ? 'wait' : 'fail',
    detail: input.unit ? `${input.unit.activeState}` : 'không đọc được systemd',
    ...(up && since !== null ? { at: since } : {}) });
  checks.push({ id: 'mods', label: 'Mod đã nạp', state: input.phase === 'running' ? 'ok' : up ? 'wait' : 'fail',
    detail: input.phase === 'running' ? 'StatsLogger / DinoGarage đã báo loaded' : 'chưa báo loaded',
    ...(input.phase === 'running' && input.modsLoadedAt ? { at: input.modsLoadedAt } : {}) });
  if (logError !== null) {
    checks.push({ id: 'log', label: 'Log game', state: 'fail', detail: logError });
  } else {
    const mapOk = logIsCurrent && log?.mapLoadedAt;
    checks.push({ id: 'map', label: 'Map đã tải xong', state: mapOk ? 'ok' : up ? 'wait' : 'fail',
      detail: mapOk ? `${log?.map}` : 'chưa thấy "Bringing World … up for play"',
      ...(mapOk && log?.mapLoadedAt ? { at: log.mapLoadedAt } : {}) });
    checks.push({ id: 'eos', label: 'Đăng nhập EOS (để lên danh sách server)',
      state: logIsCurrent && log?.eosError ? 'fail' : logIsCurrent && log?.eosSignedIn ? 'ok' : up ? 'wait' : 'fail',
      detail: logIsCurrent && log?.eosError ? log.eosError : logIsCurrent && log?.eosSignedIn ? 'đã đăng nhập (dedicated server)' : 'chưa thấy dòng đăng nhập EOS' });
  }
  const port = (id: string, label: string, n: number | null, set: Set<number>, proto: string): void => {
    if (n === null) return;
    checks.push({ id, label: `${label} ${n}/${proto}`, state: set.has(n) ? 'ok' : up ? 'wait' : 'fail',
      detail: set.has(n) ? 'đang nghe' : 'chưa nghe' });
  };
  port('port-game', 'Cổng game', want.game, ports.udp, 'udp');
  port('port-queue', 'Cổng hàng chờ', want.queue, ports.tcp, 'tcp');
  port('port-rcon', 'Cổng RCON', want.rcon, ports.tcp, 'tcp');
  if (listApi !== null) {
    checks.push({ id: 'list-api', label: 'Máy chủ danh sách server (Warp)', state: listApi.ok ? 'ok' : 'fail',
      detail: listApi.detail, at: listApi.at });
  }

  const failed = checks.filter((c) => c.state === 'fail');
  const waiting = checks.filter((c) => c.state === 'wait');
  const verdict: Readiness['verdict'] = !up ? (input.phase === 'starting' ? 'starting' : 'down')
    : failed.length > 0 ? 'problem' : waiting.length > 0 ? 'starting' : 'ready';
  const summary = {
    ready: 'Đủ điều kiện hiển thị và nhận người chơi',
    starting: `Đang khởi động — còn chờ: ${waiting.map((c) => c.label).join(', ')}`,
    down: 'Server không chạy',
    problem: `Có lỗi: ${failed.map((c) => c.label).join(', ')}`,
  }[verdict];
  return { verdict, summary, checks, lastJoin: input.lastJoin, checkedAt: now };
}

let cache: { at: number; value: Readiness } | null = null;

/** Reads everything, at most once every 5 s (the panel polls every 2 s). */
export async function readReadiness(input: ReadinessInput): Promise<Readiness> {
  const now = Math.floor(Date.now() / 1000);
  if (cache !== null && Date.now() - cache.at < 5000) return { ...cache.value, lastJoin: input.lastJoin };
  let log: GameLogFacts | null = null;
  let logError: string | null = null;
  try {
    log = parseGameLog(await readHeadTail(config.game.logPath));
  } catch (error) {
    logError = `không đọc được ${config.game.logPath}: ${(error as Error).message}`;
  }
  // Queue and RCON ports as the live Game.ini has them.
  let queue: number | null = null;
  let rcon: number | null = config.rcon.password ? config.rcon.port : null;
  try {
    const ini = await readFile(join(config.game.configDir, 'Game.ini'), 'utf8');
    const q = /^QueuePort=(\d+)/m.exec(ini);
    const enabled = !/^bQueueEnabled=false/im.test(ini);
    if (q && enabled) queue = Number(q[1]);
    const r = /^RconPort=(\d+)/m.exec(ini);
    if (r && /^bRconEnabled=true/im.test(ini)) rcon = Number(r[1]);
  } catch {
    // The checklist still reports the game port and the log.
  }
  const [udp, tcp, listApi] = await Promise.all([readProcNet('udp'), readProcNet('tcp'), checkListApi(now)]);
  const value = assess(input, log, logError, { udp, tcp }, { game: config.game.port, queue, rcon }, now, listApi);
  cache = { at: Date.now(), value };
  return value;
}
