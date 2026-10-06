import type { GameEvent, DeathEvent, GarageStoreResultEvent, TeleResultEvent, GrowthSetEvent, MutationEvent, Loc, MutationSlots, PortalCommandEvent, PrisonEvent, SnapshotEvent, Skin, VitalName } from './events.js';
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
  /** null while alive, or when the player left and the life is unresolved. 'rebirth': chuyển sinh (a prime at 100 % reborn, +1 đời). */
  end: 'death' | 'garage' | 'admin' | 'rebirth' | null;
  growthStart: number | null;
  growth: number | null;
  kills: number;
  /** Its kills the players see (#killCounts). */
  countedKills: number;
  damageDealt: number;
  damageTaken: number;
  killer: string | null;
  killerName: string | null;
  killerSpecies: string | null;
  /** Slot this life was restored from with !redeem. */
  redeemedFrom: string | null;
  /**
   * The dino this life is a stretch of: a relog on it, its store and its
   * redeem, an admin's restore of it all carry it on (#chainOf). Its survival
   * time is the sum of its stretches, online only.
   */
  chain: number;
  /** When the player left while it lived (the stretch ends there, not at the next spawn). */
  pausedAt: number | null;
  /** The garage slot it went into (a later redeem of that slot carries it on). */
  storedTo: string | null;
  /** Elder stacks (lineage counter) as the "prime" events read them; null before the first. */
  elderStacks: number | null;
  /** The highest growth the events showed (a rebirth follows a dino at 100 %). */
  maxGrowth: number | null;
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
  /** Real deaths. A dino removed by !store is excluded, see GARAGE_KILL_WINDOW. */
  deaths: number;
  /** What the players see (their leaderboard, their own stats): kills by #killCounts, deaths not by an admin. The panel keeps the raw ones. */
  countedKills: number;
  countedDeaths: number;
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
  /**
   * The player's longest-surviving dino, in seconds online: all its stretches
   * - relogs, its time in and out of the garage, its rebirths (chuyển sinh at
   * 100 %), an admin's restore of it, the one alive now included.
   */
  longestLife: number;
  /** That dino's species, and whether it is still alive. */
  longestLifeSpecies: string | null;
  longestLifeAlive: boolean;
  /** Largest dino (by growth) this player has killed. */
  biggestKill: KillRecord | null;
  online: boolean;
  /** The skin of the dino they play now (last "skin" event), null before one. */
  skin: Skin | null;
  /** The server-measured ping from the last snapshot (every 5 s), ms; null online without a dino, or offline. */
  ping: number | null;
  /** Vital maxima from the last snapshot that had them. */
  max: Partial<Record<VitalName, number>> | null;
  /**
   * The mutation slots of the dino they play now (Slot1…, ParentSlot1…, ElderSlot1A…):
   * the spawn's, then each "mutation" event; null before a spawn was seen.
   */
  mutations: MutationSlots | null;
  /** Prime / elder status of the dino they play now (last "prime" event). */
  prime: {
    elder: boolean | null; prime: boolean | null; eligible: boolean | null; elderStacks: number | null;
    conditions: Record<string, boolean> | null;
  } | null;
}

/** What goes into the feeds, before we stamp an id on it. */
export type FeedInput =
  // The Prison mod's events are prison.ts's business, not the feed's.
  | Exclude<GameEvent, SnapshotEvent | DeathEvent | PrisonEvent | { type: 'mod_loaded' }>
  /** A mutation / growth change the garage (a redeem), an admin or an item made, not the player (#writtenBy). */
  | ((MutationEvent | GrowthSetEvent) & { via?: 'garage' | 'admin' | 'item' })
  | (DeathEvent & {
    /** Not a death: stored, removed by an admin, or a rebirth (chuyển sinh, told a few seconds later). */
    cause?: 'garage' | 'admin' | 'rebirth';
    /** A kill: whether the players' boards count it; why not ('admin' on either side, 'small' prey for a grown killer). */
    counted?: boolean;
    uncounted?: 'admin' | 'small';
  });

export type FeedEntry = FeedInput & { id: number };
/** A "damage" feed entry is one bite: `ticks` > 1 for a hold bite (its amount is their sum). */
export interface DamageBite { amount: number | null; ticks: number }

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

