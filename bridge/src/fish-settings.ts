import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';
import { readLive, saveSettings } from './gameini.js';

/**
 * The island's fish, as the admin sets them (mods/FishControl).
 *
 *   density   perPlayer / perWater / cooldownSec → the game's own
 *             MaxAmbientFishPerPlayer / AmbientFishSoftLimitPerWater /
 *             AmbientFishSpawnCooldown (the mod sets them; off = the game's)
 *   species   the ones left out go into the game's DisallowedAIClasses
 *             (Game.ini, and RCON DisableAIClasses for the running server),
 *             next to whatever else is disallowed there
 *
 * The 6 species are the game's AIAmbientFishClasses (FishProbe, 2026-09-26).
 */

export const FISH_SPECIES = [
  { key: 'Catfish', cls: 'BP_Catfish_C', label: 'Catfish (cá trê)' },
  { key: 'Coalecanth', cls: 'BP_Coalecanth_C', label: 'Coelacanth (cá vây tay)' },
  { key: 'Forktail', cls: 'BP_Forktail_C', label: 'Forktail' },
  { key: 'Hoplo', cls: 'BP_Hoplo_C', label: 'Hoplo' },
  { key: 'Longear', cls: 'BP_Longear_C', label: 'Longear (cá thái dương)' },
  { key: 'Muskel', cls: 'BP_Muskel_C', label: 'Muskel' },
] as const;
const FISH_KEYS: ReadonlySet<string> = new Set(FISH_SPECIES.map((f) => f.key));

export interface FishSettings {
  control: boolean;
  /** At most this many fish around one player (game: 12). */
  perPlayer: number;
  /** At most this many in one body of water (game: 28). */
  perWater: number;
  /** Seconds between two tries to spawn one (game: 0.5). */
  cooldownSec: number;
  /** The species that may spawn (keys of FISH_SPECIES). */
  species: string[];
  /**
   * Other numbers of the game's AI spawner (TIAIWorldSpawner), by property
   * name — e.g. how much land AI it keeps around each player. The mod writes
   * only a numeric property the class lists, and puts the game's back when an
   * entry goes. Kept when a save does not send it.
   */
  tune: Record<string, number>;
}

export const FISH_DEFAULTS: FishSettings = {
  control: false, perPlayer: 12, perWater: 28, cooldownSec: 0.5, species: FISH_SPECIES.map((f) => f.key), tune: {},
};

const path = (): string => join(config.fishRoot, 'settings.json');
const censusPath = (): string => join(config.fishRoot, 'fish.json');

export function validateFish(raw: unknown): FishSettings {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('settings must be an object');
  const r = raw as Record<string, unknown>;
  const out: FishSettings = { ...FISH_DEFAULTS, species: [...FISH_DEFAULTS.species], tune: {} };
  if (r['control'] !== undefined) {
    if (typeof r['control'] !== 'boolean') throw new ValidationError('control must be true or false');
    out.control = r['control'];
  }
  const int = (k: 'perPlayer' | 'perWater', lo: number, hi: number): void => {
    const v = r[k];
    if (v === undefined) return;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new ValidationError(`${k} must be a whole number ${lo}–${hi}`);
    out[k] = v;
  };
  int('perPlayer', 0, 60);
  int('perWater', 0, 200);
  if (r['cooldownSec'] !== undefined) {
    const v = r['cooldownSec'];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0.1 || v > 30) throw new ValidationError('cooldownSec must be 0.1–30');
    out.cooldownSec = Math.round(v * 10) / 10;
  }
  if (r['species'] !== undefined) {
    if (!Array.isArray(r['species'])) throw new ValidationError('species must be a list');
    for (const s of r['species']) if (typeof s !== 'string' || !FISH_KEYS.has(s)) throw new ValidationError(`unknown fish "${String(s)}"`);
    out.species = FISH_SPECIES.map((f) => f.key).filter((k) => (r['species'] as string[]).includes(k));
  }
  if (r['tune'] !== undefined) {
    const t = r['tune'];
    if (typeof t !== 'object' || t === null || Array.isArray(t) || Object.keys(t).length > 20) throw new ValidationError('tune must be an object of at most 20 numbers');
    for (const [k, v] of Object.entries(t)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(k)) throw new ValidationError(`tune: "${k}" is not a property name`);
      if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e7) throw new ValidationError(`tune.${k} must be a number`);
      out.tune[k] = v;
    }
  }
  return out;
}

export async function readFishSettings(): Promise<FishSettings> {
  try {
    return validateFish(JSON.parse(await readFile(path(), 'utf8')));
  } catch {
    return { ...FISH_DEFAULTS, species: [...FISH_DEFAULTS.species], tune: {} };
  }
}

export interface FishCensus { t: number; online: number; total: number; species: Record<string, number>; perPlayer?: number; perWater?: number; cooldownSec?: number }
export async function readFishCensus(): Promise<FishCensus | null> {
  try {
    return JSON.parse(await readFile(censusPath(), 'utf8')) as FishCensus;
  } catch {
    return null;
  }
}

/** The game's DisallowedAIClasses as it would be with these settings (other entries kept). */
export function disallowedWith(current: string[], s: FishSettings): string[] {
  const others = current.filter((c) => !FISH_KEYS.has(c));
  const left = s.control ? FISH_SPECIES.map((f) => f.key).filter((k) => !s.species.includes(k)) : [];
  return [...others, ...left];
}

export async function currentDisallowed(): Promise<string[]> {
  const cfg = await readLive();
  const v = cfg.settings['DisallowedAIClasses'] ?? cfg.effective['DisallowedAIClasses'];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

interface RconLike { readonly enabled: boolean; run(name: string, args?: unknown): Promise<string> }

/** Save; hand the density to the mod; the species to the game (Game.ini + RCON when there is something to disallow). */
export async function saveFish(raw: unknown, rcon: RconLike): Promise<{ settings: FishSettings; disallowed: string[]; rcon: 'sent' | 'not needed' | 'unavailable' | string }> {
  const settings = validateFish(raw);
  // The panel's fish page does not send the spawner tuning: keep what is set.
  if ((raw as Record<string, unknown>)['tune'] === undefined) settings.tune = (await readFishSettings()).tune;
  await mkdir(config.fishRoot, { recursive: true });
  const tmp = `${path()}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
  await rename(tmp, path());
  const before = await currentDisallowed();
  const next = disallowedWith(before, settings);
  let sent: 'sent' | 'not needed' | 'unavailable' | string = 'not needed';
  if (JSON.stringify(before) !== JSON.stringify(next)) {
    const cfg = await readLive();
    await saveSettings({ ...cfg.settings, DisallowedAIClasses: next });
    if (!rcon.enabled) sent = 'unavailable';
    else if (next.length === 0) sent = 'restart needed';   // an empty list cannot be sent
    else {
      try { await rcon.run('disableAiClasses', next); sent = 'sent'; } catch (e) { sent = `failed: ${(e as Error).message}`; }
    }
  }
  return { settings, disallowed: next, rcon: sent };
}
