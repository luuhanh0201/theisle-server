import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';

/**
 * The island's real plants, as the Flora mod exports them (mods/Flora):
 * the plant-spawning areas (the migration and mass-migration zones are
 * these) and every plant and fruit with whether it gives nutrients.
 * Re-read only when the file changes (every ~2 minutes); stale after 10.
 */

export interface FloraSpawner {
  id: number; c: string; x: number; y: number;
  shape: { spline?: [number, number][]; box?: { x: number; y: number; ex: number; ey: number; yaw: number }; sphere?: { x: number; y: number; r: number } };
  migration?: boolean; zonePlants?: boolean; patrol?: boolean; juvenile?: boolean; nesting?: boolean;
  here?: boolean; mass?: boolean; active?: boolean;
  multiplier?: number; amount?: number; minAmount?: number; activations?: number;
}
export interface FloraPlant { c: string; x: number; y: number; n?: boolean; ft?: number; cp?: number; pp?: number; lp?: number; eaten?: boolean; s?: number }
export interface FloraControl { on: boolean; t: number; active: number; plants: number; plantsNutri: number; fruits: number; fruitsNutri: number; trimmed?: number }
export interface Flora {
  t: number; stale: boolean;
  /** When the plants and fruits were last read (the mod reads them every 10 minutes, or when the panel asks). */
  plantsT: number | null;
  spawners: FloraSpawner[]; plants: FloraPlant[]; fruits: FloraPlant[]; control: FloraControl | null }

const STALE_AFTER_S = 600;
const path = (): string => join(config.floraRoot, 'flora.json');
let cache: { mtime: number; data: Omit<Flora, 'stale'> } | null = null;

export async function readFlora(nowS = Math.floor(Date.now() / 1000)): Promise<Flora | null> {
  try {
    const st = await stat(path());
    if (!cache || cache.mtime !== st.mtimeMs) {
      const raw = JSON.parse(await readFile(path(), 'utf8')) as Partial<Flora>;
      const list = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
      cache = {
        mtime: st.mtimeMs,
        data: {
          t: typeof raw.t === 'number' ? raw.t : 0, plantsT: typeof raw.plantsT === 'number' ? raw.plantsT : null, spawners: list(raw.spawners), plants: list(raw.plants), fruits: list(raw.fruits),
          control: typeof raw.control === 'object' && raw.control !== null ? raw.control as FloraControl : null,
        },
      };
    }
    return { ...cache.data, stale: nowS - cache.data.t > STALE_AFTER_S };
  } catch {
    return null;
  }
}

/** The mod drops a request newer than this after its last read; the bridge refuses one sooner, so a click says why. */
export const REFRESH_GAP_S = 30;
let askedAt = 0;

/**
 * The panel map's "Tải lại thực vật": leaves refresh.request for the mod, which reads the plants and fruits
 * again on its next tick (about 40 s for the whole island) instead of at the next ten minutes.
 */
export async function requestFloraRefresh(nowS = Math.floor(Date.now() / 1000)): Promise<{ ok: true; plantsT: number | null } | { ok: false; retryIn: number }> {
  const flora = await readFlora(nowS);
  const since = Math.max(askedAt, flora?.plantsT ?? 0);
  if (nowS - since < REFRESH_GAP_S) return { ok: false, retryIn: REFRESH_GAP_S - (nowS - since) };
  await mkdir(config.floraRoot, { recursive: true });
  await writeFile(join(config.floraRoot, 'refresh.request'), String(nowS), 'utf8');
  askedAt = nowS;
  return { ok: true, plantsT: flora?.plantsT ?? null };
}
