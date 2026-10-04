/**
 * The garage across a crash or a restart (owner, 2026-10-04: "khi cất/lấy mà … sập sv coi như
 * không thành công và không được mất dino"). Dev-Lucii took a T-Rex out at 10:39:16, the server
 * crashed at 10:39:54: the slot was already out of the garage (deleted/…__redeemed-…json), the
 * game had not saved the restored dino, and back on the server the game gave a hatchling.
 *
 * The game keeps the players' dinos in its own (encrypted) database, saved when it saves; the
 * garage moves files at once. Between the two, a server going down loses the difference. This
 * watches the garage's own events and the server's starts, and settles each action the first
 * time the player is back on a dino after a start:
 *
 *   taken out (garage_redeem_start → garage_redeem ok), then the server started again before the
 *   player logged off, died or used the garage again:
 *     back on that dino (same species, at least the growth it came out with) → the game kept it;
 *     on anything else (a hatchling, an older save)                          → the slot goes back
 *                                                                               from its history file
 *     the restore never finished (no garage_redeem ok before the start)    → the slot goes back at once
 *
 *   stored (garage_store), then the server started again before the player logged off:
 *     back on the stored dino (same species, its growth)  → the game never saved the store: the slot
 *                                                           goes to deleted/ (the store did not happen)
 *     on anything else                                    → the store stands
 *
 * A logout (session_end) saves the player in the game: what was done before it is settled. The
 * events are read again from the start at every bridge start: the decisions come out the same,
 * and `resolved` (kept on disk) stops an action from running twice; only actions after `since`
 * (the first start of this guard) are looked at, never the garage's whole past.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { ConflictError, findRedeemHistory, historyExists, nextFreeSlot, restoreFromHistory, undoStore } from './garage.js';

/** Growth the game may add between the action and the save it loads from (x2 growth, a long session). */
const GROWTH_AHEAD = 0.15;
/** Below the stored growth by more than this: not the stored dino. */
const GROWTH_SLACK = 0.005;
/** A hatchling: every dino spawns at 0.25 — a slot this young cannot be told from a fresh spawn. */
const FRESH_GROWTH = 0.26;

interface Pending {
  key: string;
  kind: 'redeem' | 'store';
  steamId: string;
  slot: string;
  species: string;
  growth: number;
  t: number;
  /** Redeem: the history file the slot went to (deleted/…__redeemed-<t>.json), when the mod named it. */
  file: string | null;
  /** Redeem: the restore finished (garage_redeem ok). */
  restored: boolean;
  /** When the server started again with this still open. */
  restartedAt: number | null;
}

export type GuardAction =
  | { kind: 'put-back'; key: string; steamId: string; slot: string; file: string | null; species: string; growth: number; t: number; why: string }
  | { kind: 'undo-store'; key: string; steamId: string; slot: string; species: string; growth: number; t: number; why: string };

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export class GarageGuard {
  readonly #since: number;
  readonly #resolved: Set<string>;
  readonly #pending = new Map<string, Pending>();

  /** `since`: actions before it are never looked at. `resolved`: keys already acted on. */
  constructor(since: number, resolved: Iterable<string> = []) {
    this.#since = since;
    this.#resolved = new Set(resolved);
  }

  get since(): number { return this.#since; }
  /** Mark an action done (it ran, or was found not needed): never returned again. */
  resolve(key: string): void { this.#resolved.add(key); }
  get resolved(): string[] { return [...this.#resolved]; }
  /** What is still open, for the log and the tests. */
  get pending(): Pending[] { return [...this.#pending.values()]; }

  /** One event from events.ndjson, in file order. Returns what to do now (often nothing). */
  onEvent(event: object): GuardAction[] {
    // Any event of either stream: only its fields are read, each checked for its type.
    const e = event as Record<string, unknown>;
    const type = e['type'];
    const t = num(e['t']);
    if (t === null) return [];
    if (type === 'mod_loaded') return e['mod'] === 'DinoGarage' ? this.#started(t) : [];
    const steamId = str(e['steamId']);
    if (steamId === null) return [];
    const open = this.#pending.get(steamId);
    switch (type) {
      case 'garage_redeem_start': {
        const slot = str(e['slot']);
        const species = str(e['species']);
        const growth = num(e['growth']);
        if (t < this.#since || slot === null || species === null || growth === null) return [];
        this.#open({ key: `${steamId}:redeem:${slot}:${t}`, kind: 'redeem', steamId, slot, species, growth, t,
          file: str(e['file']), restored: false, restartedAt: null });
        return [];
      }
      case 'garage_redeem': {
        if (t < this.#since) return [];
        const slot = str(e['slot']);
        if (open?.kind === 'redeem' && open.slot === slot && !open.restored) {
          // Not ok: the mod put the slot back itself.
          if (e['ok'] === true) open.restored = true; else this.#pending.delete(steamId);
          return [];
        }
        // A mod from before garage_redeem_start: the history file is found by its time.
        const species = str(e['species']);
        const growth = num(e['growth']);
        if (e['ok'] === true && slot !== null && species !== null && growth !== null && open?.t !== t) {
          this.#open({ key: `${steamId}:redeem:${slot}:${t}`, kind: 'redeem', steamId, slot, species, growth, t,
            file: null, restored: true, restartedAt: null });
        }
        return [];
      }
      case 'garage_store': {
        const slot = str(e['slot']);
        const species = str(e['species']);
        const growth = num(e['growth']);
        if (t < this.#since || slot === null || species === null || growth === null) return [];
        this.#open({ key: `${steamId}:store:${slot}:${t}`, kind: 'store', steamId, slot, species, growth, t,
          file: null, restored: true, restartedAt: null });
        return [];
      }
      case 'session_end':
        // Logged off in the same server run: the game saved the player as they were.
        if (open !== undefined && open.restartedAt === null && t >= open.t) this.#pending.delete(steamId);
        return [];
      case 'death':
        // The redeemed dino lived and died: nothing to give back. (A store's own corpse dies too: not this.)
        if (open?.kind === 'redeem' && open.restored && open.restartedAt === null && t > open.t) this.#pending.delete(steamId);
        return [];
      case 'spawn':
        return open === undefined ? [] : this.#spawned(open, t, str(e['classPath']), num(e['growth']));
      default:
        return [];
    }
  }

  #open(p: Pending): void {
    // A newer garage action settles the one before it: the player went on with the game.
    this.#pending.set(p.steamId, p);
  }

  #started(t: number): GuardAction[] {
    const out: GuardAction[] = [];
    for (const p of [...this.#pending.values()]) {
      if (p.restartedAt !== null || p.t >= t) continue;
      p.restartedAt = t;
      if (p.kind === 'redeem' && !p.restored) {
        // Down during the restore itself: the dino never came out.
        this.#pending.delete(p.steamId);
        const a = this.#act({ kind: 'put-back', key: p.key, steamId: p.steamId, slot: p.slot, file: p.file,
          species: p.species, growth: p.growth, t: p.t, why: 'server down during the restore' });
        if (a !== null) out.push(a);
      }
    }
    return out;
  }

  #spawned(p: Pending, t: number, classPath: string | null, growth: number | null): GuardAction[] {
    if (t <= p.t) return [];
    if (p.restartedAt === null) {
      // A new dino in the same run: the redeemed one is gone (died or stored). A store waits for a logout
      // or a start: the game may still hold the stored dino in its last save.
      if (p.kind === 'redeem' && p.restored) this.#pending.delete(p.steamId);
      return [];
    }
    if (t <= p.restartedAt) return [];
    this.#pending.delete(p.steamId);
    const same = classPath === p.species && growth !== null
      && growth >= p.growth - GROWTH_SLACK && growth <= p.growth + GROWTH_AHEAD;
    if (p.kind === 'redeem') {
      if (same) { this.#resolved.add(p.key); return []; }
      const a = this.#act({ kind: 'put-back', key: p.key, steamId: p.steamId, slot: p.slot, file: p.file,
        species: p.species, growth: p.growth, t: p.t,
        why: `server restarted before the game saved it: back on ${classPath ?? '?'} at ${growth ?? '?'}` });
      return a === null ? [] : [a];
    }
    if (!same || p.growth < FRESH_GROWTH) { this.#resolved.add(p.key); return []; }
    const a = this.#act({ kind: 'undo-store', key: p.key, steamId: p.steamId, slot: p.slot,
      species: p.species, growth: p.growth, t: p.t, why: `server restarted before the game saved the store: back on the stored dino at ${growth}` });
    return a === null ? [] : [a];
  }

  #act(a: GuardAction): GuardAction | null {
    return this.#resolved.has(a.key) ? null : a;
  }
}

