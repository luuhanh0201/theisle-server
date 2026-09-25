import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';

/**
 * Settings of the PteraCarry mod (mods/PteraCarry): a flying Pteranodon grabs
 * another player's dino with the game's latch key (Z + right mouse) and
 * carries it — up to `maxKg`. Read by the mod every few seconds: no restart.
 */
export interface PteraSettings {
  enabled: boolean;
  /** Heaviest dino a Pteranodon may carry (the target's GetWeight, kg). */
  maxKg: number;
  /** Longest carry, seconds; then it is let go (in the air it falls). */
  maxSeconds: number;
  /** Seconds between two carries by one Pteranodon. */
  cooldown: number;
  /** Tell a flying Pteranodon when a light enough player is this close (m); 0 = never. */
  hintMeters: number;
}

export const PTERA_DEFAULTS: PteraSettings = { enabled: false, maxKg: 150, maxSeconds: 20, cooldown: 30, hintMeters: 10 };

const LIMITS: Record<Exclude<keyof PteraSettings, 'enabled'>, [number, number]> = {
  maxKg: [1, 20000], maxSeconds: [3, 120], cooldown: [0, 3600], hintMeters: [0, 50],
};

const path = (): string => join(config.pteraRoot, 'settings.json');

function normalise(raw: Record<string, unknown>, strict: boolean): PteraSettings {
  const out: PteraSettings = { ...PTERA_DEFAULTS };
  if (raw['enabled'] !== undefined) {
    if (typeof raw['enabled'] === 'boolean') out.enabled = raw['enabled'];
    else if (strict) throw new ValidationError('enabled must be true or false');
  }
  for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const v = raw[key];
    if (v === undefined) continue;
    const [lo, hi] = LIMITS[key];
    if (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi) out[key] = v;
    else if (strict) throw new ValidationError(`${key} must be a whole number ${lo}–${hi}`);
  }
  return out;
}

export async function readPteraSettings(): Promise<PteraSettings> {
  try {
    return normalise(JSON.parse(await readFile(path(), 'utf8')) as Record<string, unknown>, false);
  } catch {
    return { ...PTERA_DEFAULTS };
  }
}

export async function savePteraSettings(raw: unknown): Promise<PteraSettings> {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('settings must be an object');
  const settings = normalise(raw as Record<string, unknown>, true);
  // The mod's Saved/ does not exist until something writes there (Lua cannot create it).
  await mkdir(config.pteraRoot, { recursive: true });
  const tmp = `${path()}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
  await rename(tmp, path());
  return settings;
}
