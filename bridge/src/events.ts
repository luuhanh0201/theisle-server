/**
 * The NDJSON shapes StatsLogger and DinoGarage emit. Keep in sync with
 * mods/StatsLogger/Scripts/main.lua and mods/DinoGarage/Scripts/main.lua.
 *
 * Everything here is data the game process wrote to disk — treat every field
 * as possibly missing. The Lua side omits a field when a property could not be
 * resolved, which happens until the VITALS names are verified.
 */

export interface BaseEvent {
  /** Unix seconds, set by the Lua side. */
  t: number;
  type: string;
}

/** World position in UE units (cm), rounded. */
export interface Loc {
  x: number;
  y: number;
  z?: number;
}

export interface ModLoadedEvent extends BaseEvent {
  type: 'mod_loaded';
  mod: string;
}

export interface DamageEvent extends BaseEvent {
  type: 'damage';
  /** SteamID64, or "ai" when the pawn had no player controller. */
  attacker: string;
  victim: string;
  amount: number | null;
  attackerName?: string;
  attackerSpecies?: string;
  victimName?: string;
  victimSpecies?: string;
  /** Where the victim was. */
  loc?: Loc;
}

export interface SnapshotEvent extends BaseEvent {
  type: 'snapshot';
  steamId: string;
  name?: string;
  species: string;
  health: number | null;
  stamina: number | null;
  hunger: number | null;
  thirst: number | null;
  oxygen?: number | null;
  blood?: number | null;
  growth: number | null;
  loc?: Loc;
  yaw?: number;
  /** The game's current maxima (GetMaxHealth…), for bars. Absent from older mods. */
  max?: Partial<Record<VitalName, number>>;
}

export type VitalName = 'health' | 'stamina' | 'hunger' | 'thirst' | 'blood' | 'oxygen';

/** Prime / elder status, from the game's own getters. Sent at spawn and on change. */
export interface PrimeEvent extends BaseEvent {
  type: 'prime';
  steamId: string;
  name?: string;
  species?: string;
  elder?: boolean;
  prime?: boolean;
  eligible?: boolean;
  elderStacks?: number;
  /** pawn.EligiblePrimeElderData.bPrimeCondition1..10, keyed "1".."10". */
  conditions?: Record<string, boolean>;
  growth?: number | null;
}

export interface DeathEvent extends BaseEvent {
  type: 'death';
  steamId: string;
  name?: string;
  species: string;
  growth: number | null;
  loc?: Loc;
  /** Seconds between the spawn we saw and this death. */
  lifeSeconds?: number;
  /** Absent for environmental, DoT and AI deaths — the game hides those. */
  killer?: string;
  killerName?: string;
  killerSpecies?: string;
  killerGrowth?: number;
  /** Amount of the hit that explains the death. */
  lastHit?: number;
  attributed: boolean;
  /** "pawn_lost": the dino vanished between two polls (e.g. a fall) — no final HP seen. */
  detectedBy?: 'pawn_lost';
}

/** Filled mutation slots, keyed like a garage slot file: Slot1, ParentSlot2, ElderSlot3A… */
export type MutationSlots = Record<string, string>;

export interface SpawnEvent extends BaseEvent {
  type: 'spawn';
  steamId: string;
  name?: string;
  species: string;
  /** GetFullName() of the class: what DinoGarage compares on !redeem. */
  classPath?: string;
  growth: number | null;
  mutations?: MutationSlots;
  loc?: Loc;
}

/** A mutation slot changed within one life: usually the player picking one. */
export interface MutationEvent extends BaseEvent {
  type: 'mutation';
  steamId: string;
  name?: string;
  species: string;
  slot: string;
  /** Absent when the slot was empty before / is empty now. */
  from?: string;
  to?: string;
  growth?: number;
}

export interface SessionStartEvent extends BaseEvent {
  type: 'session_start';
  steamId: string;
  name?: string;
}

export interface SessionEndEvent extends BaseEvent {
  type: 'session_end';
  steamId: string;
  name?: string;
  species?: string;
  /** Seconds online. */
  duration: number;
}

/**
 * A message a mod wants shown to one player. Lua cannot send it (UpdateChat
 * crashes the server; ClientMessage is not displayed), so the bridge delivers
 * it with RCON DirectMessage. Not shown in the panel's feed.
 */
export interface NotifyEvent extends BaseEvent {
  type: 'notify';
  steamId: string;
  message: string;
}

