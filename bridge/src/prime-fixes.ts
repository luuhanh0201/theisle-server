import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';

/**
 * Prime progress given back to a player's dino (mods/DinoGarage/Scripts/
 * garage/primefix.lua). Before 2026-09-26 the garage lost a stored dino's
 * prime conditions (migration / patrol zones…) and its prime; an admin writes
 * here what the dino had (from the StatsLogger "prime" events), and the mod
 * applies it once, when that player plays that species within that growth
 * range — a dino still in the garage right after it is taken out.
 *
 *   DinoGarage/Saved/prime-fixes.json       the fixes (written here)
 *   DinoGarage/Saved/prime-fixes.done.json  { done: { id: t } } (written by the mod)
 */

export interface PrimeFix {
  id: string;
  steamId: string;
  /** Blueprint class name, "BP_Triceratops_C". */
  species: string;
  minGrowth: number;
  maxGrowth: number;
  primeData: Record<string, boolean>;
  prime: boolean;
  createdAt: number;
  expiresAt: number;
  note: string;
}

const fixesPath = (): string => join(config.garageRoot, 'prime-fixes.json');
const donePath = (): string => join(config.garageRoot, 'prime-fixes.done.json');

async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

async function readFixes(): Promise<PrimeFix[]> {
  const d = (await readJson(fixesPath())) as { fixes?: unknown } | null;
  return Array.isArray(d?.fixes) ? (d.fixes as PrimeFix[]) : [];
}

/** Every fix, with when the mod applied it (null: not yet). */
export async function listPrimeFixes(): Promise<Array<PrimeFix & { doneAt: number | null }>> {
  const done = ((await readJson(donePath())) as { done?: Record<string, number> } | null)?.done ?? {};
  return (await readFixes()).map((f) => ({ ...f, doneAt: typeof done[f.id] === 'number' ? done[f.id] as number : null }));
}

const STEAM_RE = /^\d{17}$/;
const SPECIES_RE = /^BP_[A-Za-z0-9]+_C$/;
const CONDS_RE = /^[01]{10}$/;

/**
 * Add one fix. `conditions`: the ten conditions as "1010101100" (condition 1
 * first), as the events show them; `eligible` defaults to what the game had.
 */
export async function addPrimeFix(raw: unknown, nowS = Math.floor(Date.now() / 1000)): Promise<PrimeFix> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const steamId = String(r.steamId ?? '');
  const species = String(r.species ?? '');
  const minGrowth = Number(r.minGrowth);
  const maxGrowth = Number(r.maxGrowth);
  const conditions = r.conditions === undefined || r.conditions === null ? null : String(r.conditions);
  const days = r.days === undefined ? 7 : Number(r.days);
  if (!STEAM_RE.test(steamId)) throw new ValidationError('steamId must be a SteamID64');
  if (!SPECIES_RE.test(species)) throw new ValidationError('species must be a class name like BP_Triceratops_C');
  if (!(minGrowth >= 0 && maxGrowth <= 1 && minGrowth <= maxGrowth)) throw new ValidationError('growth range must be within 0–1');
  if (conditions !== null && !CONDS_RE.test(conditions)) throw new ValidationError('conditions must be ten 0/1, condition 1 first');
  if (r.prime !== undefined && typeof r.prime !== 'boolean') throw new ValidationError('prime must be true or false');
  if (r.eligible !== undefined && typeof r.eligible !== 'boolean') throw new ValidationError('eligible must be true or false');
  if (!(Number.isInteger(days) && days >= 1 && days <= 30)) throw new ValidationError('days must be 1–30');
  if (conditions === null && r.prime !== true) throw new ValidationError('nothing to give back: conditions or prime');

  const primeData: Record<string, boolean> = {};
  if (conditions !== null) [...conditions].forEach((c, i) => { primeData[`cond${i + 1}`] = c === '1'; });
  if (typeof r.eligible === 'boolean') primeData.eligible = r.eligible;

  const fixes = await readFixes();
  const fix: PrimeFix = {
    id: `fix-${nowS.toString(36)}-${fixes.length + 1}`,
    steamId, species, minGrowth, maxGrowth, primeData,
    prime: r.prime === true,
    createdAt: nowS,
    expiresAt: nowS + days * 86400,
    note: typeof r.note === 'string' ? r.note.slice(0, 200) : '',
  };
  await mkdir(config.garageRoot, { recursive: true });
  const tmp = `${fixesPath()}.tmp`;
  await writeFile(tmp, JSON.stringify({ fixes: [...fixes, fix] }, null, 2), 'utf8');
  await rename(tmp, fixesPath());
  return fix;
}
