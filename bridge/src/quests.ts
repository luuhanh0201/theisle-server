import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';
import { CURRENCY, credit, dayOf, type PlayDays } from './economy.js';
import { SPECIES_DIET, speciesKey } from './items.js';
import { killCounts } from './store.js';

/**
 * The daily quests (owner, 2026-10-05): each player gets `perDay` quests a day among the ones on (their
 * diet's: no hunting for a herbivore), and one weekly quest; each pays Hổ phách once done, taken on the
 * home page. Tried by SVip first (svip.ts feature 'quests'); the list and rewards are the panel's
 * (Nhiệm vụ).
 *
 * Progress comes from the game's own events, read again from the start at every bridge start (nothing
 * of it is kept): minutes in game, minutes alive without dying, kills as the kill board counts them
 * (admins never), growth gained, distance walked, named places reached, prime tasks done.
 *
 *   data/quests-settings.json   QuestSettings
 *   data/quests.json            { players: { <steamId>: Assigned } }   what each got, what was taken
 */

export const QUEST_KINDS = {
  play: { label: 'Chơi trong game', unit: 'phút' },
  survive: { label: 'Sống sót liên tục không chết', unit: 'phút' },
  kills: { label: 'Hạ dino (đúng luật bảng kill)', unit: 'con' },
  growth: { label: 'Lớn thêm', unit: '%' },
  distance: { label: 'Đi đường', unit: 'km' },
  visit: { label: 'Ghé địa danh / hồ có tên', unit: 'nơi' },
  prime: { label: 'Hoàn thành nhiệm vụ prime', unit: 'nhiệm vụ' },
} as const;
export type QuestKind = keyof typeof QUEST_KINDS;
export type QuestDiet = 'all' | 'carnivore' | 'herbivore';
export type QuestPeriod = 'day' | 'week';

export interface QuestDef {
  id: string;
  kind: QuestKind;
  label: string;
  target: number;
  reward: number;
  diet: QuestDiet;
  period: QuestPeriod;
  enabled: boolean;
}
export interface QuestSettings { perDay: number; defs: QuestDef[] }

export const QUEST_DEFAULTS: QuestSettings = {
  perDay: 3,
  defs: [
    { id: 'play60', kind: 'play', label: 'Chơi 60 phút', target: 60, reward: 40, diet: 'all', period: 'day', enabled: true },
    { id: 'survive90', kind: 'survive', label: 'Sống sót 90 phút không chết', target: 90, reward: 80, diet: 'all', period: 'day', enabled: true },
    { id: 'kills2', kind: 'kills', label: 'Hạ 2 dino', target: 2, reward: 100, diet: 'carnivore', period: 'day', enabled: true },
    { id: 'growth10', kind: 'growth', label: 'Lớn thêm 10%', target: 10, reward: 60, diet: 'all', period: 'day', enabled: true },
    { id: 'walk5', kind: 'distance', label: 'Đi 5 km', target: 5, reward: 50, diet: 'all', period: 'day', enabled: true },
    { id: 'visit2', kind: 'visit', label: 'Ghé 2 địa danh', target: 2, reward: 70, diet: 'all', period: 'day', enabled: true },
    { id: 'prime1', kind: 'prime', label: 'Hoàn thành 1 nhiệm vụ prime', target: 1, reward: 80, diet: 'all', period: 'day', enabled: true },
    { id: 'week-play', kind: 'play', label: 'Chơi 10 giờ trong tuần', target: 600, reward: 400, diet: 'all', period: 'week', enabled: true },
    { id: 'week-grow', kind: 'growth', label: 'Lớn thêm 50% trong tuần', target: 50, reward: 600, diet: 'all', period: 'week', enabled: true },
    { id: 'week-kills', kind: 'kills', label: 'Hạ 15 dino trong tuần', target: 15, reward: 500, diet: 'carnivore', period: 'week', enabled: true },
  ],
};

/** Monday-based week number of a Vietnam day (day 0 = 1970-01-01 was a Thursday). */
export const weekOf = (day: number): number => Math.floor((day + 3) / 7);

