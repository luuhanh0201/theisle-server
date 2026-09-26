import type { GameEvent, DeathEvent, GarageStoreResultEvent, Loc, PortalCommandEvent, SnapshotEvent, Skin, VitalName } from './events.js';
import { config } from './config.js';
import { Catalog } from './catalog.js';
import { SpeciesStats } from './species-stats.js';
import { GroundPoints } from './ground-points.js';

export interface KillRecord {
  t: number;
  killer: string;
  killerName: string | null;
  killerSpecies: string | null;
  victim: string;
  victimName: string | null;
  species: string;
  growth: number | null;
}

/** One dino a player played, from the spawn we saw to however it ended. */
export interface LifeRecord {
  species: string;
  spawnedAt: number;
  /** Last time we saw it alive (or when it ended). */
  lastAt: number;
  endedAt: number | null;
  /** null while alive, or when the player left and the life is unresolved. */
  end: 'death' | 'garage' | 'admin' | null;
  growthStart: number | null;
  growth: number | null;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  killer: string | null;
  killerName: string | null;
  killerSpecies: string | null;
  /** Slot this life was restored from with !redeem. */
  redeemedFrom: string | null;
}

export interface PlayerStats {
  steamId: string;
  name: string | null;
  species: string | null;
  /** Only damage the game let us see: player-on-player direct attacks. */
  damageDealt: number;
  damageTaken: number;
  hits: number;
  /** Deaths we could attribute to this player's recent hit on the victim. */
  kills: number;
  /** Real deaths. A dino removed by !store is excluded — see GARAGE_KILL_WINDOW. */
  deaths: number;
  spawns: number;
  stored: number;
  redeemed: number;
  chats: number;
  health: number | null;
  stamina: number | null;
  hunger: number | null;
  thirst: number | null;
  oxygen: number | null;
  blood: number | null;
  growth: number | null;
  loc: Loc | null;
  yaw: number | null;
  /** Unix seconds of the last event of any kind about them. */
  lastSeen: number;
  /** Start of the open session, null when they are not connected. */
  sessionStart: number | null;
  sessions: number;
  /** Seconds online, closed sessions plus the open one up to lastSeen. */
  playtime: number;
  /** Longest single life that ended in a death we saw. */
  longestLife: number;
  /** Largest dino (by growth) this player has killed. */
  biggestKill: KillRecord | null;
  online: boolean;
  /** The skin of the dino they play now (last "skin" event), null before one. */
  skin: Skin | null;
  /** Vital maxima from the last snapshot that had them. */
  max: Partial<Record<VitalName, number>> | null;
  /** Prime / elder status of the dino they play now (last "prime" event). */
  prime: {
    elder: boolean | null; prime: boolean | null; eligible: boolean | null; elderStacks: number | null;
    conditions: Record<string, boolean> | null;
  } | null;
}

/** What goes into the feeds, before we stamp an id on it. */
export type FeedInput =
  | Exclude<GameEvent, SnapshotEvent | DeathEvent | { type: 'mod_loaded' }>
  | (DeathEvent & { cause?: 'garage' | 'admin' });

export type FeedEntry = FeedInput & { id: number };

export interface Leaderboard {
  kills: PlayerStats[];
  kd: Array<PlayerStats & { kd: number }>;
  damage: PlayerStats[];
  playtime: PlayerStats[];
  longestLife: PlayerStats[];
  /** Per victim species, the largest one anybody killed. */
  biggestPrey: KillRecord[];
}

/** A position on a trail or a life's path, with when it was there (unix seconds). */
export interface TrailPoint extends Loc {
  t: number;
}

export interface MapPlayer {
  steamId: string;
  name: string | null;
  species: string | null;
  growth: number | null;
  health: number | null;
  /** The game's max health for this dino, for a real health bar (null until read). */
  maxHealth: number | null;
  loc: Loc;
  yaw: number | null;
  trail: TrailPoint[];
}

/**
 * !store and the admin "remove dino" command both kill with SetHealth(0),
 * which StatsLogger reports as a death like any other. A death this soon after
 * one of those is that action, not a real death. The window covers the mod's
 * 3s kill delay plus the 5s snapshot cadence that has to notice it.
 */
const GARAGE_KILL_WINDOW = 12;

/** Lives kept per player for the detail view. */
const LIVES_KEPT = 50;

