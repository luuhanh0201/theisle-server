/**
 * Where players are, for every player's map (owner, 2026-10-04: "bản đồ nhiệt để biết được khu nào
 * có người chơi", every 5 minutes; for all players, the positions at that moment, one layer, admins
 * not counted). Only how many players stand in each square of HEAT_CELL, never who, nor where in
 * the square: the portal still never gets anyone else's position.
 *
 * One picture per HEAT_EVERY_S, on the clock (:00, :05, :10…): everyone sees the same, and it is
 * taken the first time it is asked for in that 5 minutes (nobody looking: nothing taken).
 */

export const HEAT_EVERY_S = 300;
/** World units (cm): 500 m squares. */
export const HEAT_CELL = 50_000;

export interface HeatCell {
  /** The square's centre, world units. */
  x: number;
  y: number;
  /** Players in it. */
  n: number;
}

export interface HeatMap {
  /** When the picture was taken (unix s), and when the next one is due. */
  t: number;
  next: number;
  cell: number;
  players: number;
  cells: HeatCell[];
}

export interface HeatPlayer {
  steamId: string;
  loc: { x: number; y: number } | null;
}

/** The squares with players in them, admins left out. */
export function buildHeat(players: HeatPlayer[], isAdmin: (steamId: string) => boolean, t: number, cell = HEAT_CELL): HeatMap {
  const counts = new Map<string, HeatCell>();
  let n = 0;
  for (const p of players) {
    if (p.loc === null || !Number.isFinite(p.loc.x) || !Number.isFinite(p.loc.y) || isAdmin(p.steamId)) continue;
    const cx = Math.floor(p.loc.x / cell), cy = Math.floor(p.loc.y / cell);
    const key = `${cx},${cy}`;
    const c = counts.get(key) ?? { x: (cx + 0.5) * cell, y: (cy + 0.5) * cell, n: 0 };
    c.n += 1;
    counts.set(key, c);
    n += 1;
  }
  const slot = Math.floor(t / HEAT_EVERY_S) * HEAT_EVERY_S;
  return { t, next: slot + HEAT_EVERY_S, cell, players: n, cells: [...counts.values()].sort((a, b) => b.n - a.n) };
}

/** The picture of this 5 minutes: taken once, at the first ask in it. */
export class HeatMapper {
  #last: HeatMap | null = null;

  constructor(private readonly take: () => HeatPlayer[], private readonly isAdmin: (steamId: string) => boolean) {}

  current(now = Math.floor(Date.now() / 1000)): HeatMap {
    if (this.#last === null || now >= this.#last.next) this.#last = buildHeat(this.take(), this.isAdmin, now);
    return this.#last;
  }
}
