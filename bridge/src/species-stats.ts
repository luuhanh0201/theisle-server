/**
 * What each species' maxima are at each growth, as the game reported them on
 * this server (StatsLogger snapshots: GetMaxHealth, GetMaxHunger…). The admin
 * "create a dino" form shows them, so an admin knows what a gift will be.
 *
 * Nothing here is a guess or a table from the web: every number was read from
 * a live dino. Growth is bucketed to 1 %; in each bucket the maxima read most
 * often win, so a few odd readings (a mutation that raises a stat, a prime
 * dino whose status we missed) do not take the place of the usual ones.
 *
 * Prime elders are kept apart. Their maxima (health and stomach, by the same
 * factor) rise while they stay prime — on this server a Deinosuchus went from
 * 9 500 to 13 500 health — so for them the HIGHEST reading is kept, and how
 * many readings there were. A snapshot counts as prime when it falls inside a
 * time the "prime" events said the player's dino was a prime elder.
 */

export type StatName = 'health' | 'stamina' | 'hunger' | 'thirst' | 'oxygen' | 'blood';
export const STAT_NAMES: readonly StatName[] = ['health', 'stamina', 'hunger', 'thirst', 'oxygen', 'blood'];
export type Maxima = Partial<Record<StatName, number>>;

export interface SpeciesStatsView {
  /** Normal (not prime) maxima by growth, sorted by growth. */
  points: Array<{ growth: number; max: Maxima; t: number }>;
  /** The highest maxima seen on a prime elder of this species, if any. */
  prime: { growth: number; max: Maxima; readings: number; t: number } | null;
}

interface Interval { from: number; to: number | null }

const bucket = (growth: number): number => Math.round(growth * 100) / 100;

function cleanMax(raw: unknown): Maxima | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const out: Maxima = {};
  for (const k of STAT_NAMES) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.round(v * 100) / 100;
  }
  // A dino still loading reports 0 everywhere: not a reading.
  return out.health !== undefined ? out : null;
}

export class SpeciesStats {
  /** species -> growth bucket -> stat -> value -> how often read (and the latest time). */
  readonly #points = new Map<string, Map<number, { t: number; stats: Map<StatName, Map<number, number>> }>>();
  readonly #prime = new Map<string, { growth: number; max: Maxima; readings: number; t: number }>();
  /** Per player: when their dino was a prime elder. */
  readonly #primeTimes = new Map<string, Interval[]>();

  /** A "prime" event: from `t` the player's dino is (or is not) a prime elder. */
  primeState(steamId: string, t: number, prime: boolean): void {
    const list = this.#primeTimes.get(steamId) ?? [];
    const open = list.length > 0 && list[list.length - 1]?.to === null ? list[list.length - 1] as Interval : null;
    if (prime && open === null) list.push({ from: t, to: null });
    if (!prime && open !== null) open.to = t;
    if (list.length > 50) list.splice(0, list.length - 50);
    this.#primeTimes.set(steamId, list);
  }

  /** The dino ended (death, new spawn, left): whatever it was is over. */
  lifeEnded(steamId: string, t: number): void { this.primeState(steamId, t, false); }

  #wasPrime(steamId: string, t: number): boolean {
    return (this.#primeTimes.get(steamId) ?? []).some((i) => t >= i.from && (i.to === null || t < i.to));
  }

  /** A snapshot of a live dino. */
  snapshot(steamId: string, t: number, species: string | undefined, growth: number | null | undefined, rawMax: unknown): void {
    if (!species || typeof growth !== 'number' || !Number.isFinite(growth) || growth < 0 || growth > 1.5) return;
    const max = cleanMax(rawMax);
    if (max === null) return;
    if (this.#wasPrime(steamId, t)) {
      const best = this.#prime.get(species);
      if (best === undefined || (max.health ?? 0) > (best.max.health ?? 0)) {
        this.#prime.set(species, { growth: bucket(growth), max, readings: (best?.readings ?? 0) + 1, t });
      } else {
        best.readings += 1;
      }
      return;
    }
    let byGrowth = this.#points.get(species);
    if (byGrowth === undefined) this.#points.set(species, byGrowth = new Map());
    const g = bucket(growth);
    let seen = byGrowth.get(g);
    if (seen === undefined) byGrowth.set(g, seen = { t, stats: new Map() });
    seen.t = Math.max(seen.t, t);
    for (const k of STAT_NAMES) {
      const v = max[k];
      if (v === undefined) continue;
      let counts = seen.stats.get(k);
      if (counts === undefined) seen.stats.set(k, counts = new Map());
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }

  view(): Record<string, SpeciesStatsView> {
    const out: Record<string, SpeciesStatsView> = {};
    const names = new Set([...this.#points.keys(), ...this.#prime.keys()]);
    for (const species of [...names].sort()) {
      const points = [...(this.#points.get(species) ?? new Map<number, { t: number; stats: Map<StatName, Map<number, number>> }>()).entries()]
        .sort(([a], [b]) => a - b)
        .map(([growth, seen]) => {
          // Each stat on its own: the value read most often (ties: the higher).
          const max: Maxima = {};
          for (const [k, counts] of seen.stats) {
            max[k] = [...counts.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0]?.[0] as number;
          }
          return { growth, max, t: seen.t };
        });
      out[species] = { points, prime: this.#prime.get(species) ?? null };
    }
    return out;
  }
}

/**
 * The maxima at `growth`, from the readings: straight between the two nearest
 * growths read, the nearest one outside them. `exact` when a reading sits
 * within 1 % of that growth; `range` = the growths read.
 */
export function maximaAt(points: SpeciesStatsView['points'], growth: number): { max: Maxima; exact: boolean; from: number; to: number } | null {
  if (points.length === 0) return null;
  const first = points[0] as SpeciesStatsView['points'][number];
  const last = points[points.length - 1] as SpeciesStatsView['points'][number];
  if (growth <= first.growth) return { max: first.max, exact: Math.abs(growth - first.growth) < 0.011, from: first.growth, to: first.growth };
  if (growth >= last.growth) return { max: last.max, exact: Math.abs(growth - last.growth) < 0.011, from: last.growth, to: last.growth };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as SpeciesStatsView['points'][number];
    const b = points[i + 1] as SpeciesStatsView['points'][number];
    if (growth >= a.growth && growth <= b.growth) {
      const f = (growth - a.growth) / (b.growth - a.growth);
      const max: Maxima = {};
      for (const k of STAT_NAMES) {
        const x = a.max[k];
        const y = b.max[k];
        if (x !== undefined && y !== undefined) max[k] = Math.round((x + (y - x) * f) * 100) / 100;
      }
      const exact = Math.abs(growth - a.growth) < 0.011 || Math.abs(growth - b.growth) < 0.011;
      return { max: Math.abs(growth - a.growth) < 0.011 ? a.max : Math.abs(growth - b.growth) < 0.011 ? b.max : max, exact, from: a.growth, to: b.growth };
    }
  }
  return null;
}
