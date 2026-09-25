import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { assertSteamId, ValidationError } from './garage.js';
import { AI_BY_KEY } from './ai-species.js';
import type { GroundPoints, Point } from './ground-points.js';

/**
 * "Drop AI next to this player", from the admin panel, run by the AIZones mod
 * (mods/AIZones). Same pattern as DinoGarage's inbox (commands.ts): the
 * bridge writes a file, the mod polls it on the game thread, runs each id
 * once and writes the outcome back.
 *
 *   <AIZones>/Saved/drops.json       this side: { drops: [...] }, atomic rename
 *   <AIZones>/Saved/drops.done.json  the mod's side: { lastId, results: [...] }
 *
 * The spots are picked here, from the ground points around where the player
 * is now (live file): places something really stood, about `distanceM`
 * away — never a guessed height. Closer than BESIDE_M the ground points
 * (one per 25 m) are too coarse: the mod puts the AI on a circle around the
 * player's own position at that moment (their height, plus the species'
 * lift), and these spots are only its fallback. A drop is an admin's explicit act: it does
 * not wait for the server-wide AI cap, only the mod's own hard limit.
 */

const DROP_TTL_SECONDS = 30;
/** Nothing closer than this to the player: no dino landing on their head. */
export const DROP_MIN_M = 10;
/** Closer than this, the mod places the AI around the player itself. */
export const BESIDE_M = 15;
const SPOTS = 30;

export interface DropRequest { steamId: string; species: string; count: number; distanceM: number; growth: number }
export interface Drop extends DropRequest {
  id: number;
  createdAt: number;
  expiresAt: number;
  sp: { key: string; cls: string; pawn: string; ctrl: string; kind: string; lift: number };
  spots: Point[];
}
export interface DropResult { id: number; ok: boolean; made?: number; error?: string; t?: number }

const dropsPath = (): string => join(config.aiZonesRoot, 'drops.json');
const donePath = (): string => join(config.aiZonesRoot, 'drops.done.json');

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

export function validateDrop(raw: unknown): DropRequest {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('body must be an object');
  const r = raw as Record<string, unknown>;
  const steamId = r['steamId'];
  if (typeof steamId !== 'string') throw new ValidationError('steamId is required');
  assertSteamId(steamId);
  const species = r['species'];
  if (typeof species !== 'string' || !AI_BY_KEY.has(species)) throw new ValidationError(`unknown AI "${String(species)}"`);
  const count = r['count'];
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 5) throw new ValidationError('count must be a whole number 1–5');
  const distanceM = r['distanceM'];
  if (typeof distanceM !== 'number' || !Number.isInteger(distanceM) || distanceM < 2 || distanceM > 200) throw new ValidationError('distanceM must be a whole number 2–200');
  const growth = r['growth'];
  if (typeof growth !== 'number' || !Number.isFinite(growth) || growth < 0.1 || growth > 1) throw new ValidationError('growth must be a number 0.1–1');
  return { steamId, species, count, distanceM, growth };
}

/**
 * Ground points around (x, y), nearest to `distanceM` first, none closer than
 * DROP_MIN_M. Empty when nothing has stood near there yet.
 */
export function dropSpots(points: GroundPoints, x: number, y: number, distanceM: number): Point[] {
  const target = distanceM * 100;
  return points.within(x, y, Math.max(target * 2, BESIDE_M * 100 * 2), 2000)
    .map((p) => ({ p, d: Math.hypot(p[0] - x, p[1] - y) }))
    .filter(({ d }) => d >= DROP_MIN_M * 100)
    .sort((a, b) => Math.abs(a.d - target) - Math.abs(b.d - target))
    .slice(0, SPOTS)
    .map(({ p }) => p);
}

// Two admins dropping at once must not both rewrite the file from the same read.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** Queue one drop. `at`: where the player is now (live file). */
export function queueDrop(req: DropRequest, at: { x: number; y: number }, points: GroundPoints, nowS = Math.floor(Date.now() / 1000)): Promise<Drop> {
  const spots = dropSpots(points, at.x, at.y, req.distanceM);
  if (spots.length === 0 && req.distanceM >= BESIDE_M) {
    return Promise.reject(new ValidationError(`no known ground within ${req.distanceM * 2} m of the player yet — try a larger distance`));
  }
  const s = AI_BY_KEY.get(req.species);
  if (!s) return Promise.reject(new ValidationError(`unknown AI "${req.species}"`));
  return serialized(async () => {
    const file = (await readJson(dropsPath())) as { drops?: unknown } | null;
    const done = (await readJson(donePath())) as { lastId?: unknown } | null;
    const lastDone = typeof done?.lastId === 'number' ? done.lastId : 0;
    const existing = Array.isArray(file?.drops) ? (file.drops as Drop[]) : [];
    const maxId = existing.reduce((m, d) => (typeof d?.id === 'number' ? Math.max(m, d.id) : m), lastDone);
    // Keep only what the mod has not run and still can.
    const pending = existing.filter((d) => typeof d?.id === 'number' && d.id > lastDone && d.expiresAt >= nowS);
    const drop: Drop = {
      ...req, id: maxId + 1, createdAt: nowS, expiresAt: nowS + DROP_TTL_SECONDS,
      sp: { key: s.key, cls: s.cls, pawn: s.pawn, ctrl: s.ctrl, kind: s.kind, lift: s.lift },
      spots,
    };
    pending.push(drop);
    await mkdir(config.aiZonesRoot, { recursive: true });
    const tmp = `${dropsPath()}.tmp`;
    await writeFile(tmp, JSON.stringify({ drops: pending }), 'utf8');
    await rename(tmp, dropsPath());
    return drop;
  });
}

/** The mod's outcome for a drop id, or null while it has not run yet. */
export async function dropResult(id: number): Promise<DropResult | null> {
  const done = (await readJson(donePath())) as { results?: unknown } | null;
  const results = Array.isArray(done?.results) ? (done.results as DropResult[]) : [];
  return results.find((r) => r?.id === id) ?? null;
}