// --- settings -----------------------------------------------------------------------------------

export function validateQuestSettings(raw: unknown): QuestSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const perDay = r['perDay'] ?? QUEST_DEFAULTS.perDay;
  if (typeof perDay !== 'number' || !Number.isInteger(perDay) || perDay < 0 || perDay > 10) throw new ValidationError('perDay must be 0–10');
  const defs = r['defs'] ?? QUEST_DEFAULTS.defs;
  if (!Array.isArray(defs) || defs.length > 60) throw new ValidationError('defs must be a list (at most 60)');
  const ids = new Set<string>();
  const out = defs.map((d, i) => {
    const o = (typeof d === 'object' && d !== null ? d : {}) as Record<string, unknown>;
    const at = `quest ${i + 1}`;
    const id = typeof o['id'] === 'string' ? o['id'].trim() : '';
    if (!/^[\w-]{1,40}$/.test(id) || ids.has(id)) throw new ValidationError(`${at}: id must be 1–40 letters / digits / - and unique`);
    ids.add(id);
    const kind = o['kind'];
    if (typeof kind !== 'string' || !(kind in QUEST_KINDS)) throw new ValidationError(`${at}: unknown kind`);
    const label = typeof o['label'] === 'string' ? o['label'].trim() : '';
    if (label.length < 1 || label.length > 80) throw new ValidationError(`${at}: label must be 1–80 characters`);
    const num = (v: unknown, what: string, lo: number, hi: number): number => {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new ValidationError(`${at}: ${what} must be ${lo}–${hi}`);
      return Math.round(v * 100) / 100;
    };
    const diet = o['diet'] ?? 'all';
    if (diet !== 'all' && diet !== 'carnivore' && diet !== 'herbivore') throw new ValidationError(`${at}: diet must be all, carnivore or herbivore`);
    const period = o['period'] ?? 'day';
    if (period !== 'day' && period !== 'week') throw new ValidationError(`${at}: period must be day or week`);
    return {
      id, kind: kind as QuestKind, label, target: num(o['target'], 'target', 0.1, 100_000), reward: Math.round(num(o['reward'], 'reward', 0, 100_000)),
      diet: diet as QuestDiet, period: period as QuestPeriod, enabled: o['enabled'] !== false,
    };
  });
  return { perDay, defs: out };
}

const settingsPath = (): string => join(config.dataDir, 'quests-settings.json');
const statePath = (): string => join(config.dataDir, 'quests.json');

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, path);
}

export async function readQuestSettings(): Promise<QuestSettings> {
  try { return validateQuestSettings(JSON.parse(await readFile(settingsPath(), 'utf8'))); } catch { return structuredClone(QUEST_DEFAULTS); }
}
export async function saveQuestSettings(raw: unknown): Promise<QuestSettings> {
  const s = validateQuestSettings(raw);
  await writeJson(settingsPath(), s);
  return s;
}

// --- progress, from the events ---------------------------------------------------------------------

export interface Place { name: string; x: number; y: number }
/** Within this of a place (world units, cm): reached. */
export const PLACE_RADIUS = 10_000;

interface DayStats { kills: number; growth: number; distance: number; places: Set<string>; prime: number; aliveMax: number }
interface Track {
  /** Online since (null: offline) and alive seconds since the last death, closed sessions only. */
  online: number | null;
  alive: number;
  last: { t: number; x: number; y: number; growth: number; species: string } | null;
  conditions: { species: string; met: Set<string> } | null;
  days: Map<number, DayStats>;
}

/**
 * Each player's progress per Vietnam day. Fed the events and snapshots in file order (index.ts), with
 * the named places of the map; minutes in game come from PlayDays (economy.ts).
 */
export class QuestProgress {
  readonly #players = new Map<string, Track>();

  constructor(private readonly playDays: PlayDays, private readonly places: () => Place[], private readonly isAdmin: (id: string) => boolean = () => false) {}

