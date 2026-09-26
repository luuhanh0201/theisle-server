import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import type { ServiceControl, UnitState, Verb } from './service.js';
import { ConflictError, ValidationError } from './garage.js';
import { audit } from './audit.js';
import { currentMessages, leftVars, renderMessage } from './messages.js';

/**
 * Start / stop / restart the game server from the panel, politely:
 *
 *   countdown   announce over RCON at fixed marks (15m … 10s), cancellable
 *   save        RCON Save, then a short pause so it can flush
 *   systemctl   sudo -n systemctl <verb> theisle.service
 *   wait        until the mods report "loaded" again (StatsLogger's
 *               mod_loaded event), so "done" means players can actually join
 *
 * One operation at a time. The clock and sleep are injected so the tests run
 * the whole sequence instantly.
 */

export type Phase = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed' | 'unknown';
export type Source = 'admin' | 'schedule' | 'config';
export type Step =
  | 'countdown' | 'saving' | 'stopping' | 'restarting' | 'backup' | 'starting' | 'waiting'
  | 'done' | 'failed' | 'cancelled';

export interface Operation {
  id: number;
  kind: Verb;
  source: Source;
  reason: string;
  startedAt: number;
  /** Unix ms when the stop/restart itself happens (after the countdown). */
  runAt: number;
  step: Step;
  finishedAt: number | null;
  /** Failure, or a warning on success (e.g. mods never reported in). */
  message: string | null;
}

export interface GameStatus {
  phase: Phase;
  unit: UnitState | null;
  /** Latest StatsLogger mod_loaded, unix seconds. */
  modsLoadedAt: number | null;
  error?: string;
}

interface RconLike {
  readonly enabled: boolean;
  run(name: string, args?: unknown): Promise<string>;
}

export interface PowerDeps {
  service: ServiceControl;
  rcon: RconLike;
  modsLoadedAt: () => number | null;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /**
   * Work to do while the game is DOWN during a restart (the daily backup,
   * backup.ts): when wanted(op), the restart is a stop, then run(op), then a
   * start. A failure of run() is reported and the server still starts.
   */
  pause?: { wanted(op: Operation): Promise<boolean>; run(op: Operation): Promise<void> };
  /** How long to wait for the mods after a start, and how often to look. */
  readyTimeoutMs?: number;
  pollMs?: number;
}

const SAVE_SETTLE_MS = 5000;
const MAX_COUNTDOWN_S = 30 * 60;

function realSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('cancelled'));
    const t = setTimeout(resolve, Math.max(0, ms));
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('cancelled')); }, { once: true });
  });
}

/** The in-game notice, as edited on the panel (messages.ts): null = turned off. */
function notice(kind: Verb, seconds: number | null, reason = ''): string | null {
  const which = kind === 'stop' ? 'stop' : 'restart';
  return seconds === null
    ? renderMessage(`server.${which}.now`)
    : renderMessage(`server.${which}.countdown`, { ...leftVars(seconds), reason });
}

export class Power {
  readonly #d: Required<PowerDeps>;
  #current: Operation | null = null;
  #last: Operation | null = null;
  #abort: AbortController | null = null;
  #nextId = 1;