/** A board lists this many rows. */
const BOARD_SIZE = 20;

/** K/D over fewer kills than this is noise, not skill. */
const KD_MIN_KILLS = 3;

/** Far enough from the last point to count as movement (horizontal distance). */
function moved(points: readonly TrailPoint[], next: TrailPoint): boolean {
  const last = points[points.length - 1];
  if (last === undefined) return true;
  return Math.hypot(next.x - last.x, next.y - last.y) >= config.trailMinMove;
}

function pushBounded<T>(list: T[], item: T, max: number): void {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

/**
 * In-memory aggregation of the event streams.
 *
 * Deliberately not persisted: the NDJSON files on the server are the record,
 * and a restart just replays them. If totals ever need to survive a rotation,
 * that is a database, not a bigger Map.
 */
export class Store {
  readonly #players = new Map<string, PlayerStats>();
  readonly #feed: FeedEntry[] = [];
  readonly #kills: FeedEntry[] = [];
  readonly #chat: FeedEntry[] = [];
  readonly #timelines = new Map<string, FeedEntry[]>();
  readonly #trails = new Map<string, TrailPoint[]>();
  /** steamId -> life spawnedAt -> the whole path of that life (last few lives only). */
  readonly #paths = new Map<string, Map<number, TrailPoint[]>>();
  /** steamId -> t of their latest spawn; older positions belong to a past life. */
  readonly #lifeStart = new Map<string, number>();
  readonly #biggestPrey = new Map<string, KillRecord>();
  readonly #lives = new Map<string, LifeRecord[]>();
  /** Web-garage command outcomes by inbox id (the newest few hundred). */
  readonly #commandResults = new Map<number, PortalCommandEvent>();
  /** How a web store's countdown ended, by the same command id. */
  readonly #storeResults = new Map<number, GarageStoreResultEvent>();
  /** Species and mutations reported by the game; see catalog.ts. */
  readonly catalog = new Catalog();
  /** Each species' maxima by growth, as read on this server (the admin create form shows them). */
  readonly speciesStats = new SpeciesStats();
  /** Places players and AI stood: where AI zones may spawn (ground-points.ts). */
  readonly groundPoints = new GroundPoints();
  /** steamId -> when and why their dino was just removed on purpose. */
  readonly #recentRemoval = new Map<string, { t: number; cause: 'garage' | 'admin' }>();
  #nextId = 1;
  #lastEventAt: number | null = null;
  /** Told of every feed entry as it is added (the Discord log: discord.ts). Replays included — the listener filters. */
  onFeed: ((entry: FeedEntry) => void) | null = null;
  #modsLoadedAt: number | null = null;

  apply(event: GameEvent): void {
    // The two streams are tailed separately, so an older line can arrive
    // after a newer one. The "last heard" clock must not go backwards.
    if (this.#lastEventAt === null || event.t > this.#lastEventAt) {
      this.#lastEventAt = event.t;
    }

    switch (event.type) {
      case 'notify':
        // Delivered by the notifier (index.ts); not part of the game's story.
        break;
      case 'skin':
        this.#player(event.steamId, event.t, event.name).skin = event.skin;
        break;
      case 'prime':
        this.speciesStats.primeState(event.steamId, event.t, event.prime === true);
        this.#player(event.steamId, event.t, event.name).prime = {
          elder: event.elder ?? null, prime: event.prime ?? null,
          eligible: event.eligible ?? null, elderStacks: event.elderStacks ?? null,
          conditions: event.conditions ?? null,
        };
        break;
      case 'snapshot': {
        const p = this.#player(event.steamId, event.t, event.name);
        this.catalog.addSpecies(event.species);
        p.species = event.species;
        p.health = event.health;
        p.stamina = event.stamina;
        p.hunger = event.hunger;
        p.thirst = event.thirst;
        p.oxygen = event.oxygen ?? null;
        p.blood = event.blood ?? null;
        p.growth = event.growth;
        p.yaw = event.yaw ?? null;
        if (event.max !== undefined) p.max = event.max;
        this.speciesStats.snapshot(event.steamId, event.t, event.species, event.growth, event.max);
        if (event.loc !== undefined) this.groundPoints.add(event.loc.x, event.loc.y, event.loc.z, event.species);
        const life = this.#openLife(event.steamId);
        if (life !== null && event.t >= life.spawnedAt) {
          life.growth = event.growth ?? life.growth;
          life.lastAt = Math.max(life.lastAt, event.t);
        }
        // The streams are tailed separately: on a replay every spawn is read
        // before any snapshot, so a snapshot from a previous life can arrive
        // after the spawn that ended it. It must not join the new trail.
        const current = event.t >= (this.#lifeStart.get(event.steamId) ?? 0);
        if (event.loc !== undefined && current) {
          p.loc = event.loc;
          const point: TrailPoint = { ...event.loc, t: event.t };
          let trail = this.#trails.get(event.steamId);
          if (trail === undefined) {
            trail = [];
            this.#trails.set(event.steamId, trail);
          }
          // Only real movement: standing still would fill the trail with one spot.
          if (moved(trail, point)) pushBounded(trail, point, config.trailSize);
          if (life !== null && event.t >= life.spawnedAt) this.#addToPath(event.steamId, life.spawnedAt, point);
        }
        break;
      }

      case 'damage': {
        const amount = event.amount ?? 0;
        if (event.attacker !== 'ai') {
          const a = this.#player(event.attacker, event.t, event.attackerName);
          a.damageDealt += amount;
          a.hits += 1;
          const life = this.#openLife(event.attacker);
          if (life !== null) life.damageDealt += amount;
        }
        if (event.victim !== 'ai') {
          this.#player(event.victim, event.t, event.victimName).damageTaken += amount;
          const life = this.#openLife(event.victim);
          if (life !== null) life.damageTaken += amount;
        }
        this.#push(event, [event.attacker, event.victim]);
        break;
      }

      case 'death':
        this.speciesStats.lifeEnded(event.steamId, event.t);
        this.#death(event);
        break;

      case 'spawn': {
        this.speciesStats.lifeEnded(event.steamId, event.t);
        const p = this.#player(event.steamId, event.t, event.name);
        p.spawns += 1;
        p.species = event.species;
        p.growth = event.growth;
        // A new life starts a new trail; joining the old one draws a line
        // across the map from the corpse to the spawn point.
        this.#trails.delete(event.steamId);
        this.#lifeStart.set(event.steamId, event.t);
        if (event.loc !== undefined) p.loc = event.loc;
        this.#startLife(event.steamId, event.species, event.growth, event.t);
        this.catalog.addSpecies(event.species, event.classPath);
        this.catalog.addMutations(event.species, event.mutations, { t: event.t, steamId: event.steamId });
        this.#push(event, [event.steamId]);
        break;
      }

      case 'session_start': {
        // Two starts with no end between them: the server went down without
        // closing the session. Close it at the last thing we heard BEFORE this
        // start — #player() below moves lastSeen forward, and the downtime
        // would otherwise count as playtime.
        const lastHeard = this.#players.get(event.steamId)?.lastSeen ?? event.t;
        const p = this.#player(event.steamId, event.t, event.name);
        this.#closeSession(p, lastHeard);
        p.sessionStart = event.t;
        p.sessions += 1;
        p.lastSeen = event.t;
        this.#push(event, [event.steamId]);
        break;
      }

      case 'session_end': {
        const p = this.#player(event.steamId, event.t, event.name);
        this.#closeSession(p, event.t);
        this.#trails.delete(event.steamId);
        this.#push(event, [event.steamId]);
        break;
      }

      case 'chat': {
        this.#player(event.steamId, event.t, event.name).chats += 1;
        const entry = this.#push(event, [event.steamId]);
        pushBounded(this.#chat, entry, config.chatSize);
        break;
      }

      case 'mutation':
        this.catalog.addMutation(event.species, event.slot, event.to, { t: event.t, steamId: event.steamId });
        this.#player(event.steamId, event.t, event.name);
        this.#push(event, [event.steamId]);
        break;

      case 'growth':
      case 'growth_set':
        this.#player(event.steamId, event.t, event.name);
        this.#push(event, [event.steamId]);
        break;

      // DinoGarage does not know display names; fill in the one we have.
      case 'garage_store': {
        const p = this.#player(event.steamId, event.t);
        p.stored += 1;
        this.#recentRemoval.set(event.steamId, { t: event.t, cause: 'garage' });
        this.#push(p.name === null ? event : { ...event, name: p.name }, [event.steamId]);
        break;
      }

      case 'garage_redeem': {
        const p = this.#player(event.steamId, event.t);
        if (event.ok) {
          p.redeemed += 1;
          const life = this.#openLife(event.steamId);
          if (life !== null) {
            life.redeemedFrom = event.slot;
            life.growth = event.growth ?? life.growth;
          }
        }
        this.#push(p.name === null ? event : { ...event, name: p.name }, [event.steamId]);
        break;
      }

      case 'portal_command': {
        this.#commandResults.set(event.id, event);
        if (this.#commandResults.size > 500) {
          const oldest = this.#commandResults.keys().next().value;
          if (oldest !== undefined) this.#commandResults.delete(oldest);
        }
        // A command for a SteamID never seen in game (the portal only sends
        // logged-in players, but an offline one may never have joined) must
        // not create a player out of thin air.
        const known = this.#players.get(event.steamId);
        if (known !== undefined) this.#push(known.name === null ? event : { ...event, name: known.name }, [event.steamId]);
        break;
      }

      case 'garage_store_result': {
        this.#storeResults.set(event.id, event);
        if (this.#storeResults.size > 500) {
          const oldest = this.#storeResults.keys().next().value;
          if (oldest !== undefined) this.#storeResults.delete(oldest);
        }
        break;
      }

      case 'admin_kill': {
        const p = this.#player(event.steamId, event.t);
        if (event.ok) this.#recentRemoval.set(event.steamId, { t: event.t, cause: 'admin' });
        this.#push(p.name === null ? event : { ...event, name: p.name }, [event.steamId]);
        break;
      }

      case 'mod_loaded':
        console.info(`[store] ${event.mod} loaded on the server`);
        // StatsLogger is the mod the whole panel depends on; its "loaded" is
        // the signal that a (re)started server is really up.
        if (event.mod === 'StatsLogger' && (this.#modsLoadedAt === null || event.t > this.#modsLoadedAt)) {
          this.#modsLoadedAt = event.t;
        }
        break;
    }
  }

  // --- queries ----------------------------------------------------------

  players(): PlayerStats[] {
    const now = this.#nowSeconds();
    return [...this.#players.values()]
      .map((p) => this.#view(p, now))
      .sort((a, b) => Number(b.online) - Number(a.online) || b.damageDealt - a.damageDealt);
  }

  online(): PlayerStats[] {
    return this.players().filter((p) => p.online);
  }

  player(
    steamId: string,
  ): { player: PlayerStats; timeline: FeedEntry[]; lives: LifeRecord[] } | null {
    const p = this.#players.get(steamId);
    if (p === undefined) return null;
    const timeline = this.#timelines.get(steamId) ?? [];
    const lives = this.#lives.get(steamId) ?? [];
    return {
      player: this.#view(p, this.#nowSeconds()),
      timeline: [...timeline].reverse(),
      lives: lives.map((l) => ({ ...l })).reverse(),
    };
  }

  /** Newest first. With `types`, only those event types. */
  feed(limit: number, types: ReadonlySet<string> | null = null): FeedEntry[] {
    const out: FeedEntry[] = [];
    for (let i = this.#feed.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.#feed[i] as FeedEntry;
      if (types === null || types.has(e.type)) out.push(e);
    }
    return out;
  }

  killfeed(limit: number): FeedEntry[] {
    return this.#kills.slice(-limit).reverse();
  }

  chat(limit: number): FeedEntry[] {
    return this.#chat.slice(-limit).reverse();
  }

  leaderboard(): Leaderboard {
    const all = this.players();
    const top = (score: (p: PlayerStats) => number): PlayerStats[] =>
      all.filter((p) => score(p) > 0).sort((a, b) => score(b) - score(a)).slice(0, BOARD_SIZE);

    return {
      kills: top((p) => p.kills),
      kd: all
        .filter((p) => p.kills >= KD_MIN_KILLS)
        .map((p) => ({ ...p, kd: p.kills / Math.max(1, p.deaths) }))
        .sort((a, b) => b.kd - a.kd)
        .slice(0, BOARD_SIZE),
      damage: top((p) => p.damageDealt),
      playtime: top((p) => p.playtime),
      longestLife: top((p) => p.longestLife),
      biggestPrey: [...this.#biggestPrey.values()].sort(
        (a, b) => (b.growth ?? 0) - (a.growth ?? 0) || a.species.localeCompare(b.species),
      ),
    };
  }

  /** Online players with a known position, for the live map. */
  map(): MapPlayer[] {
    const out: MapPlayer[] = [];
    for (const p of this.online()) {
      if (p.loc === null) continue;
      out.push({
        steamId: p.steamId,
        name: p.name,
        species: p.species,
        growth: p.growth,
        health: p.health,
        maxHealth: p.max?.health ?? null,
        loc: p.loc,
        yaw: p.yaw,
        trail: this.#trails.get(p.steamId) ?? [],
      });
    }
    return out;
  }

  /** Unix seconds StatsLogger last announced itself, or null. */
  modsLoadedAt(): number | null {
    return this.#modsLoadedAt;
  }

  health(): { lastEventAt: number | null; players: number; online: number; feed: number } {
    return {
      lastEventAt: this.#lastEventAt,
      players: this.#players.size,
      online: this.online().length,
      feed: this.#feed.length,
    };
  }

  // --- internals ----------------------------------------------------------

  #death(event: DeathEvent): void {
    const removal = this.#recentRemoval.get(event.steamId);
    const deliberate =
      removal !== undefined && event.t - removal.t <= GARAGE_KILL_WINDOW ? removal.cause : null;
    const victim = this.#player(event.steamId, event.t, event.name);

    const life = this.#openLife(event.steamId);
    if (life !== null) {
      life.endedAt = event.t;
      life.lastAt = event.t;
      life.growth = event.growth ?? life.growth;
      life.end = deliberate ?? 'death';
    }

    if (deliberate !== null) {
      this.#recentRemoval.delete(event.steamId);
      this.#push({ ...event, cause: deliberate }, [event.steamId]);
      return;
    }

    victim.deaths += 1;
    if (event.lifeSeconds !== undefined && event.lifeSeconds > victim.longestLife) {
      victim.longestLife = event.lifeSeconds;
    }

    const involved = [event.steamId];
    if (event.killer !== undefined && event.killer !== 'ai') {
      const killer = this.#player(event.killer, event.t, event.killerName);
      killer.kills += 1;
      involved.push(event.killer);
      const killerLife = this.#openLife(event.killer);
      if (killerLife !== null) killerLife.kills += 1;
      if (life !== null) {
        life.killer = event.killer;
        life.killerName = killer.name;
        life.killerSpecies = event.killerSpecies ?? null;
      }

      const record: KillRecord = {
        t: event.t,
        killer: event.killer,
        killerName: killer.name,
        killerSpecies: event.killerSpecies ?? null,
        victim: event.steamId,
        victimName: victim.name,
        species: event.species,
        growth: event.growth,
      };
      if ((record.growth ?? 0) > (killer.biggestKill?.growth ?? -1)) {
        killer.biggestKill = record;
      }
      const best = this.#biggestPrey.get(event.species);
      if (best === undefined || (record.growth ?? 0) > (best.growth ?? 0)) {
        this.#biggestPrey.set(event.species, record);
      }
    }

    const entry = this.#push(event, involved);
    pushBounded(this.#kills, entry, config.killfeedSize);
  }

  /** The path one life took, or null (unknown life, or too old to be kept). */
  path(steamId: string, spawnedAt: number): TrailPoint[] | null {
    const points = this.#paths.get(steamId)?.get(spawnedAt);
    return points === undefined ? null : points.map((pt) => ({ ...pt }));
  }

  #addToPath(steamId: string, spawnedAt: number, point: TrailPoint): void {
    let byLife = this.#paths.get(steamId);
    if (byLife === undefined) {
      byLife = new Map();
      this.#paths.set(steamId, byLife);
    }
    let points = byLife.get(spawnedAt);
    if (points === undefined) {
      points = [];
      byLife.set(spawnedAt, points);
      // Keep the newest few lives: a path is a few thousand points each.
      const keys = [...byLife.keys()].sort((a, b) => b - a);
      for (const old of keys.slice(config.pathLives)) byLife.delete(old);
    }
    if (!moved(points, point)) return;
    points.push(point);
    // A long life: halve the resolution rather than lose its beginning.
    if (points.length > config.pathMaxPoints) {
      const last = points[points.length - 1] as TrailPoint;
      const kept = points.filter((_, i) => i % 2 === 0);
      if (kept[kept.length - 1] !== last) kept.push(last);
      points.splice(0, points.length, ...kept);
    }
  }

  /** A web-garage command's outcome, only for the player who sent it (null = not run yet). */
  commandResult(steamId: string, id: number): PortalCommandEvent | null {
    const r = this.#commandResults.get(id);
    return r !== undefined && r.steamId === steamId ? { ...r } : null;
  }

  /** How a web store ended (null = still counting down), only for that player. */
  storeResult(steamId: string, id: number): GarageStoreResultEvent | null {
    const r = this.#storeResults.get(id);
    return r !== undefined && r.steamId === steamId ? { ...r } : null;
  }

  /** The life still in progress, or null if the last one ended. */
  #openLife(steamId: string): LifeRecord | null {
    const lives = this.#lives.get(steamId);
    const last = lives?.[lives.length - 1];
    return last !== undefined && last.end === null && last.endedAt === null ? last : null;
  }

  #startLife(steamId: string, species: string, growth: number | null, t: number): void {
    let lives = this.#lives.get(steamId);
    if (lives === undefined) {
      lives = [];
      this.#lives.set(steamId, lives);
    }
    // A spawn with the previous life still open: it ended in a way we could
    // not see (species swap, a death between two polls). Close it unresolved.
    const open = this.#openLife(steamId);
    if (open !== null) open.endedAt = open.lastAt;

    pushBounded(lives, {
      species,
      spawnedAt: t,
      lastAt: t,
      endedAt: null,
      end: null,
      growthStart: growth,
      growth,
      kills: 0,
      damageDealt: 0,
      damageTaken: 0,
      killer: null,
      killerName: null,
      killerSpecies: null,
      redeemedFrom: null,
    }, LIVES_KEPT);
  }

  #closeSession(p: PlayerStats, at: number): void {
    if (p.sessionStart === null) return;
    p.playtime += Math.max(0, at - p.sessionStart);
    p.sessionStart = null;
  }

  /** A copy with the derived fields filled in for this moment. */
  #view(p: PlayerStats, now: number): PlayerStats {
    const open = p.sessionStart !== null;
    return {
      ...p,
      playtime: p.playtime + (open ? Math.max(0, p.lastSeen - (p.sessionStart ?? 0)) : 0),
      // An open session with nothing heard for a while means the server went
      // down (or the bridge is replaying old files) — not a connected player.
      online: open && now - p.lastSeen <= config.offlineAfterSeconds,
    };
  }

  #player(steamId: string, t: number, name?: string): PlayerStats {
    let p = this.#players.get(steamId);
    if (p === undefined) {
      p = {
        steamId,
        name: null,
        species: null,
        damageDealt: 0,
        damageTaken: 0,
        hits: 0,
        kills: 0,
        deaths: 0,
        spawns: 0,
        stored: 0,
        redeemed: 0,
        chats: 0,
        health: null,
        stamina: null,
        hunger: null,
        thirst: null,
        oxygen: null,
        blood: null,
        growth: null,
        loc: null,
        yaw: null,
        lastSeen: 0,
        sessionStart: null,
        sessions: 0,
        playtime: 0,
        longestLife: 0,
        biggestKill: null,
        skin: null,
        max: null,
        prime: null,
        online: false,
      };
      this.#players.set(steamId, p);
    }
    if (name !== undefined && name !== '') p.name = name;
    if (t > p.lastSeen) p.lastSeen = t;
    return p;
  }

  #push(event: FeedInput, involved: string[]): FeedEntry {
    const entry: FeedEntry = { ...event, id: this.#nextId++ };
    pushBounded(this.#feed, entry, config.feedSize);
    if (this.onFeed !== null) {
      try { this.onFeed(entry); } catch (error) { console.error('[store] feed listener failed:', error); }
    }

    for (const steamId of new Set(involved)) {
      if (steamId === 'ai') continue;
      let timeline = this.#timelines.get(steamId);
      if (timeline === undefined) {
        timeline = [];
        this.#timelines.set(steamId, timeline);
      }
      pushBounded(timeline, entry, config.timelineSize);
    }
    return entry;
  }

  #nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }
}
