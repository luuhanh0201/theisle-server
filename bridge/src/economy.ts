import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';
import { getItem, grantItem } from './items.js';

/**
 * Hổ phách (owner, 2026-10-05): the server's one currency, earned by playing — the daily check-in now,
 * the daily quests next; spent in a shop later. Not sold for real money. Tried by SVip first (svip.ts
 * feature 'amber'). Everything tunable on the panel (Nhiệm vụ).
 *
 *   data/economy.json             { balances: { <steamId>: n }, checkin: { <steamId>: { last: <day>, streak } } }
 *   data/economy-ledger.ndjson    one line per change: { t, steamId, delta, balance, reason, by }
 *   data/economy-settings.json    EconomySettings
 *
 * A day is Vietnam's (UTC+7): it turns at 00:00 there.
 */

export const CURRENCY = 'Hổ phách';
export const CHECKIN_DAYS = 7;

export interface EconomySettings {
  /** Minutes in game that day before the check-in can be taken. */
  checkinMinutes: number;
  /** Day 1…7 of a streak: Hổ phách each. */
  checkinRewards: number[];
  /** An item given with day 7 (its id), or null. */
  checkinBonusItem: string | null;
}
export const ECONOMY_DEFAULTS: EconomySettings = { checkinMinutes: 15, checkinRewards: [50, 60, 70, 80, 100, 120, 200], checkinBonusItem: null };

/** Vietnam's day number (days since 1970-01-01 there). */
export const dayOf = (t: number): number => Math.floor((t + 7 * 3600) / 86400);
/** When that day starts, unix s. */
const dayStart = (day: number): number => day * 86400 - 7 * 3600;

const settingsPath = (): string => join(config.dataDir, 'economy-settings.json');
const statePath = (): string => join(config.dataDir, 'economy.json');
const ledgerPath = (): string => join(config.dataDir, 'economy-ledger.ndjson');

async function readJson<T>(path: string, empty: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return empty; }
}
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, path);
}

// --- settings ---------------------------------------------------------------------------------

export function validateEconomySettings(raw: unknown): EconomySettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const minutes = r['checkinMinutes'] ?? ECONOMY_DEFAULTS.checkinMinutes;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 0 || minutes > 600) throw new ValidationError('checkinMinutes must be 0–600');
  const rewards = r['checkinRewards'] ?? ECONOMY_DEFAULTS.checkinRewards;
  if (!Array.isArray(rewards) || rewards.length !== CHECKIN_DAYS
    || !rewards.every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100_000)) {
    throw new ValidationError(`checkinRewards must be ${CHECKIN_DAYS} whole numbers 0–100000`);
  }
  const item = r['checkinBonusItem'] ?? null;
  if (item !== null && (typeof item !== 'string' || !/^[\w-]{1,40}$/.test(item))) throw new ValidationError('checkinBonusItem must be an item id or null');
  return { checkinMinutes: minutes, checkinRewards: rewards as number[], checkinBonusItem: item as string | null };
}

export async function readEconomySettings(): Promise<EconomySettings> {
  try { return validateEconomySettings(JSON.parse(await readFile(settingsPath(), 'utf8'))); } catch { return { ...ECONOMY_DEFAULTS, checkinRewards: [...ECONOMY_DEFAULTS.checkinRewards] }; }
}

export async function saveEconomySettings(raw: unknown): Promise<EconomySettings> {
  const s = validateEconomySettings(raw);
  if (s.checkinBonusItem !== null && (await getItem(s.checkinBonusItem)) === null) throw new ValidationError('no such item');
  await writeJson(settingsPath(), s);
  return s;
}

// --- balances and the ledger ------------------------------------------------------------------

interface EconomyState {
  balances: Record<string, number>;
  checkin: Record<string, { last: number; streak: number }>;
}
const readState = (): Promise<EconomyState> => readJson<EconomyState>(statePath(), { balances: {}, checkin: {} });

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