  constructor(deps: PowerDeps) {
    this.#d = {
      now: () => Date.now(),
      sleep: realSleep,
      readyTimeoutMs: 10 * 60_000,
      pollMs: 5000,
      pause: { wanted: async () => false, run: async () => undefined },
      ...deps,
    };
  }

  get current(): Operation | null { return this.#current; }
  get last(): Operation | null { return this.#last; }

  async status(): Promise<GameStatus> {
    const modsLoadedAt = this.#d.modsLoadedAt();
    let unit: UnitState;
    try {
      unit = await this.#d.service.state();
    } catch (error) {
      return { phase: 'unknown', unit: null, modsLoadedAt, error: (error as Error).message };
    }
    return { phase: phaseOf(unit, modsLoadedAt), unit, modsLoadedAt };
  }

  /**
   * Begin an operation; resolves as soon as it is accepted, the work runs on.
   * `countdownSeconds` applies to stop and restart (players get warned).
   */
  request(kind: Verb, opts: { countdownSeconds?: number; reason?: string; source?: Source } = {}): Operation {
    if (this.#current !== null) {
      throw new ConflictError(`another operation is in progress (${this.#current.kind}, ${this.#current.step})`);
    }
    const countdown = kind === 'start' ? 0 : Math.round(opts.countdownSeconds ?? 0);
    if (!Number.isFinite(countdown) || countdown < 0 || countdown > MAX_COUNTDOWN_S) {
      throw new ValidationError(`countdown must be 0–${MAX_COUNTDOWN_S} seconds`);
    }
    const now = this.#d.now();
    const op: Operation = {
      id: this.#nextId++,
      kind,
      source: opts.source ?? 'admin',
      reason: (opts.reason ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200),
      startedAt: now,
      runAt: now + countdown * 1000,
      step: countdown > 0 ? 'countdown' : kind === 'start' ? 'starting' : kind === 'stop' ? 'stopping' : 'restarting',
      finishedAt: null,
      message: null,
    };
    this.#current = op;
    this.#abort = new AbortController();
    void this.#run(op, this.#abort.signal);
    return op;
  }

  /** Cancel during the countdown only — once systemctl runs it is too late. */
  cancel(): boolean {
    if (this.#current === null || this.#current.step !== 'countdown') return false;
    this.#abort?.abort();
    return true;
  }

  async #announce(text: string | null): Promise<void> {
    if (text === null || !this.#d.rcon.enabled) return;
    try {
      await this.#d.rcon.run('announce', text);
    } catch (error) {
      console.warn('[power] announce failed:', (error as Error).message);
    }
  }

  async #run(op: Operation, signal: AbortSignal): Promise<void> {
    const { sleep, now } = this.#d;
    try {
      // --- countdown ------------------------------------------------------
      if (op.step === 'countdown') {
        const total = Math.round((op.runAt - now()) / 1000);
        await this.#announce(notice(op.kind, total, op.reason));
        // When to announce: the panel's marks, read when the countdown starts.
        for (const mark of currentMessages().countdownMarks) {
          if (mark >= total) continue;
          await sleep(op.runAt - mark * 1000 - now(), signal);
          await this.#announce(notice(op.kind, mark));
        }
        await sleep(op.runAt - now(), signal);
      }

      // --- save, then act ---------------------------------------------------
      if (op.kind !== 'start') {
        if (this.#d.rcon.enabled) {
          op.step = 'saving';
          try {
            await this.#d.rcon.run('save');
          } catch (error) {
            // A failed save is reported but does not block an admin-requested stop.
            op.message = `RCON Save failed: ${(error as Error).message}`;
          }
          await sleep(SAVE_SETTLE_MS, signal).catch(() => undefined);
        }
        await this.#announce(notice(op.kind, null));
      }
      if (op.kind === 'restart' && await this.#d.pause.wanted(op).catch(() => false)) {
        op.step = 'stopping';
        await this.#d.service.run('stop');
        op.step = 'backup';
        try {
          await this.#d.pause.run(op);
        } catch (error) {
          op.message = (op.message ? op.message + ' · ' : '') + `backup failed: ${(error as Error).message}`;
        }
        op.step = 'starting';
        await this.#d.service.run('start');
      } else {
        op.step = op.kind === 'stop' ? 'stopping' : op.kind === 'start' ? 'starting' : 'restarting';
        await this.#d.service.run(op.kind);
      }

      // --- wait until players can join ------------------------------------
      if (op.kind !== 'stop') {
        op.step = 'waiting';
        const since = Math.floor(now() / 1000) - 5;
        const deadline = now() + this.#d.readyTimeoutMs;
        let ready = false;
        while (now() < deadline) {
          const loaded = this.#d.modsLoadedAt();
          if (loaded !== null && loaded >= since) { ready = true; break; }
          await sleep(this.#d.pollMs, new AbortController().signal);
        }
        if (!ready) {
          op.message = (op.message ? op.message + ' · ' : '')
            + 'the unit is up but the mods have not reported "loaded" yet — check UE4SS.log';
        }
      }
      op.step = 'done';
      await audit({ action: `server ${op.kind}`, detail: detailOf(op), ok: true, ...(op.message ? { error: op.message } : {}) });
    } catch (error) {
      if (signal.aborted) {
        op.step = 'cancelled';
        await this.#announce(renderMessage(op.kind === 'stop' ? 'server.stop.cancelled' : 'server.restart.cancelled'));
        await audit({ action: `server ${op.kind} cancelled`, detail: detailOf(op), ok: true });
      } else {
        op.step = 'failed';
        op.message = (error as Error).message;
        await audit({ action: `server ${op.kind}`, detail: detailOf(op), ok: false, error: op.message });
      }
    } finally {
      op.finishedAt = now();
      this.#last = op;
      this.#current = null;
      this.#abort = null;
    }
  }
}

function detailOf(op: Operation): string {
  const countdown = Math.round((op.runAt - op.startedAt) / 1000);
  return [op.source, countdown > 0 ? `countdown ${countdown}s` : '', op.reason].filter(Boolean).join(' · ');
}

export function phaseOf(unit: UnitState, modsLoadedAt: number | null): Phase {
  switch (unit.activeState) {
    case 'active':
      // Up as far as systemd knows; "running" once the mods loaded after it.
      return unit.since !== null && modsLoadedAt !== null && modsLoadedAt >= unit.since - 5
        ? 'running' : 'starting';
    case 'activating':
    case 'reloading':
      return 'starting';
    case 'deactivating':
      return 'stopping';
    case 'inactive':
      return 'stopped';
    case 'failed':
      return 'failed';
    default:
      return 'unknown';
  }
}

// --- daily restart schedule -----------------------------------------------

export interface Schedule {
  /** Local server times, "HH:MM". */
  daily: string[];
  countdownMinutes: number;
  /** Occurrence key ("YYYY-MM-DD HH:MM") of the last one fired. */
  lastFired: string | null;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const schedulePath = (): string => join(config.dataDir, 'power-schedule.json');

export function validateSchedule(raw: unknown): Pick<Schedule, 'daily' | 'countdownMinutes'> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const daily = Array.isArray(r['daily']) ? r['daily'].map(String).map((s) => s.trim()) : [];
  const bad = daily.find((t) => !TIME_RE.test(t));
  if (bad !== undefined) throw new ValidationError(`time must be HH:MM (24h): ${bad}`);
  if (daily.length > 6) throw new ValidationError('at most 6 restarts a day');
  const countdownMinutes = Number(r['countdownMinutes'] ?? 5);
  if (!Number.isInteger(countdownMinutes) || countdownMinutes < 0 || countdownMinutes > 30) {
    throw new ValidationError('countdownMinutes must be a whole number 0–30');
  }
  return { daily: [...new Set(daily)].sort(), countdownMinutes };
}

export async function readSchedule(): Promise<Schedule> {
  try {
    const data = JSON.parse(await readFile(schedulePath(), 'utf8')) as Schedule;
    return { daily: data.daily ?? [], countdownMinutes: data.countdownMinutes ?? 5, lastFired: data.lastFired ?? null };
  } catch {
    return { daily: [], countdownMinutes: 5, lastFired: null };
  }
}

export async function writeSchedule(s: Schedule): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  const tmp = `${schedulePath()}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), 'utf8');
  await rename(tmp, schedulePath());
}

const pad = (n: number): string => String(n).padStart(2, '0');
const keyOf = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Upcoming occurrences (server local time), soonest first. */
export function occurrences(s: Pick<Schedule, 'daily'>, nowMs: number): Date[] {
  const out: Date[] = [];
  for (const dayOffset of [0, 1]) {
    for (const hm of s.daily) {
      const [h, m] = hm.split(':').map(Number) as [number, number];
      const d = new Date(nowMs);
      d.setDate(d.getDate() + dayOffset);
      d.setHours(h, m, 0, 0);
      out.push(d);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Called every few seconds. Starts the restart when an occurrence's countdown
 * window opens, so the restart itself lands on the scheduled minute. A missed
 * window (bridge down) is not replayed later than 2 minutes after the time.
 */
export async function scheduleTick(power: Power, nowMs = Date.now()): Promise<void> {
  const s = await readSchedule();
  if (s.daily.length === 0) return;
  for (const at of occurrences(s, nowMs)) {
    const key = keyOf(at);
    const opensAt = at.getTime() - s.countdownMinutes * 60_000;
    if (nowMs < opensAt || nowMs > at.getTime() + 120_000 || s.lastFired === key) continue;
    s.lastFired = key;
    await writeSchedule(s);   // before requesting: never fire the same slot twice
    try {
      power.request('restart', {
        countdownSeconds: Math.max(0, Math.round((at.getTime() - nowMs) / 1000)),
        reason: renderMessage('server.scheduledReason', { time: key.slice(11) }) ?? '',
        source: 'schedule',
      });
    } catch (error) {
      await audit({ action: 'server restart (schedule)', detail: key, ok: false, error: (error as Error).message });
    }
    return;
  }
}
