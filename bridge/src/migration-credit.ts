import type { FloraSpawner } from './flora.js';
import { pointInPoly, type Point2 } from './zone-shape.js';

/**
 * Prime condition 5 (migration) for every species alike.
 *
 * The game's migration zones are its plant spawners (TIEdibleSpawner, exported
 * by the Flora mod): each active one is assigned to some species only
 * (MigrationDinoTypes). On this server condition 5 turned on for Trike, Rex,
 * Pachy, Cerato, Carno, Ptera and Gallimimus — never once for a Deinosuchus,
 * one of which went through the migration zones for nothing (2026-09-27).
 * So: a dino that stays MIGRATION_DWELL_S in an active migration zone (any
 * zone, whatever species it was made for) and still lacks condition 5 is given
 * it — through a prime fix (prime-fixes.ts), which the DinoGarage mod applies
 * within 5 s. Nothing is given past the prime deadline, nor twice while the
 * game has not yet reported the first one.
 */

export const MIGRATION_DWELL_S = 60;
/** A credit waits this long for the game to report condition 5 before another may be made. */
export const PENDING_S = 600;
/** Prime is decided by 75 % growth: nothing to give past it. */
export const DEADLINE_GROWTH = 0.75;
/** Conditions needed to be eligible (prime.ts PRIME_NEEDED). */
const NEEDED = 5;

export interface MigrationZone { id: number; poly: Point2[] | null; circle: { x: number; y: number; r: number } | null }

/** The active migration zones, each as a polygon (spline, box) or a circle (sphere). */
export function activeMigrationZones(spawners: FloraSpawner[]): MigrationZone[] {
  const out: MigrationZone[] = [];
  for (const s of spawners) {
    if (s.migration !== true || (s.active !== true && s.mass !== true)) continue;
    const shape = s.shape ?? {};
    if (shape.spline && shape.spline.length >= 3) {
      out.push({ id: s.id, poly: shape.spline, circle: null });
    } else if (shape.box) {
      const b = shape.box;
      const t = (b.yaw * Math.PI) / 180;
      const corner = (dx: number, dy: number): Point2 =>
        [Math.round(b.x + dx * Math.cos(t) - dy * Math.sin(t)), Math.round(b.y + dx * Math.sin(t) + dy * Math.cos(t))];
      out.push({ id: s.id, poly: [corner(-b.ex, -b.ey), corner(b.ex, -b.ey), corner(b.ex, b.ey), corner(-b.ex, b.ey)], circle: null });
    } else if (shape.sphere) {
      out.push({ id: s.id, poly: null, circle: shape.sphere });
    }
  }
  return out;
}

export function zoneAt(zones: MigrationZone[], x: number, y: number): MigrationZone | null {
  for (const z of zones) {
    if (z.poly !== null ? pointInPoly(z.poly, x, y) : z.circle !== null && Math.hypot(x - z.circle.x, y - z.circle.y) <= z.circle.r) return z;
  }
  return null;
}

export interface MigrationPlayer {
  steamId: string;
  species: string | null;
  growth: number | null;
  x: number;
  y: number;
  /** The game's ten conditions, "1".."10" (StatsLogger "prime" events); null = not read yet. */
  conditions: Record<string, boolean> | null;
}

/** What to give: a prime fix (prime-fixes.ts addPrimeFix input). */
export interface MigrationCreditFix {
  steamId: string; species: string; minGrowth: number; maxGrowth: number;
  conditions: string; eligible?: boolean; days: number; note: string;
}

export class MigrationCredit {
  /** steamId -> where and since when the dino has been in a zone. */
  #inside = new Map<string, { zone: number; species: string; since: number }>();
  /** "steamId|species" -> when it was given (waiting for the game to report it). */
  #given = new Map<string, number>();

  /** One look (every ~10 s): the fixes to make now. */
  tick(nowS: number, players: MigrationPlayer[], zones: MigrationZone[]): MigrationCreditFix[] {
    const out: MigrationCreditFix[] = [];
    const seen = new Set<string>();
    for (const p of players) {
      if (p.species === null || p.growth === null || p.conditions === null) continue;
      seen.add(p.steamId);
      const key = `${p.steamId}|${p.species}`;
      if (p.conditions['5'] === true) { this.#given.delete(key); this.#inside.delete(p.steamId); continue; }
      const zone = zoneAt(zones, p.x, p.y);
      const was = this.#inside.get(p.steamId);
      if (zone === null) { this.#inside.delete(p.steamId); continue; }
      if (was === undefined || was.species !== p.species) {
        this.#inside.set(p.steamId, { zone: zone.id, species: p.species, since: nowS });
        continue;
      }
      if (nowS - was.since < MIGRATION_DWELL_S || p.growth >= DEADLINE_GROWTH) continue;
      const givenAt = this.#given.get(key);
      if (givenAt !== undefined && nowS - givenAt < PENDING_S) continue;
      this.#given.set(key, nowS);
      const met = Object.entries(p.conditions).filter(([k, v]) => k !== '5' && v === true).length + 1;
      out.push({
        steamId: p.steamId, species: p.species,
        minGrowth: Math.max(0, Math.floor((p.growth - 0.05) * 100) / 100), maxGrowth: DEADLINE_GROWTH,
        conditions: '0000100000',
        ...(met >= NEEDED ? { eligible: true } : {}),
        days: 1,
        note: `Tu dong: o trong vung di cu dang mo ${MIGRATION_DWELL_S} s (zone ${was.zone}) ma game chua tinh dieu kien 5`,
      });
    }
    for (const id of [...this.#inside.keys()]) if (!seen.has(id)) this.#inside.delete(id);
    return out;
  }
}
