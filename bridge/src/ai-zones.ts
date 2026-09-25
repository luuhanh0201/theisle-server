import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { ValidationError } from './garage.js';
import { AI_BY_KEY } from './ai-species.js';
import type { GroundPoints } from './ground-points.js';

/**
 * AI zones, drawn on the admin panel, run by the AIZones mod (mods/AIZones).
 *
 *   DATA_DIR/ai-zones.json          what the panel saved (this file owns it)
 *   <AIZones>/Saved/zones.json      what the mod reads: the zones with each
 *                                   species' classes and the spawn points
 *   <AIZones>/Saved/status.json     what the mod reports back
 *
 * A zone: a circle (centre in game units, radius in metres), its species, the
 * AI it always keeps (min: topped up within seconds, player or not), how
 * many it fills up to while a player is inside (max) — every `everySec` a
 * random perTurnMin..perTurnMax (1–5) more, each at a different spot — and
 * the growth of the dinos it makes. `globalMax` caps every living AI on the server — the
 * game's own and the zones' — so the zones stop at it and players have to
 * hunt some down before more appear.
 */

export interface AiZone {
  id: string;
  name: string;
  enabled: boolean;
  /** Centre, game units (cm). */
  x: number;
  y: number;
  radiusM: number;
  species: string[];
  /** Always there, player or not. */
  min: number;
  /** Filled up to while a player is inside. */
  max: number;
  /** Each turn (every `everySec`, a player inside) adds a random count in this range. */
  perTurnMin: number;
  perTurnMax: number;
  everySec: number;
  growthMin: number;
  growthMax: number;
}

export interface AiZonesSettings {
  enabled: boolean;
  globalMax: number;
  zones: AiZone[];
}

export const AI_ZONES_DEFAULTS: AiZonesSettings = { enabled: false, globalMax: 150, zones: [] };
const MAX_ZONES = 40;

const settingsPath = (): string => join(config.dataDir, 'ai-zones.json');
const modPath = (): string => join(config.aiZonesRoot, 'zones.json');
const statusPath = (): string => join(config.aiZonesRoot, 'status.json');
export const groundPointsPath = (): string => join(config.dataDir, 'ground-points.json');

function int(v: unknown, lo: number, hi: number, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new ValidationError(`${what} must be a whole number ${lo}–${hi}`);
  return v;
}
function real(v: unknown, lo: number, hi: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new ValidationError(`${what} must be a number ${lo}–${hi}`);
  return v;
}

function validateZone(raw: unknown, i: number): AiZone {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError(`zone ${i + 1} is not an object`);
  const r = raw as Record<string, unknown>;
  const at = `zone ${i + 1}`;
  const id = typeof r['id'] === 'string' && /^[a-z0-9]{1,16}$/.test(r['id']) ? r['id'] : randomBytes(4).toString('hex');
  const name = typeof r['name'] === 'string' ? r['name'].trim().slice(0, 40) : '';
  if (name === '') throw new ValidationError(`${at}: a name is required`);
  const species = Array.isArray(r['species']) ? [...new Set(r['species'])] : [];
  if (species.length === 0 || species.length > 12) throw new ValidationError(`${at}: pick 1–12 kinds of AI`);
  for (const s of species) if (typeof s !== 'string' || !AI_BY_KEY.has(s)) throw new ValidationError(`${at}: unknown AI "${String(s)}"`);
  // Files saved before the rename: idleMax is the min, perTurn both ends of the range.
  const max = int(r['max'], 0, 200, `${at}: max`);
  const min = int(r['min'] ?? r['idleMax'], 0, 200, `${at}: min`);
  if (min > max) throw new ValidationError(`${at}: the minimum cannot be above the maximum`);
  const perTurnMin = int(r['perTurnMin'] ?? r['perTurn'], 1, 5, `${at}: perTurnMin`);
  const perTurnMax = int(r['perTurnMax'] ?? r['perTurn'], 1, 5, `${at}: perTurnMax`);
  if (perTurnMin > perTurnMax) throw new ValidationError(`${at}: perTurnMin is above perTurnMax`);
  const growthMin = real(r['growthMin'], 0.1, 1, `${at}: growthMin`);
  const growthMax = real(r['growthMax'], 0.1, 1, `${at}: growthMax`);
  if (growthMin > growthMax) throw new ValidationError(`${at}: growthMin is above growthMax`);
  return {
    id, name,
    enabled: r['enabled'] !== false,
    x: real(r['x'], -2_000_000, 2_000_000, `${at}: x`),
    y: real(r['y'], -2_000_000, 2_000_000, `${at}: y`),
    radiusM: int(r['radiusM'], 50, 5000, `${at}: radius (m)`),
    species: species as string[],
    min, max, perTurnMin, perTurnMax,
    everySec: int(r['everySec'], 10, 3600, `${at}: everySec`),
    growthMin, growthMax,
  };
}

