import type { FloraSpawner } from './flora.js';
import { pointInPoly, type Point2 } from './zone-shape.js';
import type { Sanctuary } from './zone-guard.js';

/**
 * The zone prime tasks, for every species alike: being in the right zone
 * completes the task.
 *
 * The game's zones are its plant spawners (TIEdibleSpawner, exported by the
 * Flora mod): the migration zones (bShouldUseMigration, active now), the
 * patrol zones (bPatrolZone) and the juvenile ones (bJuvenilesZone, the
 * sanctuaries). The game keeps its own rules on who they count for. Measured
 * on this server (every condition that turned on by itself, 26–27/09):
 *   1 sanctuary  every species, Deinosuchus too, inside Sanctuary 67–73
 *   5 migration  only Tyrannosaurus and Carnotaurus (never a herbivore, never
 *                a Deinosuchus, one of which went through the zones for nothing)
 *   6 patrol     nobody, ever
 * So: a dino that stays DWELL_S in such a zone and still lacks that condition
 * is given it, through a prime fix (prime-fixes.ts), which the DinoGarage mod
 * applies within 5 s; the player is told by prime-notify.ts like for any task.
 * Nothing is given past the prime deadline, nor twice while the game has not
 * yet reported the first one.
 *
 * A spawner's own shape is only its plant patch (often ~20 m); the zone players
 * see, on the game's map and ours (VulnonaMAP: MZ, PZ, Sanctuary), is much
 * larger. So a task's zones are the game's (the spawners that are that kind of
 * zone now) AND each map zone of that kind with one of those spawners in it.
 */

export const DWELL_S = 60;
/** A credit waits this long for the game to report the condition before another may be made. */
export const PENDING_S = 600;
/** Prime is decided by 75 % growth: nothing to give past it. */
export const DEADLINE_GROWTH = 0.75;
/** Conditions needed to be eligible (prime.ts PRIME_NEEDED). */
const NEEDED = 5;

/** id: the spawner's; a map zone has a negative one and its name. */
export interface Zone { id: number; poly: Point2[] | null; circle: { x: number; y: number; r: number } | null; name?: string }

export type MapLayer = 'sanctuary' | 'migration' | 'patrol';

/** The zone tasks: the condition, what it is called in the notes, which spawners are its zones, the map's layer. */
export const ZONE_TASKS: Array<{ cond: string; name: string; is: (s: FloraSpawner) => boolean; layer: MapLayer }> = [
  { cond: '1', name: 'sanctuary', is: (s) => s.juvenile === true, layer: 'sanctuary' },
  { cond: '5', name: 'vung di cu', is: (s) => s.migration === true && (s.active === true || s.mass === true), layer: 'migration' },
  { cond: '6', name: 'vung tuan tra', is: (s) => s.patrol === true, layer: 'patrol' },
];

/** A spawner's area, as a polygon (spline, box) or a circle (sphere); null without a shape. */
export function zoneOf(s: FloraSpawner): Zone | null {
  const shape = s.shape ?? {};
  if (shape.spline && shape.spline.length >= 3) return { id: s.id, poly: shape.spline, circle: null };
  if (shape.box) {
    const b = shape.box;
    const t = (b.yaw * Math.PI) / 180;
    const corner = (dx: number, dy: number): Point2 =>
      [Math.round(b.x + dx * Math.cos(t) - dy * Math.sin(t)), Math.round(b.y + dx * Math.sin(t) + dy * Math.cos(t))];
    return { id: s.id, poly: [corner(-b.ex, -b.ey), corner(b.ex, -b.ey), corner(b.ex, b.ey), corner(-b.ex, b.ey)], circle: null };
  }
  if (shape.sphere) return { id: s.id, poly: null, circle: shape.sphere };
  return null;
}