/** One colour region of a skin: Unreal FLinearColor channels, linear 0..1. */
export interface SkinColor { r: number; g: number; b: number }
/** pawn.CustomizerData as the mod reads it. Region names are the game's, minus "Color". */
export interface Skin {
  colors: Record<string, SkinColor>;
  patternIndex?: number;
  themeIndex?: number;
  variation?: number;
  female?: boolean;
}

/** Sent on spawn and whenever the skin changes (not in every snapshot). */
export interface SkinEvent extends BaseEvent {
  type: 'skin';
  steamId: string;
  name?: string;
  species?: string;
  skin: Skin;
}

export interface ChatEvent extends BaseEvent {
  type: 'chat';
  steamId: string;
  name?: string;
  message: string;
}

export interface GrowthEvent extends BaseEvent {
  type: 'growth';
  steamId: string;
  name?: string;
  species: string;
  /** 0.25, 0.5, 0.75 or 1. */
  milestone: number;
  growth: number;
  lifeSeconds?: number;
}

/** Growth changed faster than it can grow: a redeem, an admin, or a cheat. */
export interface GrowthSetEvent extends BaseEvent {
  type: 'growth_set';
  steamId: string;
  name?: string;
  species: string;
  from: number;
  to: number;
}

export interface GarageStoreEvent extends BaseEvent {
  type: 'garage_store';
  steamId: string;
  /** Not written by the mod; the bridge fills it in when it knows it. */
  name?: string;
  slot: string;
  species: string;
  growth: number | null;
}

export interface GarageRedeemEvent extends BaseEvent {
  type: 'garage_redeem';
  steamId: string;
  /** Not written by the mod; the bridge fills it in when it knows it. */
  name?: string;
  slot: string;
  species: string;
  growth: number | null;
  ok: boolean;
}

/** Outcome of an admin "remove current dino" command (DinoGarage inbox). */
export interface AdminKillEvent extends BaseEvent {
  type: 'admin_kill';
  id: number;
  steamId: string;
  /** Filled in by the bridge when it knows the name. */
  name?: string;
  ok: boolean;
  reason?: string;
  /** offline | no_dino | expired | no_game_thread | set_health_failed | unknown_command */
  error?: string;
  species?: string;
  growth?: number;
}

export type GameEvent =
  | ModLoadedEvent
  | DamageEvent
  | SnapshotEvent
  | DeathEvent
  | SpawnEvent
  | SessionStartEvent
  | SessionEndEvent
  | ChatEvent
  | NotifyEvent
  | SkinEvent
  | PrimeEvent
  | GrowthEvent
  | GrowthSetEvent
  | MutationEvent
  | AdminKillEvent
  | GarageStoreEvent
  | GarageRedeemEvent;

const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The required fields per type. Optional fields are left to the consumer,
 * which already treats every field as possibly missing.
 */
const required: Record<GameEvent['type'], (e: Record<string, unknown>) => boolean> = {
  mod_loaded: (e) => isString(e['mod']),
  damage: (e) => isString(e['attacker']) && isString(e['victim']),
  snapshot: (e) => isString(e['steamId']),
  death: (e) => isString(e['steamId']),
  spawn: (e) => isString(e['steamId']),
  session_start: (e) => isString(e['steamId']),
  session_end: (e) => isString(e['steamId']) && isNumber(e['duration']),
  chat: (e) => isString(e['steamId']) && isString(e['message']),
  notify: (e) => isString(e['steamId']) && isString(e['message']),
  prime: (e) => isString(e['steamId']),
  skin: (e) => isString(e['steamId']) && typeof e['skin'] === 'object' && e['skin'] !== null
    && typeof (e['skin'] as Record<string, unknown>)['colors'] === 'object',
  growth: (e) => isString(e['steamId']) && isNumber(e['milestone']),
  growth_set: (e) => isString(e['steamId']) && isNumber(e['from']) && isNumber(e['to']),
  mutation: (e) => isString(e['steamId']) && isString(e['slot']),
  admin_kill: (e) => isString(e['steamId']) && typeof e['ok'] === 'boolean',
  garage_store: (e) => isString(e['steamId']) && isString(e['slot']),
  garage_redeem: (e) => isString(e['steamId']) && isString(e['slot']),
};

/**
 * Narrow an unknown parsed line to a GameEvent. A malformed line is dropped,
 * not thrown on: the stream is append-only and a torn last line is normal when
 * we read while the game is mid-write.
 */
export function parseEvent(raw: unknown): GameEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (!isNumber(e['t']) || !isString(e['type'])) return null;
  if (!Object.hasOwn(required, e['type'])) return null;
  const check = required[e['type'] as GameEvent['type']];
  return check(e) ? (e as unknown as GameEvent) : null;
}
