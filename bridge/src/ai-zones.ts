import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { ValidationError } from './garage.js';
import { AI_BY_KEY } from './ai-species.js';
import type { GroundPoints, Point } from './ground-points.js';
import { boundRadiusCm, centreOf, insideZone, polyArea, zoneOutline, type Point2, type ZoneShape } from './zone-shape.js';

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
  /** Circle radius; an ellipse's semi-axis along angleDeg; a polygon's reach from its centre (derived). */
  radiusM: number;
  /** circle (default), ellipse or polygon — zone-shape.ts. */
  shape: ZoneShape;
  /** Ellipse: the other semi-axis (m). */
  radius2M?: number;
  /** Ellipse: direction of radiusM, degrees in the game's X/Y plane. */
  angleDeg?: number;
  /** Polygon: its corners, game units (cm); x/y is their centre. */
  poly?: Point2[];
  species: string[];
  /** Always there, player or not. */
  min: number;
  /** Filled up to while a player is inside. */
  max: number;
  /** Each turn (every `everySec`, a player inside) adds a random count in this range. */
  perTurnMin: number;
  perTurnMax: number;
  everySec: number;
  /** No new AI closer than this to any living AI (or another new one): herds stay spread out. */
  spacingM: number;
  growthMin: number;
  growthMax: number;
  /** Small dinos only: a player grown past its species' limit is warned, then stung (zone-guard.ts). */
  smallOnly: boolean;
  /** A water zone (a lake, a river bank): the species in ignoreOccupants (a crocodile) fill it too. */
  water: boolean;
}

export interface AiZonesSettings {
  enabled: boolean;
  globalMax: number;
  zones: AiZone[];
  /** Player species that never make a zone "occupied" (a crocodile in a lake does not fill a land zone). */
  ignoreOccupants: string[];
}

export const DEFAULT_IGNORE_OCCUPANTS = ['Deinosuchus'];
export const AI_ZONES_DEFAULTS: AiZonesSettings = { enabled: false, globalMax: 150, zones: [], ignoreOccupants: [...DEFAULT_IGNORE_OCCUPANTS] };
const MAX_ZONES = 40;
/** Zones saved before spacing existed get this. */
export const DEFAULT_SPACING_M = 40;

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
  const spacingM = int(r['spacingM'] ?? DEFAULT_SPACING_M, 0, 300, `${at}: spacingM`);
  const growthMin = real(r['growthMin'], 0.1, 1, `${at}: growthMin`);
  const growthMax = real(r['growthMax'], 0.1, 1, `${at}: growthMax`);
  if (growthMin > growthMax) throw new ValidationError(`${at}: growthMin is above growthMax`);
  const shape = r['shape'] ?? 'circle';
  if (shape !== 'circle' && shape !== 'ellipse' && shape !== 'polygon') throw new ValidationError(`${at}: shape must be circle, ellipse or polygon`);
  let x: number;
  let y: number;
  let radiusM: number;
  const extra: Pick<AiZone, 'radius2M' | 'angleDeg' | 'poly'> = {};
  if (shape === 'polygon') {
    const raw = r['poly'];
    if (!Array.isArray(raw) || raw.length < 3 || raw.length > 40) throw new ValidationError(`${at}: a polygon needs 3–40 corners`);
    const poly = raw.map((p, i): Point2 => {
      if (!Array.isArray(p) || p.length !== 2) throw new ValidationError(`${at}: corner ${i + 1} must be [x, y]`);
      return [Math.round(real(p[0], -2_000_000, 2_000_000, `${at}: corner ${i + 1} x`)), Math.round(real(p[1], -2_000_000, 2_000_000, `${at}: corner ${i + 1} y`))];
    });
    if (polyArea(poly) < 50_00 * 50_00) throw new ValidationError(`${at}: the polygon is too small or its corners are on one line`);
    [x, y] = centreOf(poly);
    extra.poly = poly;
    radiusM = Math.ceil(boundRadiusCm({ x, y, radiusM: 0, shape, poly }) / 100);
    if (radiusM > 5000) throw new ValidationError(`${at}: the polygon reaches ${radiusM} m from its centre (5000 at most)`);
  } else {
    x = real(r['x'], -2_000_000, 2_000_000, `${at}: x`);
    y = real(r['y'], -2_000_000, 2_000_000, `${at}: y`);
    radiusM = int(r['radiusM'], 50, 5000, `${at}: radius (m)`);
    if (shape === 'ellipse') {
      extra.radius2M = int(r['radius2M'], 50, 5000, `${at}: radius2M`);
      extra.angleDeg = Math.round(real(r['angleDeg'] ?? 0, -180, 180, `${at}: angleDeg`));
    }
  }
  return {
    id, name,
    enabled: r['enabled'] !== false,
    x, y, radiusM, shape, ...extra,
    species: species as string[],
    min, max, perTurnMin, perTurnMax, spacingM,
    everySec: int(r['everySec'], 10, 3600, `${at}: everySec`),
    growthMin, growthMax,
    smallOnly: r['smallOnly'] === true,
    water: r['water'] === true,
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
  // Saved before this setting: the default (a Deinosuchus does not fill land zones).
  const ig = r['ignoreOccupants'] ?? DEFAULT_IGNORE_OCCUPANTS;
  if (!Array.isArray(ig) || ig.length > 40) throw new ValidationError('ignoreOccupants must be a list');
  const ignoreOccupants = [...new Set(ig.map((s, i) => {
    if (typeof s !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{1,40}$/.test(s)) throw new ValidationError(`ignoreOccupants[${i}] is not a species`);
    return s;
  }))];
  return { enabled: r['enabled'], globalMax: int(r['globalMax'], 0, 5000, 'globalMax'), zones, ignoreOccupants };
}

