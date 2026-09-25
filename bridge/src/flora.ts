import { readFile, stat } from 'node:fs/promises';
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
export interface Flora { t: number; stale: boolean; spawners: FloraSpawner[]; plants: FloraPlant[]; fruits: FloraPlant[] }

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
        data: { t: typeof raw.t === 'number' ? raw.t : 0, spawners: list(raw.spawners), plants: list(raw.plants), fruits: list(raw.fruits) },
      };
    }
    return { ...cache.data, stale: nowS - cache.data.t > STALE_AFTER_S };
  } catch {
    return null;
  }
}
