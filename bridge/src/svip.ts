import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { isSteamId, ValidationError } from './garage.js';
import { adminIds } from './panel-auth.js';

/**
 * SVip (owner's request, 2026-10-04): players allowed the features still being
 * tried (the bag of items…) before everyone, besides the admins. The panel's
 * Quản trị → SVip: their SteamIDs, and each feature's mode — "testing" (admins
 * + SVip) or "all" (everyone), switched there without a code change.
 *
 *   DATA_DIR/svip.json  { players: [{ steamId, note, addedAt, by }], features: { bag: 'testing' } }
 *
 * The bag's own list before this (data/bag-access.json, T-Rex Nổi Loạn) is
 * taken over the first time: those players become SVip.
 */

/** The features being tried. A new one: add it here, check earlyAccess() where it is used. */
export const EARLY_FEATURES = [
  { key: 'bag', label: 'Túi đồ: dùng vật phẩm (mutation, phiếu) trên dino' },
  { key: 'starter', label: 'Phiếu chọn dino tân thủ (mỗi tài khoản 1 phiếu): dùng để nhận dino' },
  { key: 'amber', label: 'Hổ phách + điểm danh hàng ngày (nhận thưởng khi chơi đủ phút trong ngày)' },
] as const;
export type FeatureKey = typeof EARLY_FEATURES[number]['key'];
export type FeatureMode = 'testing' | 'all';

export interface SvipEntry { steamId: string; note: string; addedAt: number; by: string | null }
export interface SvipState { players: SvipEntry[]; features: Record<FeatureKey, FeatureMode> }

const MAX_PLAYERS = 500;
const path = (): string => join(config.dataDir, 'svip.json');
const defaults = (): SvipState => ({ players: [], features: Object.fromEntries(EARLY_FEATURES.map((f) => [f.key, 'testing'])) as SvipState['features'] });

let cache: { state: SvipState; at: number } | null = null;
const CACHE_MS = 5000;

function clean(raw: unknown): SvipState {
  const out = defaults();
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  for (const p of Array.isArray(r['players']) ? r['players'] : []) {
    const o = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
    const id = typeof o['steamId'] === 'string' ? o['steamId'].trim() : '';
    if (!isSteamId(id) || seen.has(id)) continue;
    seen.add(id);
    out.players.push({
      steamId: id,
      note: typeof o['note'] === 'string' ? o['note'].trim().slice(0, 80) : '',
      addedAt: typeof o['addedAt'] === 'number' ? o['addedAt'] : 0,
      by: typeof o['by'] === 'string' ? o['by'].slice(0, 60) : null,
    });
  }
  const f = (typeof r['features'] === 'object' && r['features'] !== null ? r['features'] : {}) as Record<string, unknown>;
  for (const { key } of EARLY_FEATURES) if (f[key] === 'all' || f[key] === 'testing') out.features[key] = f[key];
  return out;
}

export async function readSvip(nowMs = Date.now()): Promise<SvipState> {
  if (cache !== null && nowMs - cache.at < CACHE_MS) return cache.state;
  let state: SvipState;
  try {
    state = clean(JSON.parse(await readFile(path(), 'utf8')));
  } catch {
    // First time: the bag's list becomes SVip.
    state = defaults();
    try {
      const old = JSON.parse(await readFile(join(config.dataDir, 'bag-access.json'), 'utf8')) as { players?: unknown };
      for (const id of Array.isArray(old.players) ? old.players : []) {
        if (typeof id === 'string' && isSteamId(id)) state.players.push({ steamId: id, note: 'túi đồ (danh sách cũ)', addedAt: Math.floor(nowMs / 1000), by: null });
      }
    } catch { /* none */ }
    // Kept at once: the taken-over players keep this time, the old file is no longer read.
    await mkdir(config.dataDir, { recursive: true }).then(() => writeFile(path(), JSON.stringify(state, null, 2), 'utf8')).catch(() => undefined);
  }
  cache = { state, at: nowMs };
  return state;
}

/**
 * The whole state from the panel: the players kept (a new one gets its time and who added it),
 * and the features' modes. Returns what was saved.
 */
export async function saveSvip(raw: unknown, by: string | null, nowMs = Date.now()): Promise<SvipState> {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('body must be an object');
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r['players'])) throw new ValidationError('players must be a list');
  if (r['players'].length > MAX_PLAYERS) throw new ValidationError(`at most ${MAX_PLAYERS} SVip`);
  for (const p of r['players']) {
    const id = typeof p === 'object' && p !== null ? (p as Record<string, unknown>)['steamId'] : undefined;
    if (typeof id !== 'string' || !isSteamId(id.trim())) throw new ValidationError(`SteamID không hợp lệ: ${String(id)} (17 chữ số, bắt đầu 7656…)`);
  }
  const before = await readSvip(nowMs);
  const known = new Map(before.players.map((p) => [p.steamId, p]));
  const next = clean(raw);
  next.players = next.players.map((p) => {
    const was = known.get(p.steamId);
    return was !== undefined ? { ...was, note: p.note } : { ...p, addedAt: Math.floor(nowMs / 1000), by };
  });
  await mkdir(config.dataDir, { recursive: true });
  const tmp = `${path()}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
  await rename(tmp, path());
  cache = { state: next, at: nowMs };
  return next;
}

export async function isSvip(steamId: string): Promise<boolean> {
  return (await readSvip()).players.some((p) => p.steamId === steamId);
}

/** Whether this player may use a feature being tried: open to all, or an admin, or SVip. */
export async function earlyAccess(feature: FeatureKey, steamId: string): Promise<boolean> {
  const s = await readSvip();
  if (s.features[feature] === 'all') return true;
  return (await adminIds()).has(steamId) || s.players.some((p) => p.steamId === steamId);
}

/** For tests: forget what was read. */
export function resetSvipCache(): void { cache = null; }