export interface LedgerLine { t: number; steamId: string; delta: number; balance: number; reason: string; by: string | null }

/** Add (or, negative, take) Hổ phách in `state`; never below 0. The ledger line is written by the caller's save. */
function apply(state: EconomyState, steamId: string, delta: number, reason: string, by: string | null, t: number): LedgerLine {
  if (!Number.isInteger(delta) || delta === 0) throw new ValidationError('delta must be a whole number, not 0');
  const balance = (state.balances[steamId] ?? 0) + delta;
  if (balance < 0) throw new ValidationError(`không đủ ${CURRENCY} (có ${state.balances[steamId] ?? 0})`);
  state.balances[steamId] = balance;
  return { t, steamId, delta, balance, reason: reason.slice(0, 200), by };
}

async function commit(state: EconomyState, lines: LedgerLine[]): Promise<void> {
  // The ledger first: a line too many is found; a balance with no line is not.
  if (lines.length > 0) {
    await mkdir(dirname(ledgerPath()), { recursive: true });
    await appendFile(ledgerPath(), lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  }
  await writeJson(statePath(), state);
}

export async function balanceOf(steamId: string): Promise<number> {
  return (await readState()).balances[steamId] ?? 0;
}

/** An admin's change (panel), or the game's (a quest, a shop): with its reason. */
export function credit(steamId: string, delta: number, reason: string, by: string | null, t = Math.floor(Date.now() / 1000)): Promise<LedgerLine> {
  if (!/^\d{17}$/.test(steamId)) return Promise.reject(new ValidationError('steamId must be a SteamID64'));
  if (typeof reason !== 'string' || reason.trim() === '') return Promise.reject(new ValidationError('a reason is needed'));
  return serialized(async () => {
    const state = await readState();
    const line = apply(state, steamId, delta, reason.trim(), by, t);
    await commit(state, [line]);
    return line;
  });
}

/** The newest lines first, of one player or everyone. */
export async function readLedger(steamId: string | null, limit = 200): Promise<LedgerLine[]> {
  let raw = '';
  try { raw = await readFile(ledgerPath(), 'utf8'); } catch { return []; }
  const out: LedgerLine[] = [];
  const lines = raw.trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      const l = JSON.parse(lines[i] as string) as LedgerLine;
      if (steamId === null || l.steamId === steamId) out.push(l);
    } catch { /* a broken line */ }
  }
  return out;
}

export async function economySummary(): Promise<{ players: number; total: number; top: Array<{ steamId: string; balance: number }> }> {
  const b = (await readState()).balances;
  const entries = Object.entries(b).filter(([, v]) => v > 0);
  return {
    players: entries.length,
    total: entries.reduce((s, [, v]) => s + v, 0),
    top: entries.sort((x, y) => y[1] - x[1]).slice(0, 20).map(([steamId, balance]) => ({ steamId, balance })),
  };
}

// --- minutes in game per day (from the sessions) --------------------------------------------------

/**
 * Seconds in game per player and day, from session_start / session_end (and a server start, which ends
 * every session open then — a crash sends no session_end). Fed the events in file order; read again
 * from the start at every bridge start, so nothing of it is kept on disk.
 */
export class PlayDays {
  readonly #open = new Map<string, number>();
  readonly #seconds = new Map<string, Map<number, number>>();

