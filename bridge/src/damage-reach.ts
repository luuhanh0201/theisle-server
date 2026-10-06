import type { Loc } from './events.js';

/**
 * How far a bite reached, and whether that is far beyond what its species
 * usually reaches (the owner, 2026-10-07: "đo và tự nhận diện khoảng cách gây
 * dame bất thường"). StatsLogger sends where both dinos stood when the game
 * applied the hit (damage `attackerLoc` / `loc`, the actors' centres, world
 * units = cm); the distance between them is the bite's reach.
 *
 * No table of dino sizes: the bridge learns each species' usual reach from
 * the bites it sees (players' hits on players and on AI), apart for the
 * young (growth under YOUNG) and the grown, since size follows growth. A
 * bite is "far" when it is beyond Q3 + 3 × IQR of those (Tukey's far-out
 * fence), never under FLOOR_M; above HARD_M always (no bite reaches that).
 * Until a species has MIN_SAMPLES bites, its whole species is used, then
 * DEFAULT_M. A far bite is not learned from, so a cheater cannot widen it.
 *
 * Nothing is stored: the events are replayed at startup in the same order,
 * so the same bites learn the same limits and get the same verdicts.
 */

export const REACH_RULES = {
  /** Bites a group needs before its own limit is used. */
  MIN_SAMPLES: 30,
  /** The newest bites a group keeps. */
  KEEP: 1000,
  /** A limit is never below this (metres). */
  FLOOR_M: 6,
  /** Before a species has learned anything (metres). */
  DEFAULT_M: 25,
  /** Always far (metres). */
  HARD_M: 40,
  /** The fence: Q3 + FENCE × IQR. */
  FENCE: 3,
  /** Growth under this: the young group. */
  YOUNG: 0.5,
} as const;

export type ReachBasis = 'learned' | 'species' | 'default';

export interface Reach {
  /** Metres between the two dinos (3D, centre to centre), one decimal. */
  distM: number;
  /** The limit it was judged against (metres, one decimal). */
  limitM: number;
  /** Where the limit came from: this species at this size, the whole species, or the default. */
  basis: ReachBasis;
  far: boolean;
}

export interface ReachGroup {
  /** The attacker's class name (BP_Tyrannosaurus_C). */
  species: string;
  /** 'young' (growth < YOUNG), 'grown', or 'all' (the whole species). */
  size: 'young' | 'grown' | 'all';
  samples: number;
  medianM: number;
  p95M: number;
  /** null while it has fewer than MIN_SAMPLES bites. */
  limitM: number | null;
}

/** Metres between two world positions (cm), 3D, one decimal. */
export function distanceM(a: Loc, b: Loc): number {
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y, dz) / 10) / 10;
}

const isLoc = (l: unknown): l is Loc => typeof l === 'object' && l !== null
  && Number.isFinite((l as Loc).x) && Number.isFinite((l as Loc).y);
const round1 = (v: number): number => Math.round(v * 10) / 10;

/** The q-th quantile of sorted values (linear between the two nearest). */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (at - lo);
}

/** The sorted copy (for the limit) is redone after this many new bites: the replay at startup goes through every bite. */
const RESORT_AFTER = 20;

interface Group { values: number[]; next: number; sorted: number[] | null; since: number }

export class DamageReach {
  readonly #groups = new Map<string, Group>();

  /**
   * The bite's reach and verdict, learned from when it is not far. null when
   * either position is missing (StatsLogger before 2026-10-07, an AI attacker).
   */
  judge(e: { attackerSpecies?: string; attackerGrowth?: number; loc?: Loc; attackerLoc?: Loc }): Reach | null {
    if (!isLoc(e.loc) || !isLoc(e.attackerLoc) || !e.attackerSpecies) return null;
    const distM = distanceM(e.attackerLoc, e.loc);
    const keys = this.#keys(e.attackerSpecies, e.attackerGrowth);
    let limitM: number = REACH_RULES.DEFAULT_M;
    let basis: ReachBasis = 'default';
    for (const [i, key] of keys.entries()) {
      const l = this.#limit(key);
      if (l !== null) { limitM = l; basis = i === 0 && keys.length === 2 ? 'learned' : 'species'; break; }
    }
    limitM = round1(Math.min(limitM, REACH_RULES.HARD_M));
    const far = distM > limitM;
    if (!far) for (const key of keys) this.#add(key, distM);
    return { distM, limitM, basis, far };
  }

  /** Every group with a bite, by species then size. */
  groups(): ReachGroup[] {
    const out: ReachGroup[] = [];
    for (const [key, g] of this.#groups) {
      const [species = '', size = 'all'] = key.split('|');
      const sorted = this.#sorted(g);
      out.push({ species, size: size as ReachGroup['size'], samples: g.values.length, medianM: round1(quantile(sorted, 0.5)),
        p95M: round1(quantile(sorted, 0.95)), limitM: this.#limit(key) });
    }
    const order = { young: 0, grown: 1, all: 2 };
    return out.sort((a, b) => a.species.localeCompare(b.species) || order[a.size] - order[b.size]);
  }

  /** [this species at this size, the whole species]; only the latter when the growth is unknown. */
  #keys(species: string, growth: number | undefined): string[] {
    const all = `${species}|all`;
    if (typeof growth !== 'number' || !Number.isFinite(growth)) return [all];
    return [`${species}|${growth < REACH_RULES.YOUNG ? 'young' : 'grown'}`, all];
  }

  #add(key: string, distM: number): void {
    let g = this.#groups.get(key);
    if (g === undefined) { g = { values: [], next: 0, sorted: null, since: 0 }; this.#groups.set(key, g); }
    // A ring of the newest KEEP bites.
    if (g.values.length < REACH_RULES.KEEP) g.values.push(distM);
    else { g.values[g.next] = distM; g.next = (g.next + 1) % REACH_RULES.KEEP; }
    g.since += 1;
    // Exact while it is learning its first bites, then refreshed every RESORT_AFTER.
    if (g.values.length <= REACH_RULES.MIN_SAMPLES || g.since >= RESORT_AFTER) g.sorted = null;
  }

  #sorted(g: Group): number[] {
    if (g.sorted === null) { g.sorted = [...g.values].sort((a, b) => a - b); g.since = 0; }
    return g.sorted;
  }

  #limit(key: string): number | null {
    const g = this.#groups.get(key);
    if (g === undefined || g.values.length < REACH_RULES.MIN_SAMPLES) return null;
    const sorted = this.#sorted(g);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    return round1(Math.min(Math.max(REACH_RULES.FLOOR_M, q3 + REACH_RULES.FENCE * (q3 - q1)), REACH_RULES.HARD_M));
  }
}
