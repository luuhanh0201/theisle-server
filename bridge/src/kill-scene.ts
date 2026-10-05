import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DamageEvent, DeathEvent, GameEvent, Loc } from './events.js';

/**
 * The scene of a death, for the panel's log (Chết → 📍): where it happened,
 * who stood within NEAR_M of it then (from their last snapshot), and the
 * fight it ended, the player-on-player hits between the dinos in it.
 *
 * Built when the death arrives, from what the bridge saw just before (the
 * snapshots are every 5 s, the hits as they land), and appended to
 * data/kill-scenes.ndjson: the snapshots are a separate file, replayed after
 * the events at startup, so a scene could not be rebuilt from a replay.
 * Deaths from before the bridge started (the replay) get none.
 */

/** Players this close to the death (metres, on the ground plane) are in the scene. */
export const NEAR_M = 200;
/** A snapshot older than this at the death is not where the player stood then. */
const FRESH_S = 20;
/** Hits are kept this long (the longest fight a scene goes back over). */
const KEEP_HITS_S = 300;
/** Going back from the death, a pause this long between hits ends the fight. */
const FIGHT_GAP_S = 30;
/** Scenes kept (file and memory); the oldest go first. */
const MAX_SCENES = 2000;

export type SceneRole = 'victim' | 'killer' | 'near';

export interface ScenePlayer {
  steamId: string;
  name: string | null;
  species: string | null;
  growth: number | null;
  x: number;
  y: number;
  /** Metres from where the victim died. */
  dist: number;
  /** Seconds between that position and the death. */
  age: number;
  role: SceneRole;
}

/** One bite (a hold bite's ticks summed). */
export interface FightHit {
  t: number;
  attacker: string;
  victim: string;
  amount: number;
  ticks: number;
}

export interface FightRow {
  steamId: string;
  name: string | null;
  species: string | null;
  growth: number | null;
  dealt: number;
  taken: number;
  hits: number;
  hitsTaken: number;
}

export interface KillScene {
  /** The death's time and who died: the scene's key. */
  t: number;
  steamId: string;
  loc: Loc;
  killer: string | null;
  near: number;
  players: ScenePlayer[];
  fight: { from: number; to: number; rows: FightRow[]; hits: FightHit[] } | null;
}

interface Seen {
  x: number;
  y: number;
  t: number;
  name: string | null;
  species: string | null;
  growth: number | null;
}

const keyOf = (steamId: string, t: number): string => `${steamId}@${t}`;
const round = (n: number): number => Math.round(n * 10) / 10;

export class KillScenes {
  readonly #path: string;
  readonly #startedAt: number;
  readonly #seen = new Map<string, Seen>();
  readonly #hits: DamageEvent[] = [];
  readonly #scenes = new Map<string, KillScene>();

  /** Deaths before `startedAt` (unix s) are a replay: no scene is made for them. */
  constructor(path: string, startedAt: number) {
    this.#path = path;
    this.#startedAt = startedAt;
  }

