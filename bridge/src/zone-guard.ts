import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { ValidationError } from './garage.js';
import { readAiZones, type AiZonesSettings } from './ai-zones.js';
import { boundRadiusCm, centreOf, zoneOutline, type Point2 } from './zone-shape.js';

/**
 * "Small dinos only" zones (mods/ZoneGuard): in the AI zones an admin marked
 * (AiZone.smallOnly) and the sanctuaries an admin ticked, a player's dino
 * grown past its species' limit is warned, then — `graceSec` later, while it
 * stays — stung: every `everySec` it loses `pct`% of its maximum health, as
 * the bees of the game's own sanctuaries do. Leaving stops it; staying kills.
 *
 *   DATA_DIR/zone-guard.json          what the panel saved (this file owns it)
 *   <ZoneGuard>/Saved/guard.json      what the mod reads: the rules and every
 *                                     guarded shape in game units (cm)
 *
 * The limits are per species (the class name without BP_ / _C: "Carnotaurus"),
 * as a growth fraction (0.5 = 50 %); a species not listed has `defaultMax`.
 * The sanctuaries' shapes are the map's (VulnonaMAP, layer "sanctuary"): the
 * panel shows the same ones.
 */
export interface ZoneGuardSettings {
  enabled: boolean;
  /** Seconds between the warning and the first sting. */
  graceSec: number;
  /** Seconds between two stings. */
  everySec: number;
  /** % of the maximum health one sting takes. */
  pct: number;
  /** Growth (0–1) allowed for a species without its own limit. */
  defaultMax: number;
  maxBySpecies: Record<string, number>;
  /** Names of the map's sanctuaries ("Sanctuary 67") that are guarded. */
  sanctuaries: string[];
}

export const ZONE_GUARD_DEFAULTS: ZoneGuardSettings = {
  enabled: false, graceSec: 30, everySec: 5, pct: 5, defaultMax: 0.5, maxBySpecies: {}, sanctuaries: [],
};

export interface Sanctuary { name: string; x: number; y: number; poly: Point2[] }

const settingsPath = (): string => join(config.dataDir, 'zone-guard.json');
const modPath = (): string => join(config.zoneGuardRoot, 'guard.json');
const MAP_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'map', 'gateway.json');
const ELLIPSE_SIDES = 24;

function int(v: unknown, lo: number, hi: number, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new ValidationError(`${what} must be a whole number ${lo}–${hi}`);
  return v;
}
function growth(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0.05 || v > 1) throw new ValidationError(`${what} must be a growth 0.05–1`);
  return Math.round(v * 100) / 100;
}

export function validateZoneGuard(raw: unknown, sanctuaryNames: ReadonlySet<string> | null = null): ZoneGuardSettings {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('body must be an object');
  const r = raw as Record<string, unknown>;
  if (typeof r['enabled'] !== 'boolean') throw new ValidationError('enabled must be true or false');
  const maxRaw = r['maxBySpecies'] ?? {};
  if (typeof maxRaw !== 'object' || maxRaw === null || Array.isArray(maxRaw)) throw new ValidationError('maxBySpecies must be an object');
  const maxBySpecies: Record<string, number> = {};
  for (const [k, v] of Object.entries(maxRaw)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{1,40}$/.test(k)) throw new ValidationError(`maxBySpecies: "${k}" is not a species`);
    maxBySpecies[k] = growth(v, `maxBySpecies.${k}`);
  }
  if (Object.keys(maxBySpecies).length > 60) throw new ValidationError('maxBySpecies: at most 60 species');
  const sancRaw = r['sanctuaries'] ?? [];
  if (!Array.isArray(sancRaw) || sancRaw.length > 50) throw new ValidationError('sanctuaries must be a list of at most 50');
  const sanctuaries = [...new Set(sancRaw.map((s, i) => {
    if (typeof s !== 'string' || s.length === 0 || s.length > 80) throw new ValidationError(`sanctuaries[${i}] must be a name`);
    if (sanctuaryNames && !sanctuaryNames.has(s)) throw new ValidationError(`unknown sanctuary "${s}"`);
    return s;
  }))];
  return {
    enabled: r['enabled'],
    graceSec: int(r['graceSec'], 0, 600, 'graceSec'),
    everySec: int(r['everySec'], 1, 60, 'everySec'),
    pct: int(r['pct'], 1, 100, 'pct'),
    defaultMax: growth(r['defaultMax'], 'defaultMax'),
    maxBySpecies,
    sanctuaries,
  };
}