  #track(id: string): Track {
    let t = this.#players.get(id);
    if (t === undefined) { t = { online: null, alive: 0, last: null, conditions: null, days: new Map() }; this.#players.set(id, t); }
    return t;
  }

  #day(tr: Track, t: number): DayStats {
    const d = dayOf(t);
    let s = tr.days.get(d);
    if (s === undefined) {
      s = { kills: 0, growth: 0, distance: 0, places: new Set(), prime: 0, aliveMax: 0 };
      tr.days.set(d, s);
      for (const k of [...tr.days.keys()]) if (k < d - 8) tr.days.delete(k);
    }
    return s;
  }

  #aliveNow(tr: Track, t: number): number {
    return tr.alive + (tr.online !== null ? Math.max(0, t - tr.online) : 0);
  }

  #noteAlive(tr: Track, t: number): void {
    const s = this.#day(tr, t);
    s.aliveMax = Math.max(s.aliveMax, this.#aliveNow(tr, t));
  }

  onEvent(event: object): void {
    const e = event as Record<string, unknown>;
    const t = e['t'];
    if (typeof t !== 'number') return;
    if (e['type'] === 'mod_loaded') {
      // A server start: every session open then is over (a crash sends no session_end).
      for (const tr of this.#players.values()) if (tr.online !== null) { this.#noteAlive(tr, t); tr.alive = this.#aliveNow(tr, t); tr.online = null; tr.last = null; }
      return;
    }
    const id = e['steamId'];
    if (typeof id !== 'string') return;
    switch (e['type']) {
      case 'session_start': { const tr = this.#track(id); if (tr.online === null) tr.online = t; return; }
      case 'session_end': {
        const tr = this.#track(id);
        if (tr.online !== null) { this.#noteAlive(tr, t); tr.alive = this.#aliveNow(tr, t); tr.online = null; }
        tr.last = null;
        return;
      }
      case 'death': {
        const tr = this.#track(id);
        this.#noteAlive(tr, t);
        tr.alive = 0;
        if (tr.online !== null) tr.online = t;      // the next life counts from now
        tr.last = null; tr.conditions = null;
        const killer = e['killer'];
        if (e['attributed'] === true && typeof killer === 'string' && killer !== id && !this.isAdmin(killer) && !this.isAdmin(id)
          && killCounts(e['killerGrowth'] as number | undefined, e['growth'] as number | undefined)) {
          this.#day(this.#track(killer), t).kills += 1;
        }
        return;
      }
      case 'snapshot': return this.#snapshot(id, t, e);
      case 'prime': return this.#prime(id, t, e);
      default:
    }
  }

  #snapshot(id: string, t: number, e: Record<string, unknown>): void {
    const loc = e['loc'] as { x?: unknown; y?: unknown } | undefined;
    const growth = e['growth'], species = e['species'];
    if (!loc || typeof loc.x !== 'number' || typeof loc.y !== 'number' || typeof growth !== 'number' || typeof species !== 'string') return;
    const tr = this.#track(id);
    const s = this.#day(tr, t);
    const p = tr.last;
    if (p !== null && p.species === species && t - p.t <= 30) {
      // Walked: a jump (respawn, teleport, garage) is not.
      const m = Math.hypot(loc.x - p.x, loc.y - p.y) / 100;
      if (m <= 300) s.distance += m;
      // Grown: little by little; a jump (garage, admin) is not.
      const g = growth - p.growth;
      if (g > 0 && g <= 0.02) s.growth += g;
    }
    tr.last = { t, x: loc.x, y: loc.y, growth, species };
    for (const pl of this.places()) {
      if (!s.places.has(pl.name) && Math.hypot(loc.x - pl.x, loc.y - pl.y) <= PLACE_RADIUS) s.places.add(pl.name);
    }
  }

  #prime(id: string, t: number, e: Record<string, unknown>): void {
    const cond = e['conditions'], species = e['species'];
    if (typeof cond !== 'object' || cond === null || typeof species !== 'string') return;
    const met = new Set(Object.entries(cond as Record<string, unknown>).filter(([, v]) => v === true).map(([k]) => k));
    const tr = this.#track(id);
    const was = tr.conditions;
    if (was !== null && was.species === species) {
      const fresh = [...met].filter((k) => !was.met.has(k)).length;
      // Several at once: a dino out of the garage or set by an admin, not tasks done.
      if (fresh > 0 && fresh <= 2) this.#day(tr, t).prime += fresh;
    }
    tr.conditions = { species, met };
  }

  /** Progress of a quest kind over `days` (one day, or a week's), in the quest's own unit. */
  progress(id: string, kind: QuestKind, days: number[], now: number): number {
    const tr = this.#players.get(id);
    const stats = days.map((d) => tr?.days.get(d)).filter((x): x is DayStats => x !== undefined);
    const today = dayOf(now);
    switch (kind) {
      case 'play': return days.reduce((sum, d) => sum + this.playDays.minutesOn(id, d, now), 0);
      case 'survive': {
        const best = Math.max(0, ...stats.map((s) => s.aliveMax), tr && days.includes(today) ? this.#aliveNow(tr, now) : 0);
        return Math.floor(best / 60);
      }
      case 'kills': return stats.reduce((sum, s) => sum + s.kills, 0);
      // (a hair over, for sums of small floats: 10 × 1 % is 0.0999…)
      case 'growth': return Math.floor(stats.reduce((sum, s) => sum + s.growth, 0) * 1000 + 1e-6) / 10;
      case 'distance': return Math.floor(stats.reduce((sum, s) => sum + s.distance, 0) / 100 + 1e-6) / 10;
      case 'visit': return new Set(stats.flatMap((s) => [...s.places])).size;
      case 'prime': return stats.reduce((sum, s) => sum + s.prime, 0);
      default: return 0;
    }
  }
}

/** The map's named places (gateway.json: landmarks, named waters), in world units. */
export function placesOf(map: { bounds?: unknown; features?: unknown }): Place[] {
  const feats = Array.isArray(map.features) ? map.features as Array<Record<string, unknown>> : [];
  return feats.flatMap((f) => {
    const at = f['at'];
    const name = f['name'] ?? f['text'];
    if ((f['layer'] !== 'landmark' && f['layer'] !== 'water') || !Array.isArray(at) || typeof name !== 'string') return [];
    // Map units are world / 1000, as the game shows a location ("Y, X"): [map x = world y, map y = world x].
    const [mx, my] = at as number[];
    if (typeof mx !== 'number' || typeof my !== 'number') return [];
    return [{ name, x: my * 1000, y: mx * 1000 }];
  });
}

// --- who got which, what was taken ----------------------------------------------------------------

interface Assigned { day: number; daily: string[]; claimed: string[]; week: number; weekly: string | null; weeklyClaimed: boolean }
interface QuestState { players: Record<string, Assigned> }
const readState = async (): Promise<QuestState> => {
  try { return JSON.parse(await readFile(statePath(), 'utf8')) as QuestState; } catch { return { players: {} }; }
};

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

const dietOk = (quest: QuestDiet, species: string | null): boolean => {
  if (quest === 'all') return true;
  const own = species === null ? undefined : SPECIES_DIET[speciesKey(species)];
  return own === quest || own === 'omnivore';
};

/** `n` of `pool`, the same for the same seed (a player's day): shuffled by a hash. */
function pick<T extends { id: string }>(pool: T[], n: number, seed: string): T[] {
  const h = (x: string): string => createHash('sha256').update(`${seed}|${x}`).digest('hex');
  return [...pool].sort((a, b) => h(a.id).localeCompare(h(b.id))).slice(0, n);
}

/** Today's quests (and this week's) for a player — given the first time asked, for the dino played then. */
async function assigned(state: QuestState, s: QuestSettings, id: string, species: string | null, now: number): Promise<{ a: Assigned; changed: boolean }> {
  const day = dayOf(now), week = weekOf(day);
  const a: Assigned = state.players[id] ?? { day: -1, daily: [], claimed: [], week: -1, weekly: null, weeklyClaimed: false };
  let changed = false;
  if (a.day !== day) {
    const pool = s.defs.filter((d) => d.enabled && d.period === 'day' && dietOk(d.diet, species));
    a.day = day; a.daily = pick(pool, s.perDay, `${id}|${day}`).map((d) => d.id); a.claimed = [];
    changed = true;
  }
  if (a.week !== week) {
    const pool = s.defs.filter((d) => d.enabled && d.period === 'week' && dietOk(d.diet, species));
    a.week = week; a.weekly = pick(pool, 1, `${id}|w${week}`)[0]?.id ?? null; a.weeklyClaimed = false;
    changed = true;
  }
  state.players[id] = a;
  return { a, changed };
}

export interface QuestView { id: string; label: string; kind: QuestKind; unit: string; target: number; progress: number; reward: number; done: boolean; claimed: boolean; period: QuestPeriod }

/** A player's quests now, with progress; assigned at the first ask of the day. */
export function questsOf(id: string, species: string | null, progress: QuestProgress, now = Math.floor(Date.now() / 1000)): Promise<{ daily: QuestView[]; weekly: QuestView | null }> {
  return serialized(async () => {
    const s = await readQuestSettings();
    const state = await readState();
    const { a, changed } = await assigned(state, s, id, species, now);
    if (changed) await writeJson(statePath(), state);
    const day = dayOf(now);
    const weekDays = Array.from({ length: 7 }, (_, i) => weekOf(day) * 7 - 3 + i).filter((d) => d <= day);
    const view = (defId: string, claimed: boolean, days: number[]): QuestView | null => {
      const d = s.defs.find((x) => x.id === defId);
      if (d === undefined) return null;
      const p = progress.progress(id, d.kind, days, now);
      return { id: d.id, label: d.label, kind: d.kind, unit: QUEST_KINDS[d.kind].unit, target: d.target, progress: Math.min(p, d.target),
        reward: d.reward, done: p >= d.target, claimed, period: d.period };
    };
    return {
      daily: a.daily.map((q) => view(q, a.claimed.includes(q), [day])).filter((v): v is QuestView => v !== null),
      weekly: a.weekly === null ? null : view(a.weekly, a.weeklyClaimed, weekDays),
    };
  });
}

/** Take a quest's reward: done, today's (or this week's), not taken yet. */
export async function claimQuest(id: string, questId: string, species: string | null, progress: QuestProgress, now = Math.floor(Date.now() / 1000)): Promise<{ reward: number; balance: number; label: string }> {
  const { daily, weekly } = await questsOf(id, species, progress, now);
  const q = [...daily, ...(weekly ? [weekly] : [])].find((x) => x.id === questId);
  if (q === undefined) throw new ValidationError('Nhiệm vụ này không phải của bạn hôm nay.');
  if (q.claimed) throw new ValidationError('Bạn đã nhận thưởng nhiệm vụ này.');
  if (!q.done) throw new ValidationError(`Chưa xong: ${q.progress}/${q.target} ${q.unit}.`);
  return serialized(async () => {
    const state = await readState();
    const a = state.players[id];
    if (a === undefined) throw new ValidationError('Nhiệm vụ đã đổi, tải lại trang.');
    if (q.period === 'week') {
      if (a.weekly !== q.id || a.weeklyClaimed) throw new ValidationError('Bạn đã nhận thưởng nhiệm vụ này.');
      a.weeklyClaimed = true;
    } else {
      if (!a.daily.includes(q.id) || a.claimed.includes(q.id)) throw new ValidationError('Bạn đã nhận thưởng nhiệm vụ này.');
      a.claimed.push(q.id);
    }
    await writeJson(statePath(), state);
    const line = q.reward > 0 ? await credit(id, q.reward, `Nhiệm vụ ${q.period === 'week' ? 'tuần' : 'ngày'}: ${q.label}`, null, now) : null;
    return { reward: q.reward, balance: line?.balance ?? 0, label: q.label };
  });
}

export { CURRENCY };
