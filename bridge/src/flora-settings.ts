import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';

/**
 * Settings of the Flora mod's control (mods/Flora, step 2): nutrient plants
 * only where herbivores migrate. Read by the mod every few seconds.
 */
export interface FloraSettings {
  control: boolean;
  /** Of the plants / fruits in an active migration area, how many in 100 give nutrients. */
  migrationNutrientPct: number;
  /** The game's MigrationSpawnMultiplier for an active area (1 = the game's own). */
  migrationMultiplier: number;
  /** Same, in a mass migration. */
  massNutrientPct: number;
  massMultiplier: number;
  /** Outside the migration areas: this % of the plain areas' plants and of the fruit trees' fruits. */
  outsideAmountPct: number;
}

export const FLORA_DEFAULTS: FloraSettings = {
  control: false, migrationNutrientPct: 40, migrationMultiplier: 1, massNutrientPct: 100, massMultiplier: 3, outsideAmountPct: 30,
};

const LIMITS: Record<Exclude<keyof FloraSettings, 'control'>, [number, number]> = {
  migrationNutrientPct: [0, 100], migrationMultiplier: [1, 10], massNutrientPct: [0, 100], massMultiplier: [1, 20], outsideAmountPct: [0, 100],
};

const path = (): string => join(config.floraRoot, 'settings.json');

function normalise(raw: Record<string, unknown>, strict: boolean): FloraSettings {
  const out: FloraSettings = { ...FLORA_DEFAULTS };
  if (raw['control'] !== undefined) {
    if (typeof raw['control'] === 'boolean') out.control = raw['control'];
    else if (strict) throw new ValidationError('control must be true or false');
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

export async function readFloraSettings(): Promise<FloraSettings> {
  try {
    return normalise(JSON.parse(await readFile(path(), 'utf8')) as Record<string, unknown>, false);
  } catch {
    return { ...FLORA_DEFAULTS };
  }
}

export async function saveFloraSettings(raw: unknown): Promise<FloraSettings> {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('settings must be an object');
  const settings = normalise(raw as Record<string, unknown>, true);
  await mkdir(config.floraRoot, { recursive: true });
  const tmp = `${path()}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
  await rename(tmp, path());
  return settings;
}