export async function readZoneGuard(): Promise<ZoneGuardSettings> {
  try {
    return validateZoneGuard(JSON.parse(await readFile(settingsPath(), 'utf8')));
  } catch {
    return structuredClone(ZONE_GUARD_DEFAULTS);
  }
}

/**
 * The map's sanctuaries, as polygons in game units. The map works in
 * [game Y, game X] / 1000 (vulnona.ts); a circle is turned into a polygon.
 */
export function sanctuariesOf(map: unknown): Sanctuary[] {
  const features = (map as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const toGame = (p: unknown): Point2 | null => (Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number'
    ? [Math.round(p[1] * 1000), Math.round(p[0] * 1000)] : null);
  const out: Sanctuary[] = [];
  for (const f of features as Array<Record<string, unknown>>) {
    if (f['layer'] !== 'sanctuary' || typeof f['name'] !== 'string') continue;
    let ring: Point2[] = [];
    if (f['kind'] === 'poly' && Array.isArray(f['pts']) && Array.isArray(f['pts'][0])) {
      ring = (f['pts'][0] as unknown[]).map(toGame).filter((p): p is Point2 => p !== null);
    } else if (f['kind'] === 'circle' && Array.isArray(f['at']) && Array.isArray(f['r'])) {
      const [ax, ay] = f['at'] as number[];
      const [rx, ry] = f['r'] as number[];
      const t = ((typeof f['rot'] === 'number' ? f['rot'] : 0) * Math.PI) / 180;
      for (let i = 0; i < ELLIPSE_SIDES; i++) {
        const u = (i / ELLIPSE_SIDES) * Math.PI * 2;
        const ex = (rx as number) * Math.cos(u);
        const ey = (ry as number) * Math.sin(u);
        const p = toGame([(ax as number) + ex * Math.cos(t) - ey * Math.sin(t), (ay as number) + ex * Math.sin(t) + ey * Math.cos(t)]);
        if (p) ring.push(p);
      }
    }
    if (ring.length < 3) continue;
    const [x, y] = centreOf(ring);
    out.push({ name: f['name'], x, y, poly: ring });
  }
  return out;
}

export async function readSanctuaries(file = MAP_FILE): Promise<Sanctuary[]> {
  try {
    return sanctuariesOf(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return [];
  }
}

/** What the mod reads: the rules and every guarded shape (a circle, or a polygon with its bounding circle). */
export function modFile(s: ZoneGuardSettings, zones: AiZonesSettings, sanctuaries: Sanctuary[]): unknown {
  const guarded = new Set(s.sanctuaries);
  const shapes = [
    ...zones.zones.filter((z) => z.smallOnly).map((z) => ({
      name: z.name, kind: 'ai', x: z.x, y: z.y, radius: boundRadiusCm(z),
      ...(zoneOutline(z) ? { poly: zoneOutline(z) } : {}),
    })),
    ...sanctuaries.filter((c) => guarded.has(c.name)).map((c) => ({
      name: c.name, kind: 'sanctuary', x: c.x, y: c.y,
      radius: Math.ceil(Math.max(...c.poly.map(([px, py]) => Math.hypot(px - c.x, py - c.y)))),
      poly: c.poly,
    })),
  ];
  return {
    enabled: s.enabled, grace: s.graceSec, every: s.everySec, pct: s.pct,
    defaultMax: s.defaultMax, max: s.maxBySpecies, zones: shapes,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value)}\n`, 'utf8');
  await rename(tmp, path);
}

/** Rewrite the mod's file from what is saved (after either the rules or the AI zones change, and at start). */
export async function syncZoneGuard(): Promise<void> {
  await writeJson(modPath(), modFile(await readZoneGuard(), await readAiZones(), await readSanctuaries()));
}

export async function saveZoneGuard(raw: unknown): Promise<ZoneGuardSettings> {
  const names = new Set((await readSanctuaries()).map((c) => c.name));
  const s = validateZoneGuard(raw, names.size ? names : null);
  await writeJson(settingsPath(), s);
  await syncZoneGuard();
  return s;
}
