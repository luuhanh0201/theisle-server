import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';
import { CURRENCY, credit } from './economy.js';
import { ITEM_TYPES, grantItem, listItems } from './items.js';

/**
 * The whole server's milestones (owner, 2026-10-10): the server reaching 20 / 50 / 100 / 200 players
 * online AT ONCE, held `holdMinutes` without a break (a crowd joining and leaving at once is not it),
 * gives each milestone's reward to everyone, once ever. "Everyone": every account with more than
 * `minPlayMinutes` in game in all (online then or not, a newer player too, no deadline), taken with
 * "Nhận" on the home page. The milestones, the rewards (Hổ phách and items), the minutes: the panel's
 * (Nhiệm vụ → Mốc online toàn server). Every player in game counts, admins too.
 *
 *   data/milestones-settings.json  MilestoneSettings
 *   data/milestones.json           { reached: { <id>: { at, online } }, claimed: { <steamId>: [<id>…] } }
 */

export interface RewardItem { itemId: string; qty: number }
export interface MilestoneDef { id: string; players: number; amber: number; items: RewardItem[] }
export interface MilestoneSettings { enabled: boolean; holdMinutes: number; minPlayMinutes: number; defs: MilestoneDef[] }

export const MILESTONE_DEFAULTS: MilestoneSettings = {
  enabled: false,
  holdMinutes: 5,
  minPlayMinutes: 60,
  defs: [
    { id: 'm20', players: 20, amber: 100, items: [] },
    { id: 'm50', players: 50, amber: 300, items: [] },
    { id: 'm100', players: 100, amber: 700, items: [] },
    { id: 'm200', players: 200, amber: 1500, items: [] },
  ],
};

export function validateMilestones(raw: unknown): MilestoneSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const int = (v: unknown, what: string, lo: number, hi: number): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new ValidationError(`${what} must be ${lo}–${hi}`);
    return v;
  };
  const holdMinutes = int(r['holdMinutes'] ?? MILESTONE_DEFAULTS.holdMinutes, 'holdMinutes', 0, 180);
  const minPlayMinutes = int(r['minPlayMinutes'] ?? MILESTONE_DEFAULTS.minPlayMinutes, 'minPlayMinutes', 0, 100_000);
  const defs = r['defs'] ?? MILESTONE_DEFAULTS.defs;
  if (!Array.isArray(defs) || defs.length > 20) throw new ValidationError('defs must be a list (at most 20)');
  const ids = new Set<string>();
  const out = defs.map((d, i) => {
    const o = (typeof d === 'object' && d !== null ? d : {}) as Record<string, unknown>;
    const at = `mốc ${i + 1}`;
    const id = typeof o['id'] === 'string' ? o['id'].trim() : '';
    if (!/^[\w-]{1,40}$/.test(id) || ids.has(id)) throw new ValidationError(`${at}: id must be 1–40 letters / digits / - and unique`);
    ids.add(id);
    const items = o['items'] ?? [];
    if (!Array.isArray(items) || items.length > 10) throw new ValidationError(`${at}: at most 10 items`);
    return {
      id,
      players: int(o['players'], `${at}: players`, 1, 1000),
      amber: int(o['amber'] ?? 0, `${at}: amber`, 0, 1_000_000),
      items: items.map((x, j) => {
        const it = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
        const itemId = typeof it['itemId'] === 'string' ? it['itemId'].trim() : '';
        if (itemId === '' || itemId.length > 80) throw new ValidationError(`${at}, vật phẩm ${j + 1}: pick an item`);
        return { itemId, qty: int(it['qty'] ?? 1, `${at}, vật phẩm ${j + 1}: qty`, 1, 20) };
      }),
    };
  });
  return { enabled: r['enabled'] === true, holdMinutes, minPlayMinutes, defs: out };
}

const settingsPath = (): string => join(config.dataDir, 'milestones-settings.json');
const statePath = (): string => join(config.dataDir, 'milestones.json');

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, path);
}