/**
 * Whether a kill counts on the players' boards (owner's rule, 2026-10-03): a
 * young killer (50 % or less) counts every kill; a grown one only prey above
 * 40 %. Growth unknown: counted. Admins are left out before this (#death).
 */
export const KILL_YOUNG_MAX = 0.5;
export const KILL_PREY_MIN = 0.4;
export function killCounts(killerGrowth: number | null | undefined, victimGrowth: number | null | undefined): boolean {
  if (typeof killerGrowth !== 'number' || killerGrowth <= KILL_YOUNG_MAX) return true;
  return typeof victimGrowth !== 'number' || victimGrowth > KILL_PREY_MIN;
}
/** Mutation / growth changes this soon after a redeem, an admin action or an item are theirs (seen: ~4 s). */
const WRITE_WINDOW = 20;
/** A redeem takes off the log the spawn and the web command this soon before it (#prep). */
const PREP_WINDOW = 600;
/** A rebirth's spawn comes this soon after the death that started it (seen: 5–12 s). */
const REBIRTH_WINDOW = 120;

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
  /** How each tele ended (tele.ts settles its codes by these), by inbox command id. */
  readonly #teleResults = new Map<number, TeleResultEvent>();
  /** Species and mutations reported by the game; see catalog.ts. */
  readonly catalog = new Catalog();
  /** Each species' maxima by growth, as read on this server (the admin create form shows them). */
  readonly speciesStats = new SpeciesStats();
  /** Places players and AI stood: where AI zones may spawn (ground-points.ts). */
  readonly groundPoints = new GroundPoints();
  /** steamId -> when and why their dino was just removed on purpose. */
  readonly #recentRemoval = new Map<string, { t: number; cause: 'garage' | 'admin'; slot?: string }>();
  /**
   * The last time the garage (a redeem), an admin or an item wrote on a player's dino:
   * the mutation and growth changes the game reports right after are that write, not
   * the player picking, the panel said "chọn mutation" four times for one redeem (2026-10-03).
   */
  readonly #recentWrite = new Map<string, { t: number; via: 'garage' | 'admin' | 'item' }>();
  #writtenBy(steamId: string, t: number): 'garage' | 'admin' | 'item' | null {
    const w = this.#recentWrite.get(steamId);
    return w !== undefined && t >= w.t && t - w.t <= WRITE_WINDOW ? w.via : null;
  }
  #pushVia(event: MutationEvent | GrowthSetEvent): void {
    const via = this.#writtenBy(event.steamId, event.t);
    // The redeem's own growth and mutations: part of "lấy gara", no lines of their own (the owner: "log thừa").
    if (via === 'garage') return;
    this.#push(via === null ? event : { ...event, via }, [event.steamId]);
  }
  /**
   * A redeem's preparation: the young dino spawned to be the one taken out, and the
   * web command, one "lấy gara" line says it all (2026-10-03). Kept until a redeem
   * takes them off the log, or the next spawn / command replaces them.
   */
  readonly #prep = new Map<string, { spawn?: FeedEntry & { t: number }; cmd?: FeedEntry & { t: number } }>();
  /** Takes a line back off the log (and the player's timeline). */
  #unlog(entry: FeedEntry, steamId: string): void {
    for (const list of [this.#feed, this.#timelines.get(steamId)]) {
      if (list === undefined) continue;
      const i = list.lastIndexOf(entry);
      if (i >= 0) list.splice(i, 1);
    }
  }
  /** Each player's last death and what it added up, undone if it turns out a rebirth (#rebirth). */
  readonly #lastDeath = new Map<string, {
    t: number; life: LifeRecord | null; entry: FeedEntry; deathCounted: boolean;
    killer: string | null; killCounted: boolean; killerLife: LifeRecord | null;
    record: KillRecord | null; prevBiggestKill: KillRecord | null; prevBiggestPrey: KillRecord | undefined;
  }>();
  /** Admins (panel-auth adminIds, index.ts): nothing they do or suffer counts for the players. */
  #admins: ReadonlySet<string> = new Set();
  setAdmins(ids: Iterable<string>): void { this.#admins = new Set(ids); }
  isAdmin(steamId: string | null | undefined): boolean { return steamId != null && this.#admins.has(steamId); }
  #nextId = 1;
  #lastEventAt: number | null = null;
  /** Told of every feed entry as it is added (the Discord log: discord.ts). Replays included, the listener filters. */
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
        // A rebirth (chuyển sinh): a dino at 100 % starts again young with one more
        // elder stack, the same dino going on, so the same chain. Told apart
        // from an admin's gift with stacks: there the first reading of the new
        // life still has the old count (they come with the redeem, later).
        {
          const lives = this.#lives.get(event.steamId) ?? [];
          const life = this.#openLife(event.steamId);
          if (life !== null) {
            const stacks = typeof event.elderStacks === 'number' ? event.elderStacks : null;
            const before = lives[lives.length - 2];
            if (life.elderStacks === null && stacks !== null && before !== undefined
              && stacks > (before.elderStacks ?? 0) && (before.maxGrowth ?? 0) >= 0.99) {
              life.chain = before.chain;
              this.#rebirth(event.steamId, before, life);
            }
            if (stacks !== null) life.elderStacks = stacks;
            if (typeof event.growth === 'number') life.maxGrowth = Math.max(life.maxGrowth ?? 0, event.growth);
          }
        }
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
        p.ping = typeof event.ping === 'number' && Number.isFinite(event.ping) ? event.ping : null;
        if (event.max !== undefined) p.max = event.max;
        this.speciesStats.snapshot(event.steamId, event.t, event.species, event.growth, event.max,
          typeof event.prime === 'boolean' ? event.prime : undefined);
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
        // One entry per bite (#biteOf): a repeat of the hook for the same
        // bite counts nothing; a hold bite's next tick adds to its bite.
        const kind = this.#biteOf(event, amount);
        if (kind === 'repeat') break;
        if (event.attacker !== 'ai') {
          const a = this.#player(event.attacker, event.t, event.attackerName);
          a.damageDealt += amount;
          if (kind === 'bite') a.hits += 1;
          const life = this.#openLife(event.attacker);
          if (life !== null) life.damageDealt += amount;
        }
        if (event.victim !== 'ai') {
          this.#player(event.victim, event.t, event.victimName).damageTaken += amount;
          const life = this.#openLife(event.victim);
          if (life !== null) life.damageTaken += amount;
        }
        if (kind === 'bite') {
          // A bite on or by AI counts in the stats above but is not logged (most
          // of the hits, and nothing an admin looks for): kept off the feed and the
          // timelines, still tracked so its hold ticks merge into one bite.
          const withAi = event.attacker === 'ai' || event.victim === 'ai';
          const entry = (withAi ? { ...event, ticks: 1, id: 0 } : this.#push({ ...event, ticks: 1 }, [event.attacker, event.victim])) as FeedEntry & DamageBite;
          this.#lastBite.set(`${event.attacker}>${event.victim}`, { t: event.t, last: amount, bite: event.bite, entry });
        }
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
        p.mutations = event.mutations ? { ...event.mutations } : null;
        // A new life starts a new trail; joining the old one draws a line
        // across the map from the corpse to the spawn point.
        this.#trails.delete(event.steamId);
        this.#lifeStart.set(event.steamId, event.t);
        if (event.loc !== undefined) p.loc = event.loc;
        this.#startLife(event.steamId, event.species, event.growth, event.t);
        this.catalog.addSpecies(event.species, event.classPath);
        this.catalog.addMutations(event.species, event.mutations, { t: event.t, steamId: event.steamId });
        {
          const entry = this.#push(event, [event.steamId]);
          this.#prep.set(event.steamId, { spawn: entry as FeedEntry & { t: number } });
        }
        break;
      }

      case 'session_start': {
        // Two starts with no end between them: the server went down without
        // closing the session. Close it at the last thing we heard BEFORE this
        // start, #player() below moves lastSeen forward, and the downtime
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
        const leaving = this.#openLife(event.steamId);
        if (leaving !== null) leaving.pausedAt = event.t;
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
        // Written by the garage / an admin / an item just before: not the player's pick (not in the catalog either).
        if (this.#writtenBy(event.steamId, event.t) === null) {
          this.catalog.addMutation(event.species, event.slot, event.to, { t: event.t, steamId: event.steamId });
        }
        {
          const p = this.#player(event.steamId, event.t, event.name);
          const now = { ...(p.mutations ?? {}) };
          if (event.to) now[event.slot] = event.to; else delete now[event.slot];
          p.mutations = now;
        }
        this.#pushVia(event);
        break;

      case 'growth':
        this.#player(event.steamId, event.t, event.name);
        this.#push(event, [event.steamId]);
        break;
      case 'growth_set':
        this.#player(event.steamId, event.t, event.name);
        this.#pushVia(event);
        break;

      // DinoGarage does not know display names; fill in the one we have.
      case 'garage_store': {
        const p = this.#player(event.steamId, event.t);
        p.stored += 1;
        this.#recentRemoval.set(event.steamId, { t: event.t, cause: 'garage', slot: event.slot });
        // The growth it went into the garage at (the store's own reading, before it shrinks the dino).
        const storing = this.#openLife(event.steamId);
        if (storing !== null && typeof event.growth === 'number') storing.growth = event.growth;
        this.#push(p.name === null ? event : { ...event, name: p.name }, [event.steamId]);
        break;
      }

      case 'garage_redeem': {
        const p = this.#player(event.steamId, event.t);
        if (event.ok) {
          p.redeemed += 1;
          this.#recentWrite.set(event.steamId, { t: event.t, via: 'garage' });
          const prep = this.#prep.get(event.steamId);
          this.#prep.delete(event.steamId);
          // The young one spawned for it (a few minutes at most before) and the web command.
          if (prep?.spawn !== undefined && event.t - prep.spawn.t <= PREP_WINDOW) this.#unlog(prep.spawn, event.steamId);
          if (prep?.cmd !== undefined && event.t - prep.cmd.t <= PREP_WINDOW) this.#unlog(prep.cmd, event.steamId);
          const life = this.#openLife(event.steamId);
          if (life !== null) {
            life.redeemedFrom = event.slot;
            life.growth = event.growth ?? life.growth;
            // The dino taken out goes on living: the one stored in that slot,
            // or the dead one an admin restored ("khoiphuc-<its spawn time>").
            const lives = this.#lives.get(event.steamId) ?? [];
            const restored = /^khoiphuc-(\d+)$/.exec(event.slot);
            const from = [...lives].reverse().find((l) => l !== life && (l.storedTo === event.slot
              || (restored !== null && l.spawnedAt === Number(restored[1]))));
            if (from !== undefined) life.chain = from.chain;
          }
        }
        this.#push(p.name === null ? event : { ...event, name: p.name }, [event.steamId]);
        break;
      }

      case 'portal_command': {
        this.#commandResults.set(event.id, event);
        // An admin's action (grow, mutation slots…) or a mutation item: what the dino shows next is theirs.
        if (event.ok && (event.action === 'admin' || event.action === 'mutation')) {
          this.#recentWrite.set(event.steamId, { t: event.t, via: event.action === 'admin' ? 'admin' : 'item' });
        }
        if (this.#commandResults.size > 500) {
          const oldest = this.#commandResults.keys().next().value;
          if (oldest !== undefined) this.#commandResults.delete(oldest);
        }
        // A command for a SteamID never seen in game (the portal only sends
        // logged-in players, but an offline one may never have joined) must
        // not create a player out of thin air.
        const known = this.#players.get(event.steamId);
        if (known !== undefined) {
          const entry = this.#push(known.name === null ? event : { ...event, name: known.name }, [event.steamId]);
          if (event.action === 'redeem' && event.ok) {
            const prep = this.#prep.get(event.steamId) ?? {};
            this.#prep.set(event.steamId, { ...prep, cmd: entry as FeedEntry & { t: number } });
          }
        }
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

      case 'tele_result': {
        this.#teleResults.set(event.id, event);
        if (this.#teleResults.size > 500) {
          const oldest = this.#teleResults.keys().next().value;
          if (oldest !== undefined) this.#teleResults.delete(oldest);
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

  /**
   * 'panel': everything as it happened. 'players' (the portal): admins left out of
   * every board, kills and deaths as counted (#killCounts, nothing with an admin).
   */
  leaderboard(view: 'panel' | 'players' = 'panel'): Leaderboard {
    const forPlayers = view === 'players';
    const all = forPlayers ? this.players().filter((p) => !this.isAdmin(p.steamId)) : this.players();
    const kills = (p: PlayerStats): number => (forPlayers ? p.countedKills : p.kills);
    const deaths = (p: PlayerStats): number => (forPlayers ? p.countedDeaths : p.deaths);
    const top = (score: (p: PlayerStats) => number): PlayerStats[] =>
      all.filter((p) => score(p) > 0).sort((a, b) => score(b) - score(a)).slice(0, BOARD_SIZE);

    return {
      kills: top(kills),
      kd: all
        .filter((p) => kills(p) >= KD_MIN_KILLS)
        .map((p) => ({ ...p, kd: kills(p) / Math.max(1, deaths(p)) }))
        .sort((a, b) => b.kd - a.kd)
        .slice(0, BOARD_SIZE),
      damage: top((p) => p.damageDealt),
      playtime: top((p) => p.playtime),
      longestLife: top((p) => p.longestLife),
      biggestPrey: [...this.#biggestPrey.values()].filter((k) => !forPlayers || (!this.isAdmin(k.killer) && !this.isAdmin(k.victim))).sort(
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
      life.lastAt = event.t;
      // The garage store shrinks the dino before removing it: its "death" reads ~25 %,
      // not what went into the garage (the dinos list said 25 % for a grown one).
      if (deliberate !== 'garage') life.growth = event.growth ?? life.growth;
      if (typeof event.growth === 'number' && deliberate !== 'garage') life.maxGrowth = Math.max(life.maxGrowth ?? 0, event.growth);
      life.end = deliberate ?? 'death';
      if (deliberate === 'garage' && removal?.slot !== undefined) life.storedTo = removal.slot;
      this.#closeLife(event.steamId, life, event.t);
    }

    if (deliberate !== null) {
      this.#recentRemoval.delete(event.steamId);
      this.#push({ ...event, cause: deliberate }, [event.steamId]);
      return;
    }

    const killerId = event.killer !== undefined && event.killer !== 'ai' ? event.killer : null;
    // An admin on either side: logged for the panel as ever, counted for nobody on the players' side.
    const adminInvolved = this.isAdmin(event.steamId) || this.isAdmin(killerId);
    victim.deaths += 1;
    const deathCounted = !adminInvolved;
    if (deathCounted) victim.countedDeaths += 1;
    if (event.lifeSeconds !== undefined && event.lifeSeconds > victim.longestLife) {
      victim.longestLife = event.lifeSeconds;
    }

    const involved = [event.steamId];
    let killCounted = false;
    let killerLife: LifeRecord | null = null;
    let record: KillRecord | null = null;
    let prevBiggestKill: KillRecord | null = null;
    let prevBiggestPrey: KillRecord | undefined;
    let mark: { counted?: boolean; uncounted?: 'admin' | 'small' } = {};
    if (killerId !== null) {
      const killer = this.#player(killerId, event.t, event.killerName);
      killer.kills += 1;
      involved.push(killerId);
      killerLife = this.#openLife(killerId);
      if (killerLife !== null) killerLife.kills += 1;
      killCounted = !adminInvolved && killCounts(event.killerGrowth ?? killer.growth, event.growth);
      mark = killCounted ? { counted: true } : { counted: false, uncounted: adminInvolved ? 'admin' : 'small' };
      if (killCounted) {
        killer.countedKills += 1;
        if (killerLife !== null) killerLife.countedKills += 1;
      }
      if (life !== null) {
        life.killer = killerId;
        life.killerName = killer.name;
        life.killerSpecies = event.killerSpecies ?? null;
      }

      record = {
        t: event.t,
        killer: killerId,
        killerName: killer.name,
        killerSpecies: event.killerSpecies ?? null,
        victim: event.steamId,
        victimName: victim.name,
        species: event.species,
        growth: event.growth,
      };
      prevBiggestKill = killer.biggestKill;
      prevBiggestPrey = this.#biggestPrey.get(event.species);
      if ((record.growth ?? 0) > (killer.biggestKill?.growth ?? -1)) {
        killer.biggestKill = record;
      }
      const best = this.#biggestPrey.get(event.species);
      if (best === undefined || (record.growth ?? 0) > (best.growth ?? 0)) {
        this.#biggestPrey.set(event.species, record);
      }
    }

    const entry = this.#push({ ...event, ...mark }, involved);
    pushBounded(this.#kills, entry, config.killfeedSize);
    this.#lastDeath.set(event.steamId, {
      t: event.t, life, entry, deathCounted, killer: killerId, killCounted, killerLife, record, prevBiggestKill, prevBiggestPrey,
    });
  }

  /**
   * Chuyển sinh: the prime at 100 % that "died" a few seconds before this new
   * life came back young with one more elder stack. Not a death, and not a
   * kill for whoever bit it last (Quang Tèo's rebirth, 02/10 20:43, went down
   * as a kill): everything its death added is taken back, its feed line says
   * so. Its survival time goes on (the chain, set by the caller).
   */
  #rebirth(steamId: string, before: LifeRecord, now: LifeRecord): void {
    const d = this.#lastDeath.get(steamId);
    if (d === undefined || d.life !== before || before.end !== 'death' || now.spawnedAt - d.t > REBIRTH_WINDOW) return;
    this.#lastDeath.delete(steamId);
    before.end = 'rebirth';
    const victim = this.#player(steamId, d.t);
    victim.deaths = Math.max(0, victim.deaths - 1);
    if (d.deathCounted) victim.countedDeaths = Math.max(0, victim.countedDeaths - 1);
    if (d.killer !== null) {
      const killer = this.#player(d.killer, d.t);
      killer.kills = Math.max(0, killer.kills - 1);
      if (d.killerLife !== null) d.killerLife.kills = Math.max(0, d.killerLife.kills - 1);
      if (d.killCounted) {
        killer.countedKills = Math.max(0, killer.countedKills - 1);
        if (d.killerLife !== null) d.killerLife.countedKills = Math.max(0, d.killerLife.countedKills - 1);
      }
      if (d.record !== null && killer.biggestKill === d.record) killer.biggestKill = d.prevBiggestKill;
      if (d.record !== null && this.#biggestPrey.get(d.record.species) === d.record) {
        if (d.prevBiggestPrey === undefined) this.#biggestPrey.delete(d.record.species);
        else this.#biggestPrey.set(d.record.species, d.prevBiggestPrey);
      }
      before.killer = null; before.killerName = null; before.killerSpecies = null;
    }
    const e = d.entry as FeedEntry & { cause?: string; counted?: boolean; uncounted?: string };
    e.cause = 'rebirth';
    delete e.counted; delete e.uncounted;
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

  /** How a tele ended (null = still counting down), only for the player who moved. */
  teleResult(steamId: string, id: number): TeleResultEvent | null {
    const r = this.#teleResults.get(id);
    return r !== undefined && r.steamId === steamId ? { ...r } : null;
  }

  /** Chain id -> survival seconds of its closed stretches, and whose / which dino. */
  readonly #chains = new Map<number, { steamId: string; species: string; closed: number }>();
  #chainSeq = 0;

  /** A stretch of a dino ends at `at`: its time goes to the dino's chain. */
  #closeLife(steamId: string, life: LifeRecord, at: number): void {
    life.endedAt = at;
    const c = this.#chains.get(life.chain) ?? { steamId, species: life.species, closed: 0 };
    c.closed += Math.max(0, at - life.spawnedAt);
    c.species = life.species;
    this.#chains.set(life.chain, c);
  }

  /** The player's longest-surviving dino: its chain's time, the stretch alive now included. */
  #longestChain(steamId: string, online: boolean, now: number): { seconds: number; species: string; alive: boolean } | null {
    const open = this.#openLife(steamId);
    let best: { seconds: number; species: string; alive: boolean } | null = null;
    for (const [id, c] of this.#chains) {
      if (c.steamId !== steamId) continue;
      const alive = open !== null && open.chain === id;
      const seconds = c.closed + (alive ? Math.max(0, (online ? Math.max(now, open.lastAt) : open.pausedAt ?? open.lastAt) - open.spawnedAt) : 0);
      if (best === null || seconds > best.seconds) best = { seconds, species: c.species, alive };
    }
    if (open !== null && !this.#chains.has(open.chain)) {
      const seconds = Math.max(0, (online ? Math.max(now, open.lastAt) : open.pausedAt ?? open.lastAt) - open.spawnedAt);
      if (best === null || seconds > best.seconds) best = { seconds, species: open.species, alive: true };
    }
    return best;
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
    // not see (species swap, a death between two polls, a relog). Close it
    // unresolved, where the player left if they did.
    const open = this.#openLife(steamId);
    if (open !== null) this.#closeLife(steamId, open, open.pausedAt ?? open.lastAt);
    // The same dino again (a relog: same species, growth going on, no death
    // or store seen): the same chain. The admin camera ("AdminPawn", an admin
    // spectating between two stretches) is not a dino: looked past.
    const prev = [...lives].reverse().find((l) => !/AdminPawn/i.test(l.species));
    const same = prev !== undefined && prev.end === null && prev.species === species
      && growth !== null && (prev.maxGrowth ?? prev.growth) !== null && growth >= (prev.maxGrowth ?? prev.growth ?? 0) - 0.02;
    const chain = same ? (prev as LifeRecord).chain : ++this.#chainSeq;

    pushBounded(lives, {
      species,
      spawnedAt: t,
      lastAt: t,
      endedAt: null,
      end: null,
      growthStart: growth,
      growth,
      kills: 0,
      countedKills: 0,
      damageDealt: 0,
      damageTaken: 0,
      killer: null,
      killerName: null,
      killerSpecies: null,
      redeemedFrom: null,
      chain,
      pausedAt: null,
      storedTo: null,
      elderStacks: null,
      maxGrowth: growth,
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
    // An open session with nothing heard for a while means the server went
    // down (or the bridge is replaying old files), not a connected player.
    const online = open && now - p.lastSeen <= config.offlineAfterSeconds;
    const longest = this.#longestChain(p.steamId, online, now);
    return {
      ...p,
      ...(longest !== null && longest.seconds >= p.longestLife
        ? { longestLife: longest.seconds, longestLifeSpecies: longest.species, longestLifeAlive: longest.alive }
        : {}),
      playtime: p.playtime + (open ? Math.max(0, p.lastSeen - (p.sessionStart ?? 0)) : 0),
      online,
      ping: online ? p.ping : null,
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
        countedKills: 0,
        countedDeaths: 0,
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
        longestLifeSpecies: null,
        longestLifeAlive: false,
        biggestKill: null,
        skin: null,
        ping: null,
        mutations: null,
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

  /** attacker>victim -> the last bite logged between them (for repeats and hold-bite ticks). */
  readonly #lastBite = new Map<string, { t: number; last: number; bite: string | undefined; entry: FeedEntry & DamageBite }>();

  /**
   * What a "damage" event is, bite by bite. The ApplyDamage hook fires several
   * times for one bite, with the same number (a T-Rex's bite logged up to six
   * times, 2026-09-28, the victim lost it once): a repeat. A hold bite
   * (mouse held) deals ticks a little lower each time, within the same
   * second: a tick, added to its bite. Anything else is a new bite.
   */
  #biteOf(event: { t: number; attacker: string; victim: string; bite?: string; tick?: number }, amount: number): 'repeat' | 'tick' | 'bite' {
    const prev = this.#lastBite.get(`${event.attacker}>${event.victim}`);
    // Newer StatsLogger names the bite itself (its repeats already dropped): exact.
    if (typeof event.bite === 'string') {
      if (prev !== undefined && prev.bite === event.bite && (event.tick ?? 1) > 1) {
        prev.entry.amount = Math.round(((prev.entry.amount ?? 0) + amount) * 1000) / 1000;
        prev.entry.ticks += 1;
        prev.last = amount;
        prev.t = event.t;
        return 'tick';
      }
      return 'bite';
    }
    if (prev === undefined || event.t - prev.t > 1 || event.t < prev.t) return 'bite';
    // The hook's repeats come within the same moment. The same number a second
    // later is another bite: out of stamina, bites hit the same floor.
    if (event.t === prev.t && Math.abs(amount - prev.last) < 0.01) return 'repeat';
    const drop = prev.last - amount;
    if (drop > 0 && drop < prev.last * 0.1) {
      prev.entry.amount = Math.round(((prev.entry.amount ?? 0) + amount) * 1000) / 1000;
      prev.entry.ticks += 1;
      prev.last = amount;
      prev.t = event.t;
      return 'tick';
    }
    return 'bite';
  }

  #nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }
}