  onEvent(event: object): void {
    const e = event as Record<string, unknown>;
    const t = e['t'];
    if (typeof t !== 'number') return;
    if (e['type'] === 'mod_loaded') { for (const id of [...this.#open.keys()]) this.#close(id, t); return; }
    const id = e['steamId'];
    if (typeof id !== 'string') return;
    if (e['type'] === 'session_start') { if (!this.#open.has(id)) this.#open.set(id, t); }
    else if (e['type'] === 'session_end') this.#close(id, t);
  }

  #close(id: string, t: number): void {
    const from = this.#open.get(id);
    if (from === undefined) return;
    this.#open.delete(id);
    this.#add(id, from, t);
  }

  #add(id: string, from: number, to: number): void {
    const days = this.#seconds.get(id) ?? new Map<number, number>();
    for (let s = from; s < to;) {
      const day = dayOf(s);
      const end = Math.min(to, dayStart(day + 1));
      days.set(day, (days.get(day) ?? 0) + (end - s));
      s = end;
    }
    // Only the last few days matter.
    const last = dayOf(to);
    for (const d of [...days.keys()]) if (d < last - 3) days.delete(d);
    this.#seconds.set(id, days);
  }

  /** Whole minutes in game on `now`'s day, the session still open counted to now. */
  minutesToday(id: string, now: number): number {
    const today = dayOf(now);
    let s = this.#seconds.get(id)?.get(today) ?? 0;
    const from = this.#open.get(id);
    if (from !== undefined) s += Math.max(0, now - Math.max(from, dayStart(today)));
    return Math.floor(s / 60);
  }
}

// --- the daily check-in --------------------------------------------------------------------------

export interface CheckinStatus {
  /** Taken today already. */
  claimed: boolean;
  /** Day of the streak the next check-in is (1–7), or today's when taken. */
  day: number;
  /** Hổ phách for each of the 7 days, and the item with day 7 (its name). */
  rewards: number[];
  bonusItem: string | null;
  /** Minutes in game today, and needed. */
  minutes: number;
  needed: number;
  /** It can be taken now. */
  ready: boolean;
}

function streakDay(last: { last: number; streak: number } | undefined, today: number): { claimed: boolean; streak: number } {
  if (last === undefined) return { claimed: false, streak: 1 };
  if (last.last === today) return { claimed: true, streak: last.streak };
  return { claimed: false, streak: last.last === today - 1 ? last.streak + 1 : 1 };
}

export async function checkinStatus(steamId: string, minutes: number, now = Math.floor(Date.now() / 1000)): Promise<CheckinStatus> {
  const s = await readEconomySettings();
  const { claimed, streak } = streakDay((await readState()).checkin[steamId], dayOf(now));
  const bonus = s.checkinBonusItem === null ? null : (await getItem(s.checkinBonusItem))?.name ?? null;
  return {
    claimed, day: ((streak - 1) % CHECKIN_DAYS) + 1, rewards: s.checkinRewards, bonusItem: bonus,
    minutes, needed: s.checkinMinutes, ready: !claimed && minutes >= s.checkinMinutes,
  };
}

/** Take today's check-in: the streak goes on (or starts again), its Hổ phách, the item on day 7. */
export function claimCheckin(steamId: string, minutes: number, now = Math.floor(Date.now() / 1000)): Promise<{ day: number; reward: number; balance: number; item: string | null }> {
  return serialized(async () => {
    const s = await readEconomySettings();
    const state = await readState();
    const today = dayOf(now);
    const { claimed, streak } = streakDay(state.checkin[steamId], today);
    if (claimed) throw new ValidationError('Hôm nay bạn đã điểm danh rồi.');
    if (minutes < s.checkinMinutes) throw new ValidationError(`Cần chơi ${s.checkinMinutes} phút trong ngày (đang ${minutes} phút).`);
    const day = ((streak - 1) % CHECKIN_DAYS) + 1;
    const reward = s.checkinRewards[day - 1] ?? 0;
    state.checkin[steamId] = { last: today, streak };
    const lines = reward > 0 ? [apply(state, steamId, reward, `Điểm danh ngày ${day}/${CHECKIN_DAYS}`, null, now)] : [];
    await commit(state, lines);
    let item: string | null = null;
    if (day === CHECKIN_DAYS && s.checkinBonusItem !== null) {
      const it = await getItem(s.checkinBonusItem);
      if (it !== null) { await grantItem(steamId, it.id, 'event', null, `Điểm danh ngày ${CHECKIN_DAYS}`); item = it.name; }
    }
    return { day, reward, balance: state.balances[steamId] ?? 0, item };
  });
}
