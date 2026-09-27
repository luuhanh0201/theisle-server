import type { GameEvent } from './events.js';
import type { DirectMessenger } from './notify.js';
import { PRIME_CONDITIONS, PRIME_NEEDED } from './prime.js';

/**
 * Tells a player each prime task they complete, over RCON DirectMessage:
 * "completed: Vùng di cư (5/10, 5 needed)", and once more when the dino
 * becomes eligible.
 *
 * From StatsLogger's "prime" events (one whenever a dino's conditions change).
 * A condition that turns on counts only on the same dino: same species, and a
 * growth close to the last reading — a fresh spawn, a change of species or a
 * dino taken out of the garage (growth jumps) only sets the new baseline. The
 * passive ones (7, 8, 10: there from the start) are never announced. The events
 * file is replayed at every bridge start: old events set the baseline but send
 * nothing (as notify.ts).
 */

/** More than this growth between two readings: not the same dino going on. */
const MAX_GROWTH_STEP = 0.03;
const PASSIVE = new Set(PRIME_CONDITIONS.filter((c) => c.passive).map((c) => String(c.n)));
const SHORT = new Map(PRIME_CONDITIONS.map((c) => [String(c.n), c.short]));

export type Render = (key: string, vars: Record<string, string | number>) => string | null;

export class PrimeNotifier {
  readonly #since: number;
  readonly #rcon: DirectMessenger;
  readonly #render: Render;
  readonly #log: (msg: string) => void;
  #last = new Map<string, { species: string | null; growth: number | null; conditions: Record<string, boolean>; eligible: boolean }>();

  constructor(rcon: DirectMessenger, startedAt: number, render: Render, log: (msg: string) => void = (m) => console.error(m)) {
    this.#rcon = rcon;
    this.#since = startedAt - 10;
    this.#render = render;
    this.#log = log;
  }

  /** The messages sent for this event (for tests); empty when none. */
  handle(event: GameEvent): Promise<string[]> {
    if (event.type !== 'prime' || event.conditions === undefined) return Promise.resolve([]);
    const now = { species: event.species ?? null, growth: typeof event.growth === 'number' ? event.growth : null,
      conditions: event.conditions, eligible: event.eligible === true };
    const before = this.#last.get(event.steamId);
    this.#last.set(event.steamId, now);
    if (before === undefined || event.t < this.#since || !this.#rcon.enabled) return Promise.resolve([]);
    if (before.species !== now.species) return Promise.resolve([]);
    if (before.growth === null || now.growth === null || Math.abs(now.growth - before.growth) > MAX_GROWTH_STEP) return Promise.resolve([]);

    const done = Object.values(now.conditions).filter((v) => v === true).length;
    const texts: string[] = [];
    for (const [n, on] of Object.entries(now.conditions)) {
      if (on !== true || before.conditions[n] === true || PASSIVE.has(n)) continue;
      const text = this.#render('prime.conditionDone', { task: SHORT.get(n) ?? `Nhiệm vụ ${n}`, n, done, needed: PRIME_NEEDED });
      if (text !== null) texts.push(text);
    }
    if (now.eligible && !before.eligible) {
      const text = this.#render('prime.eligible', { done, needed: PRIME_NEEDED });
      if (text !== null) texts.push(text);
    }
    return Promise.all(texts.map((t) => this.#rcon.directMessage(event.steamId, t).then(
      () => t,
      (error: unknown) => { this.#log(`[prime-notify] DirectMessage to ${event.steamId} failed: ${(error as Error).message}`); return t; },
    )));
  }
}