export function validateAiZones(raw: unknown): AiZonesSettings {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('body must be an object');
  const r = raw as Record<string, unknown>;
  if (typeof r['enabled'] !== 'boolean') throw new ValidationError('enabled must be true or false');
  const zonesRaw = r['zones'];
  if (!Array.isArray(zonesRaw) || zonesRaw.length > MAX_ZONES) throw new ValidationError(`zones must be a list of at most ${MAX_ZONES}`);
  const zones = zonesRaw.map(validateZone);
  if (new Set(zones.map((z) => z.id)).size !== zones.length) throw new ValidationError('two zones have the same id');
  return { enabled: r['enabled'], globalMax: int(r['globalMax'], 0, 5000, 'globalMax'), zones };
}

export async function readAiZones(): Promise<AiZonesSettings> {
  try {
    return validateAiZones(JSON.parse(await readFile(settingsPath(), 'utf8')));
  } catch {
    return { ...AI_ZONES_DEFAULTS, zones: [] };
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value)}\n`, 'utf8');
  await rename(tmp, path);
}

/** What the mod reads: species resolved to classes, radius in cm, the spawn points of each zone. */
export function modFile(s: AiZonesSettings, points: GroundPoints): unknown {
  return {
    enabled: s.enabled,
    globalMax: s.globalMax,
    zones: s.zones.map((z) => ({
      id: z.id, name: z.name, enabled: z.enabled, x: z.x, y: z.y,
      radius: z.radiusM * 100,
      min: z.min, max: z.max, perTurnMin: z.perTurnMin, perTurnMax: z.perTurnMax, every: z.everySec,
      growthMin: z.growthMin, growthMax: z.growthMax,
      species: z.species.map((k) => {
        const sp = AI_BY_KEY.get(k);
        return sp ? { key: sp.key, cls: sp.cls, pawn: sp.pawn, ctrl: sp.ctrl, kind: sp.kind, lift: sp.lift } : null;
      }).filter((sp) => sp !== null),
      points: points.within(z.x, z.y, z.radiusM * 100, 200),
    })),
  };
}

/** Save what the panel sent, and hand it to the mod. */
export async function saveAiZones(raw: unknown, points: GroundPoints): Promise<AiZonesSettings> {
  const s = validateAiZones(raw);
  await writeJson(settingsPath(), s);
  await writeJson(modPath(), modFile(s, points));
  return s;
}

/** Re-write the mod's file with points gathered since (the zones themselves unchanged). */
export async function refreshModFile(points: GroundPoints): Promise<void> {
  const s = await readAiZones();
  if (s.zones.length === 0 && !s.enabled) return;
  await writeJson(modPath(), modFile(s, points));
}

export interface AiZonesStatus {
  t: number;
  /** The mod stopped reporting (off, crashed, server down). */
  stale: boolean;
  enabled: boolean;
  total: number | null;
  cap: number | null;
  zones: Record<string, {
    occupied?: boolean; count?: number | null; min?: number; max?: number; limit?: number; nextTurn?: number;
    spawned?: number; failed?: number; lastSpawn?: number; lastError?: string;
  }>;
}

export async function readAiZonesStatus(nowS = Math.floor(Date.now() / 1000)): Promise<AiZonesStatus | null> {
  try {
    const raw = JSON.parse(await readFile(statusPath(), 'utf8')) as Record<string, unknown>;
    const t = typeof raw['t'] === 'number' ? raw['t'] : 0;
    return {
      t, stale: nowS - t > 60,
      enabled: raw['enabled'] === true,
      total: typeof raw['total'] === 'number' ? raw['total'] : null,
      cap: typeof raw['cap'] === 'number' ? raw['cap'] : null,
      zones: typeof raw['zones'] === 'object' && raw['zones'] !== null ? raw['zones'] as AiZonesStatus['zones'] : {},
    };
  } catch {
    return null;
  }
}
