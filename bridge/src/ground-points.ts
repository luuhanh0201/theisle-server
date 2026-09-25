import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Places a player or an AI really stood — where the AIZones mod may put new
 * AI. Taking them from what walked there, not from a guess, means no AI is
 * spawned under the landscape, inside a cliff or at a made-up height (the
 * upstream spawn notes' first trap), and needs no ground trace from Lua.
 *
 * One point per 25 m cell (game units are cm), the latest seen. Swimmers and
 * fliers are left out: their positions can be in water or in the air.
 * Kept in DATA_DIR/ground-points.json so AI positions (live only) survive a
 * bridge restart; player positions come back from the snapshot replay anyway.
 */

export const CELL_CM = 2500;
/** Species whose position is not "on the ground": in the air or in water. */
const NOT_GROUND = /Pteranodon|Pterodactylus|Deinosuchus|Seaturtle|Fish|CatFish|Coelacanth|Crab/i;

export type Point = [number, number, number];

export class GroundPoints {
  readonly #cells = new Map<string, Point>();
  #dirty = false;

  get size(): number { return this.#cells.size; }

  /** A position something of `species` stood at (z = the centre of its body). */
  add(x: unknown, y: unknown, z: unknown, species?: string | null): void {
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    if (species && NOT_GROUND.test(species)) return;
    const key = `${Math.floor(x / CELL_CM)},${Math.floor(y / CELL_CM)}`;
    const prev = this.#cells.get(key);
    if (prev && prev[0] === Math.round(x) && prev[1] === Math.round(y)) return;
    this.#cells.set(key, [Math.round(x), Math.round(y), Math.round(z)]);
    this.#dirty = true;
  }

  /** Up to `max` points within `radius` of (x, y), spread over the area (not the first ones found). */
  within(x: number, y: number, radius: number, max = 200): Point[] {
    const r2 = radius * radius;
    const inside: Point[] = [];
    const c0x = Math.floor((x - radius) / CELL_CM);
    const c1x = Math.floor((x + radius) / CELL_CM);
    const c0y = Math.floor((y - radius) / CELL_CM);
    const c1y = Math.floor((y + radius) / CELL_CM);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        const p = this.#cells.get(`${cx},${cy}`);
        if (p && (p[0] - x) ** 2 + (p[1] - y) ** 2 <= r2) inside.push(p);
      }
    }
    if (inside.length <= max) return inside;
    const step = inside.length / max;
    return Array.from({ length: max }, (_, i) => inside[Math.floor(i * step)] as Point);
  }

  async load(path: string): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(path, 'utf8')) as { cells?: unknown };
      if (!Array.isArray(raw.cells)) return;
      for (const c of raw.cells) {
        if (Array.isArray(c) && c.length === 3) this.add(c[0], c[1], c[2]);
      }
      this.#dirty = false;
    } catch { /* nothing saved yet */ }
  }

  async save(path: string): Promise<void> {
    if (!this.#dirty) return;
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify({ cellCm: CELL_CM, cells: [...this.#cells.values()] }), 'utf8');
    await rename(tmp, path);
    this.#dirty = false;
  }
}