export async function readMilestones(): Promise<MilestoneSettings> {
  try { return validateMilestones(JSON.parse(await readFile(settingsPath(), 'utf8'))); } catch { return structuredClone(MILESTONE_DEFAULTS); }
}

/** Items that exist and can be given (not the dino item a box makes). */
async function checkItems(s: MilestoneSettings): Promise<void> {
  const items = new Map((await listItems()).map((i) => [i.id, i]));
  for (const d of s.defs) {
    for (const x of d.items) {
      const it = items.get(x.itemId);
      if (it === undefined) throw new ValidationError(`Mốc ${d.players} người: không có vật phẩm "${x.itemId}"`);
      if (ITEM_TYPES.find((t) => t.key === it.type)?.system) throw new ValidationError(`Mốc ${d.players} người: ${it.name} chỉ có khi mở hộp dino`);
    }
  }
}

export async function saveMilestones(raw: unknown): Promise<MilestoneSettings> {
  const s = validateMilestones(raw);
  await checkItems(s);
  await writeJson(settingsPath(), s);
  return s;
}

interface Reached { at: number; online: number }
interface MilestoneState { reached: Record<string, Reached>; claimed: Record<string, string[]> }
const readState = async (): Promise<MilestoneState> => {
  try {
    const raw = JSON.parse(await readFile(statePath(), 'utf8')) as Partial<MilestoneState>;
    return { reached: raw.reached ?? {}, claimed: raw.claimed ?? {} };
  } catch { return { reached: {}, claimed: {} }; }
};

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

/**
 * Watches the player count (index.ts, every few seconds): a milestone not reached yet with at least
 * its players online since `holdMinutes` ago, without a moment below, is reached. The clock is kept
 * in memory (a bridge restart starts it again: a few minutes later at worst).
 */
export class MilestoneWatch {
  readonly #since = new Map<string, number>();
  constructor(private readonly online: () => number, private readonly onReached: (d: MilestoneDef, online: number) => void = () => undefined) {}