export async function readAiZones(): Promise<AiZonesSettings> {
  try {
    return validateAiZones(JSON.parse(await readFile(settingsPath(), 'utf8')));
  } catch {
    return { ...AI_ZONES_DEFAULTS, zones: [], ignoreOccupants: [...DEFAULT_IGNORE_OCCUPANTS] };
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value)}\n`, 'utf8');
  await rename(tmp, path);
}

/** Up to `max` ground points inside the zone's shape, spread over it. */
export function zonePoints(z: AiZone, points: GroundPoints, max = 200): Point[] {
  const inside = points.within(z.x, z.y, boundRadiusCm(z), 1_000_000).filter((p) => insideZone(z, p[0], p[1]));
  if (inside.length <= max) return inside;
  const step = inside.length / max;
  return Array.from({ length: max }, (_, i) => inside[Math.floor(i * step)] as Point);
}

/** What the mod reads: species resolved to classes, radius in cm, the spawn points of each zone. */
export function modFile(s: AiZonesSettings, points: GroundPoints): unknown {
  return {
    enabled: s.enabled,
    globalMax: s.globalMax,
    ignoreOccupants: (s.ignoreOccupants ?? DEFAULT_IGNORE_OCCUPANTS).map((k) => `BP_${k}_C`),
    zones: s.zones.map((z) => ({
      id: z.id, name: z.name, enabled: z.enabled, x: z.x, y: z.y,
      // The circle around the shape, and the shape itself when it is not a circle.
      radius: boundRadiusCm(z),
      ...(zoneOutline(z) ? { poly: zoneOutline(z) } : {}),
      water: z.water === true,
      min: z.min, max: z.max, perTurnMin: z.perTurnMin, perTurnMax: z.perTurnMax, every: z.everySec,
      spacing: z.spacingM * 100,
      growthMin: z.growthMin, growthMax: z.growthMax,
      species: z.species.map((k) => {
        const sp = AI_BY_KEY.get(k);
        return sp ? { key: sp.key, cls: sp.cls, pawn: sp.pawn, ctrl: sp.ctrl, kind: sp.kind, lift: sp.lift } : null;
      }).filter((sp) => sp !== null),
      points: zonePoints(z, points),
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