/** Each zone task's zones now: condition -> zones (the spawners' own, then the map zones holding one). */
export function taskZones(spawners: FloraSpawner[], mapZones: Partial<Record<MapLayer, Sanctuary[]>> = {}): Map<string, Zone[]> {
  const out = new Map<string, Zone[]>();
  for (const task of ZONE_TASKS) {
    const game = spawners.filter(task.is);
    const zones = game.map(zoneOf).filter((z): z is Zone => z !== null);
    for (const [i, mz] of (mapZones[task.layer] ?? []).entries()) {
      if (game.some((s) => pointInPoly(mz.poly, s.x, s.y))) zones.push({ id: -(i + 1), poly: mz.poly, circle: null, name: mz.name });
    }
    out.set(task.cond, zones);
  }
  return out;
}

export function zoneAt(zones: Zone[], x: number, y: number): Zone | null {
  for (const z of zones) {
    if (z.poly !== null ? pointInPoly(z.poly, x, y) : z.circle !== null && Math.hypot(x - z.circle.x, y - z.circle.y) <= z.circle.r) return z;
  }
  return null;
}

export interface ZonePlayer {
  steamId: string;
  species: string | null;
  growth: number | null;
  x: number;
  y: number;
  /** The game's ten conditions, "1".."10" (StatsLogger "prime" events); null = not read yet. */
  conditions: Record<string, boolean> | null;
}

/** What to give: a prime fix (prime-fixes.ts addPrimeFix input). */
export interface ZoneCreditFix {
  steamId: string; species: string; minGrowth: number; maxGrowth: number;
  conditions: string; eligible?: boolean; days: number; note: string;
}

export class ZoneCredit {
  /** "steamId|cond" -> where and since when the dino has been in one of that task's zones. */
  #inside = new Map<string, { zone: string; species: string; since: number }>();
  /** "steamId|species|cond" -> when it was given (waiting for the game to report it). */
  #given = new Map<string, number>();

  /** One look (every ~10 s): the fixes to make now. */
  tick(nowS: number, players: ZonePlayer[], zones: Map<string, Zone[]>): ZoneCreditFix[] {
    const out: ZoneCreditFix[] = [];
    const seen = new Set<string>();
    for (const p of players) {
      if (p.species === null || p.growth === null || p.conditions === null) continue;
      // One condition per dino per look: each fix is applied on its own (the mod
      // takes one per pass), and the next look sees the first one reported.
      let gave = false;
      for (const task of ZONE_TASKS) {
        const key = `${p.steamId}|${task.cond}`;
        seen.add(key);
        const givenKey = `${p.steamId}|${p.species}|${task.cond}`;
        if (p.conditions[task.cond] === true) { this.#given.delete(givenKey); this.#inside.delete(key); continue; }
        const zone = zoneAt(zones.get(task.cond) ?? [], p.x, p.y);
        const was = this.#inside.get(key);
        if (zone === null) { this.#inside.delete(key); continue; }
        if (was === undefined || was.species !== p.species) {
          this.#inside.set(key, { zone: zone.name ?? `spawner ${zone.id}`, species: p.species, since: nowS });
          continue;
        }
        if (gave || nowS - was.since < DWELL_S || p.growth >= DEADLINE_GROWTH) continue;
        const givenAt = this.#given.get(givenKey);
        if (givenAt !== undefined && nowS - givenAt < PENDING_S) continue;
        this.#given.set(givenKey, nowS);
        gave = true;
        const met = Object.entries(p.conditions).filter(([k, v]) => k !== task.cond && v === true).length + 1;
        out.push({
          steamId: p.steamId, species: p.species,
          minGrowth: Math.max(0, Math.floor((p.growth - 0.05) * 100) / 100), maxGrowth: DEADLINE_GROWTH,
          conditions: Array.from({ length: 10 }, (_, i) => (String(i + 1) === task.cond ? '1' : '0')).join(''),
          ...(met >= NEEDED ? { eligible: true } : {}),
          days: 1,
          note: `Tu dong: o trong ${task.name} ${DWELL_S} s (${was.zone}) ma game chua tinh dieu kien ${task.cond}`,
        });
      }
    }
    for (const key of [...this.#inside.keys()]) if (!seen.has(key)) this.#inside.delete(key);
    return out;
  }
}