/** "BlueprintGeneratedClass /Game/…/BP_Tyrannosaurus.BP_Tyrannosaurus_C" → "Tyrannosaurus". */
export function speciesName(classPath: string): string {
  const m = /BP_([A-Za-z]+)_C\b/.exec(classPath);
  return m?.[1] ?? classPath;
}

export interface GuardOutcome {
  /** What changed in the garage, for the audit line; null when nothing had to change. */
  done: string | null;
  /** The slot the dino is in now (put back) or was taken from (store undone). */
  slot: string | null;
}

/**
 * Carry out one action on the garage files. Nothing to change (the mod put the slot back itself,
 * another dino is in that slot now) is not a failure: the action is settled either way.
 */
export async function runGuardAction(a: GuardAction): Promise<GuardOutcome> {
  if (a.kind === 'undo-store') {
    const trashed = await undoStore(a.steamId, a.slot, a.species, a.growth);
    return trashed === null
      ? { done: null, slot: null }
      : { done: `lần cất ${speciesName(a.species)} slot ${a.slot} của ${a.steamId} huỷ (${a.why}) → deleted/${trashed}`, slot: a.slot };
  }
  const file = a.file ?? await findRedeemHistory(a.steamId, a.slot, a.t);
  if (file === null || !(await historyExists(file))) return { done: null, slot: null };
  let slot = a.slot;
  try {
    await restoreFromHistory(a.steamId, file, slot);
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    slot = await nextFreeSlot(a.steamId);
    await restoreFromHistory(a.steamId, file, slot);
  }
  return { done: `${speciesName(a.species)} ${Math.round(a.growth * 100)}% trả lại gara ${a.steamId} slot ${slot} từ ${file} (${a.why})`, slot };
}

const statePath = (): string => join(config.dataDir, 'garage-guard.json');

/** The guard as it was left: `since` set the first time it runs, the actions already settled. */
export async function loadGuard(now = Math.floor(Date.now() / 1000)): Promise<GarageGuard> {
  try {
    const raw = JSON.parse(await readFile(statePath(), 'utf8')) as { since?: unknown; resolved?: unknown };
    if (typeof raw.since === 'number') {
      const resolved = Array.isArray(raw.resolved) ? raw.resolved.filter((k): k is string => typeof k === 'string') : [];
      return new GarageGuard(raw.since, resolved);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const guard = new GarageGuard(now);
  await saveGuard(guard, now);
  return guard;
}

export async function saveGuard(guard: GarageGuard, since: number): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  const tmp = `${statePath()}.tmp`;
  await writeFile(tmp, JSON.stringify({ since, resolved: guard.resolved }, null, 2), 'utf8');
  await rename(tmp, statePath());
}