  /** Seconds each milestone not reached yet has been held so far (the home page's "đang giữ"). */
  held(now: number): Record<string, number> {
    return Object.fromEntries([...this.#since].map(([id, t]) => [id, Math.max(0, now - t)]));
  }

  async tick(now = Math.floor(Date.now() / 1000)): Promise<string[]> {
    const s = await readMilestones();
    if (!s.enabled) { this.#since.clear(); return []; }
    const n = this.online();
    return serialized(async () => {
      const st = await readState();
      const fresh: string[] = [];
      for (const d of s.defs) {
        if (st.reached[d.id] !== undefined || n < d.players) { this.#since.delete(d.id); continue; }
        const since = this.#since.get(d.id) ?? now;
        this.#since.set(d.id, since);
        if (now - since < s.holdMinutes * 60) continue;
        st.reached[d.id] = { at: now, online: n };
        this.#since.delete(d.id);
        fresh.push(d.id);
        this.onReached(d, n);
      }
      if (fresh.length > 0) await writeJson(statePath(), st);
      return fresh;
    });
  }
}

export interface MilestoneView {
  online: number; holdMinutes: number; minPlayMinutes: number; playMinutes: number; eligible: boolean;
  defs: Array<{ id: string; players: number; amber: number; items: Array<{ name: string; qty: number }>; reached: boolean; reachedAt: number | null;
    claimed: boolean; heldS: number | null }>;
}

/** What the home page shows a player; null when the milestones are off. */
export async function milestonesOf(steamId: string, playSeconds: number, online: number, held: Record<string, number>): Promise<MilestoneView | null> {
  const s = await readMilestones();
  if (!s.enabled) return null;
  const st = await readState();
  const names = new Map((await listItems()).map((i) => [i.id, i.name]));
  const mine = new Set(st.claimed[steamId] ?? []);
  const playMinutes = Math.floor(playSeconds / 60);
  return {
    online, holdMinutes: s.holdMinutes, minPlayMinutes: s.minPlayMinutes, playMinutes, eligible: playMinutes >= s.minPlayMinutes,
    defs: [...s.defs].sort((a, b) => a.players - b.players).map((d) => ({
      id: d.id, players: d.players, amber: d.amber,
      items: d.items.map((x) => ({ name: names.get(x.itemId) ?? x.itemId, qty: x.qty })),
      reached: st.reached[d.id] !== undefined, reachedAt: st.reached[d.id]?.at ?? null,
      claimed: mine.has(d.id), heldS: held[d.id] ?? null,
    })),
  };
}

/**
 * Take a milestone's reward: reached, enough minutes in game, not taken yet. Marked taken first (a
 * second click, two tabs: nothing twice), then the Hổ phách and the items; a skin they already own is
 * skipped (one each), any other item that cannot be given is logged and said.
 */
export function claimMilestone(steamId: string, id: unknown, playSeconds: number, now = Math.floor(Date.now() / 1000)): Promise<{ players: number; amber: number; balance: number | null; items: string[]; skipped: string[] }> {
  if (typeof id !== 'string') return Promise.reject(new ValidationError('expected { milestone }'));
  return serialized(async () => {
    const s = await readMilestones();
    if (!s.enabled) throw new ValidationError('Mốc online toàn server đang tắt.');
    const d = s.defs.find((x) => x.id === id);
    if (d === undefined) throw new ValidationError('Không có mốc này, tải lại trang.');
    const st = await readState();
    if (st.reached[d.id] === undefined) throw new ValidationError(`Server chưa đạt mốc ${d.players} người online cùng lúc.`);
    const mins = Math.floor(playSeconds / 60);
    if (mins < s.minPlayMinutes) throw new ValidationError(`Cần chơi tổng cộng đủ ${s.minPlayMinutes} phút để nhận (bạn đã chơi ${mins} phút).`);
    const mine = st.claimed[steamId] ?? [];
    if (mine.includes(d.id)) throw new ValidationError('Bạn đã nhận quà mốc này rồi.');
    st.claimed[steamId] = [...mine, d.id];
    await writeJson(statePath(), st);
    const why = `Mốc server ${d.players} người online cùng lúc`;
    const line = d.amber > 0 ? await credit(steamId, d.amber, why, null, now) : null;
    const items: string[] = [], skipped: string[] = [];
    const names = new Map((await listItems()).map((i) => [i.id, i.name]));
    for (const x of d.items) {
      const name = names.get(x.itemId) ?? x.itemId;
      for (let k = 0; k < x.qty; k++) {
        try {
          await grantItem(steamId, x.itemId, 'event', null, why);
          items.push(name);
        } catch (error) {
          // One of a kind they already own (a skin): nothing more to give of it.
          skipped.push(name);
          if (!(error instanceof ValidationError)) console.error(`[milestones] ${steamId}: ${name} not given:`, error);
          break;
        }
      }
    }
    return { players: d.players, amber: d.amber, balance: line?.balance ?? null, items, skipped };
  });
}

/** Open a milestone again (the panel): not reached, nobody has taken it. */
export function reopenMilestone(id: unknown): Promise<{ claimed: number }> {
  if (typeof id !== 'string') return Promise.reject(new ValidationError('expected { id }'));
  return serialized(async () => {
    const st = await readState();
    let claimed = 0;
    delete st.reached[id];
    for (const [who, list] of Object.entries(st.claimed)) {
      if (list.includes(id)) { claimed += 1; st.claimed[who] = list.filter((x) => x !== id); }
    }
    await writeJson(statePath(), st);
    return { claimed };
  });
}

/** The panel: each milestone, reached when, how many took it. */
export async function milestonesAdminView(): Promise<{ reached: Record<string, Reached>; claimedCount: Record<string, number> }> {
  const st = await readState();
  const claimedCount: Record<string, number> = {};
  for (const list of Object.values(st.claimed)) for (const id of list) claimedCount[id] = (claimedCount[id] ?? 0) + 1;
  return { reached: st.reached, claimedCount };
}

export { CURRENCY };