  /** The scenes saved before; the file is cut back to MAX_SCENES when it grew past it. */
  async load(): Promise<void> {
    let text: string;
    try { text = await readFile(this.#path, 'utf8'); } catch { return; }
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    for (const line of lines.slice(-MAX_SCENES)) {
      try {
        const s = JSON.parse(line) as KillScene;
        if (typeof s.steamId === 'string' && typeof s.t === 'number') this.#keep(s);
      } catch { /* a torn line: skipped */ }
    }
    if (lines.length > MAX_SCENES) {
      await writeFile(this.#path, lines.slice(-MAX_SCENES).join('\n') + '\n', 'utf8')
        .catch((e: unknown) => console.error('[kill-scene] trim failed:', e));
    }
  }

  get(steamId: string, t: number): KillScene | null {
    return this.#scenes.get(keyOf(steamId, t)) ?? null;
  }

  /** Every event the tails read: snapshots and hits are remembered, a death makes a scene. */
  handle(event: GameEvent): Promise<void> {
    switch (event.type) {
      case 'snapshot': {
        if (event.loc === undefined) break;
        const prev = this.#seen.get(event.steamId);
        if (prev !== undefined && prev.t > event.t) break;
        this.#seen.set(event.steamId, {
          x: event.loc.x, y: event.loc.y, t: event.t, name: event.name ?? prev?.name ?? null,
          species: event.species ?? null, growth: event.growth ?? null,
        });
        break;
      }
      case 'damage':
        // Only player-on-player hits are a fight here (AI is not in the log).
        if (event.attacker === 'ai' || event.victim === 'ai') break;
        this.#hits.push(event);
        while (this.#hits.length > 0 && (this.#hits[0] as DamageEvent).t < event.t - KEEP_HITS_S) this.#hits.shift();
        break;
      case 'death':
        if (event.t < this.#startedAt || event.loc === undefined) break;
        if (this.#scenes.has(keyOf(event.steamId, event.t))) break;
        return this.#save(this.build(event));
      default:
        break;
    }
    return Promise.resolve();
  }

  /** The scene of one death, from what was seen before it (exported for the tests). */
  build(death: DeathEvent): KillScene {
    const loc = death.loc as Loc;
    const killer = death.killer !== undefined && death.killer !== 'ai' ? death.killer : null;
    const players: ScenePlayer[] = [{
      steamId: death.steamId, name: death.name ?? this.#seen.get(death.steamId)?.name ?? null,
      species: death.species, growth: death.growth, x: loc.x, y: loc.y, dist: 0, age: 0, role: 'victim',
    }];
    for (const [steamId, s] of this.#seen) {
      if (steamId === death.steamId) continue;
      const age = death.t - s.t;
      if (age > FRESH_S || age < -FRESH_S) continue;
      const dist = Math.hypot(s.x - loc.x, s.y - loc.y) / 100;
      const isKiller = steamId === killer;
      if (dist > NEAR_M && !isKiller) continue;
      players.push({
        steamId, name: s.name, species: s.species, growth: s.growth, x: s.x, y: s.y,
        dist: round(dist), age: Math.max(0, age), role: isKiller ? 'killer' : 'near',
      });
    }
    players.sort((a, b) => a.dist - b.dist);
    return { t: death.t, steamId: death.steamId, loc, killer, near: NEAR_M, players, fight: this.#fight(death, killer, players) };
  }

  /**
   * The fight the death ended: starting from the victim (and the killer), every
   * player trading hits with one of them is in it, and so on; it goes back
   * from the death until the hits pause for FIGHT_GAP_S.
   */
  #fight(death: DeathEvent, killer: string | null, players: ScenePlayer[]): KillScene['fight'] {
    const recent = this.#hits.filter((h) => h.t <= death.t + 2 && h.t >= death.t - KEEP_HITS_S);
    const inFight = new Set<string>([death.steamId]);
    if (killer !== null) inFight.add(killer);
    let grew = true;
    while (grew) {
      grew = false;
      for (const h of recent) {
        if (inFight.has(h.attacker) !== inFight.has(h.victim)) {
          inFight.add(h.attacker);
          inFight.add(h.victim);
          grew = true;
        }
      }
    }
    const mine = recent.filter((h) => inFight.has(h.attacker) && inFight.has(h.victim)).sort((a, b) => a.t - b.t);
    // Back from the death until a pause.
    let start = mine.length;
    let edge = death.t;
    for (let i = mine.length - 1; i >= 0; i--) {
      const h = mine[i] as DamageEvent;
      if (edge - h.t > FIGHT_GAP_S) break;
      start = i;
      edge = h.t;
    }
    const fightHits = mine.slice(start);
    if (fightHits.length === 0) return null;

    // One line per bite: a hold bite's ticks summed.
    const hits: FightHit[] = [];
    const byBite = new Map<string, FightHit>();
    for (const h of fightHits) {
      const amount = h.amount ?? 0;
      const k = typeof h.bite === 'string' ? `${h.attacker}>${h.victim}#${h.bite}` : null;
      const same = k !== null ? byBite.get(k) : undefined;
      if (same !== undefined) {
        same.amount = round(same.amount + amount);
        same.ticks += 1;
        continue;
      }
      const hit: FightHit = { t: h.t, attacker: h.attacker, victim: h.victim, amount: round(amount), ticks: 1 };
      hits.push(hit);
      if (k !== null) byBite.set(k, hit);
    }

    const rows = new Map<string, FightRow>();
    const row = (id: string, name: string | undefined, species: string | undefined): FightRow => {
      let r = rows.get(id);
      if (r === undefined) {
        const p = players.find((x) => x.steamId === id);
        const s = this.#seen.get(id);
        r = { steamId: id, name: p?.name ?? s?.name ?? null, species: p?.species ?? s?.species ?? null,
          growth: p?.growth ?? s?.growth ?? null, dealt: 0, taken: 0, hits: 0, hitsTaken: 0 };
        rows.set(id, r);
      }
      if (r.name === null && name !== undefined) r.name = name;
      if (r.species === null && species !== undefined) r.species = species;
      return r;
    };
    for (const h of fightHits) {
      const a = row(h.attacker, h.attackerName, h.attackerSpecies);
      const v = row(h.victim, h.victimName, h.victimSpecies);
      a.dealt = round(a.dealt + (h.amount ?? 0));
      v.taken = round(v.taken + (h.amount ?? 0));
    }
    for (const h of hits) {
      (rows.get(h.attacker) as FightRow).hits += 1;
      (rows.get(h.victim) as FightRow).hitsTaken += 1;
    }
    return {
      from: (fightHits[0] as DamageEvent).t, to: (fightHits[fightHits.length - 1] as DamageEvent).t,
      rows: [...rows.values()].sort((a, b) => b.dealt - a.dealt), hits,
    };
  }

  #keep(scene: KillScene): void {
    this.#scenes.set(keyOf(scene.steamId, scene.t), scene);
    if (this.#scenes.size > MAX_SCENES) {
      const oldest = this.#scenes.keys().next().value;
      if (oldest !== undefined) this.#scenes.delete(oldest);
    }
  }

  async #save(scene: KillScene): Promise<void> {
    this.#keep(scene);
    try {
      await mkdir(dirname(this.#path), { recursive: true });
      await appendFile(this.#path, JSON.stringify(scene) + '\n', 'utf8');
    } catch (error) {
      console.error('[kill-scene] cannot save', this.#path, error);
    }
  }
}
