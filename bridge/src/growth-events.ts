import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ValidationError } from './garage.js';

/**
 * Growth events (panel → Server → Vận hành, "Sự kiện tốc độ lớn"): from a
 * start to an end, the server's GrowthMultiplier is the event's (×2 for a
 * weekend…), then back to the panel's own value.
 *
 * Applied at the game's START only (the owner's call, 2026-10-02): Game.ini
 * is read once by the game, and an RCON change while it runs is unverified.
 * theisle.service ExecStartPre runs cli-apply-settings.js, which writes the
 * multiplier of the event running at that moment (effectiveGrowth) and leaves
 * growth-applied.json saying what it wrote; so an event starts and ends at the
 * restart nearest to its times (the daily schedule, a manual restart, a crash).
 * The bridge reads growth-applied.json after a start to tell players.
 *
 * Files next to game-settings.json (the bridge's data dir).
 */

export interface GrowthEvent {
  id: string;
  /** Epoch seconds. */
  start: number;
  end: number;
  multiplier: number;
  note: string | null;
  createdBy: string | null;
}
/** What the last start wrote to Game.ini. */
export interface GrowthApplied {
  at: number;
  multiplier: number;
  /** The event it came from, or null: the panel's own value. */
  event: { id: string; end: number; note: string | null } | null;
  /** The event the start before had and this one has not: it ended (told to the players once). */
  ended?: { id: string; multiplier: number; note: string | null } | null;
}

/**
 * What to tell the players once the game is up after a start (index.ts): the
 * event running, or the one that has just ended; null = nothing. `applied`
 * must come from this start (written at most `withinS` before the mods loaded).
 */
export function startNotice(applied: GrowthApplied | null, loadedAt: number, withinS = 1800):
  { key: 'growth.event.on'; vars: Record<string, string> } | { key: 'growth.event.off'; vars: Record<string, string> } | null {
  if (applied === null || applied.at > loadedAt || loadedAt - applied.at > withinS) return null;
  const end = new Date(applied.event?.end ? applied.event.end * 1000 : 0);
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (applied.event) {
    return { key: 'growth.event.on', vars: { multiplier: String(applied.multiplier), note: applied.event.note ?? '',
      until: `${pad(end.getHours())}:${pad(end.getMinutes())} ${pad(end.getDate())}/${pad(end.getMonth() + 1)}` } };
  }
  if (applied.ended) return { key: 'growth.event.off', vars: { multiplier: String(applied.ended.multiplier), note: applied.ended.note ?? '' } };
  return null;
}

export const GROWTH_MIN = 0.1;
export const GROWTH_MAX = 20;
const MAX_EVENTS = 50;

const eventsPath = (dir: string): string => join(dir, 'growth-events.json');
const appliedPath = (dir: string): string => join(dir, 'growth-applied.json');

function readJson<T>(path: string, empty: T): T {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return empty; }
}
function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2), 'utf8');
  renameSync(`${path}.tmp`, path);
}

export function readGrowthEvents(dir: string): GrowthEvent[] {
  const d = readJson<{ events?: GrowthEvent[] }>(eventsPath(dir), {});
  return (Array.isArray(d.events) ? d.events : []).sort((a, b) => a.start - b.start);
}
export function writeGrowthEvents(dir: string, events: GrowthEvent[]): void {
  writeJson(eventsPath(dir), { events });
}
export function readGrowthApplied(dir: string): GrowthApplied | null {
  return readJson<GrowthApplied | null>(appliedPath(dir), null);
}
export function writeGrowthApplied(dir: string, a: GrowthApplied): void {
  writeJson(appliedPath(dir), a);
}

/** The event running at `nowS` (the latest started when two overlap), or null. */
export function activeGrowthEvent(events: readonly GrowthEvent[], nowS: number): GrowthEvent | null {
  let best: GrowthEvent | null = null;
  for (const e of events) if (e.start <= nowS && nowS < e.end && (best === null || e.start > best.start)) best = e;
  return best;
}

/** The multiplier a start at `nowS` writes: the running event's, else the panel's (`base`). */
export function effectiveGrowth(base: number, events: readonly GrowthEvent[], nowS: number): { multiplier: number; event: GrowthEvent | null } {
  const e = activeGrowthEvent(events, nowS);
  return { multiplier: e ? e.multiplier : base, event: e };
}

/** A new event from the panel, checked. */
export function validateGrowthEvent(raw: unknown, nowS: number): Pick<GrowthEvent, 'start' | 'end' | 'multiplier' | 'note'> {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('event must be an object');
  const r = raw as Record<string, unknown>;
  const { start, end, multiplier } = r;
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end)) {
    throw new ValidationError('start and end must be epoch seconds');
  }
  if (end <= start) throw new ValidationError('Kết thúc phải sau bắt đầu');
  if (end <= nowS) throw new ValidationError('Sự kiện đã kết thúc trong quá khứ');
  if (end - start > 31 * 86400) throw new ValidationError('Một sự kiện dài tối đa 31 ngày');
  if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier < GROWTH_MIN || multiplier > GROWTH_MAX) {
    throw new ValidationError(`Hệ số phải từ ${GROWTH_MIN} đến ${GROWTH_MAX}`);
  }
  const note = typeof r['note'] === 'string' && r['note'].trim() !== '' ? r['note'].trim().slice(0, 80) : null;
  return { start, end, multiplier: Math.round(multiplier * 100) / 100, note };
}

export function addGrowthEvent(dir: string, raw: unknown, by: string | null, nowS = Math.floor(Date.now() / 1000)): GrowthEvent {
  const def = validateGrowthEvent(raw, nowS);
  // Ended ones are dropped as new ones come in.
  const kept = readGrowthEvents(dir).filter((e) => e.end > nowS);
  if (kept.length >= MAX_EVENTS) throw new ValidationError(`Tối đa ${MAX_EVENTS} sự kiện`);
  const ev: GrowthEvent = { id: `ge_${randomBytes(4).toString('hex')}`, ...def, createdBy: by };
  writeGrowthEvents(dir, [...kept, ev]);
  return ev;
}

export function removeGrowthEvent(dir: string, id: string): GrowthEvent | null {
  const all = readGrowthEvents(dir);
  const gone = all.find((e) => e.id === id) ?? null;
  if (gone) writeGrowthEvents(dir, all.filter((e) => e.id !== id));
  return gone;
}

/** The first daily restart (["06:00", …], server local time) at or after `tS`, epoch seconds; null with no schedule. */
export function firstDailyAt(daily: readonly string[], tS: number): number | null {
  if (daily.length === 0) return null;
  for (let day = 0; day <= 32; day++) {
    const times = daily.map((hm) => {
      const [h, m] = hm.split(':').map(Number) as [number, number];
      const d = new Date(tS * 1000);
      d.setDate(d.getDate() + day);
      d.setHours(h, m, 0, 0);
      return Math.floor(d.getTime() / 1000);
    }).filter((x) => x >= tS).sort((a, b) => a - b);
    if (times.length > 0) return times[0] as number;
  }
  return null;
}
