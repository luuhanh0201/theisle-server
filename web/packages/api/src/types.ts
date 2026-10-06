/**
 * What the bridge's routes send, as the pages use it. Keep in step with the bridge
 * (the file named on each type); a field the bridge adds is simply not read until it is added here.
 */

/** GET /api/me (bridge/src/panel-auth.ts, server.ts): who is logged in and what they may do. */
export interface Me {
  steamId: string | null;
  name: string | null;
  ip: string | null;
  via: 'tunnel' | 'web';
  /** The write token of this login (null through the SSH tunnel without a login). */
  token: string | null;
  perms: string[];
  super: boolean;
}

/** GET /api/health (bridge/src/server.ts). */
export interface Health {
  lastEventAt: number | null;
  players: number;
  online: number;
  feed: number;
  writesEnabled: boolean;
}

/** GET /api/server/status (bridge/src/power.ts): the game service's phase. */
export interface ServerStatus { phase: 'running' | 'starting' | 'stopping' | 'stopped' | 'failed' | 'unknown' | string }

/** GET / PUT /api/tele-settings (bridge/src/tele.ts TeleSettings). */
export interface TeleSettings {
  maxGrowthPct: number;
  targetMaxGrowthPct: number;
  codeMinutes: number;
  cooldownS: number;
  combatS: number;
  countdownS: number;
}

/** GET / PUT /api/ptera-carry (bridge/src/ptera-settings.ts PteraSettings). */
export interface PteraSettings {
  enabled: boolean;
  maxKg: number;
  maxSeconds: number;
  cooldown: number;
  hintMeters: number;
  grabMeters: number;
}

/** GET / PUT /api/commands-settings (bridge/src/commands-settings.ts): the players' chat commands. */
export type PlayerCommand = 'slay' | 'unstuck' | 'prime' | 'status' | 'food';
export interface CommandsSettings {
  slayCooldown: number;
  unstuckCooldown: number;
  foodCooldown: number;
  enabled: Record<PlayerCommand, boolean>;
}

/** GET /api/voice-settings (bridge/src/voice-settings.ts); PUT takes { nameMode } only. */
export interface VoiceSettings {
  nameMode: 'name' | 'id' | 'none';
  /** The voice server is set up on the bridge (LiveKit keys). */
  enabled: boolean;
  url: string | null;
}

/** One text players get (bridge/src/messages.ts MessageDef). */
export interface MessageDef {
  key: string;
  group: string;
  label: string;
  default: string;
  vars: string[];
  offByDefault?: boolean;
  fromBridge?: boolean;
}
export interface PeriodicMessage { id?: string; text: string; everyMin: number; enabled: boolean }
/** GET /api/messages (bridge/src/messages.ts MessagesSettings + its catalog); PUT takes the settings. */
export interface MessagesSettings {
  texts: Record<string, string>;
  countdownMarks: number[];
  periodic: PeriodicMessage[];
  corpseWipe: { everyMin: number; warnSec: number };
  catalog: MessageDef[];
}

/** GET /api/flora-settings (bridge/src/flora-settings.ts): the settings, the mod's last round, when the plants were read. */
export interface FloraSettings {
  control: boolean;
  migrationNutrientPct: number; migrationMultiplier: number;
  massNutrientPct: number; massMultiplier: number;
  outsideAmountPct: number;
  migrationMaxPerArea: number; massMaxPerArea: number; outsideMaxPerArea: number;
}
export interface FloraRound { t: number; on: boolean; active: number; plants: number; plantsNutri: number; fruits: number; fruitsNutri: number; trimmed?: number }
export interface FloraState { settings: FloraSettings; control: FloraRound | null; t: number | null }

/** GET /api/fish-settings (bridge/src/fish-settings.ts); PUT takes the settings, answers { rcon }. */
export interface FishSettings { control: boolean; perPlayer: number; perWater: number; cooldownSec: number; species: string[] }
export interface FishState {
  settings: FishSettings;
  species: Array<{ key: string; cls: string; label: string }>;
  census: { t: number; online: number; total: number; species: Record<string, number>; perPlayer?: number; perWater?: number; cooldownSec?: number } | null;
  disallowed: string[];
}

/** One mutation in the community reference (bridge/src/mutation-reference.ts). */
export interface MutationRef {
  name: string; en: string; description: string; diet?: string; kind?: string; stat?: string; tiers?: string;
  status: string; statusNote?: string; sources: string[]; aliases?: string[]; femaleOnly?: boolean; groupLeaderOnly?: boolean;
  slots?: string; unlock?: string; unlockEn?: string;
}
/** GET /api/mutations: the admins' notes, the reference, which in-game name matches which entry. */
export interface MutationsData {
  notes: Record<string, { description: string; updatedAt?: number }>;
  reference: MutationRef[];
  referenceChecked?: string;
  sources: Record<string, string>;
  matches: Record<string, string>;
}
/** One species the server has seen (bridge/src/catalog.ts), with the mutations seen on it. */
export interface CatalogSpecies {
  species: string;
  classPath: string | null;
  mutations: { active: string[]; parent: string[]; elder: string[] };
  evidence?: Record<string, { count: number; players: number; lastSeen?: number; groups: string[] }>;
}
/** GET /api/garage: every stored slot, by player, as the index has it. */
export interface GarageIndex { schema?: number; players: Record<string, Record<string, { classPath: string; growth?: number; capturedAt?: number; isPrime?: boolean }>> }
/** A row of GET /api/players (bridge/src/store.ts PlayerStats + live view), what the panel reads of it. */
export interface PlayerRow {
  steamId: string; name: string | null; species: string | null; online: boolean; growth: number | null; lastSeen?: number | null;
  tier?: string; garage?: number;
  [k: string]: unknown;
}

/** GET / PUT /api/garage-settings (bridge/src/garage.ts GarageSettings); the GET adds memberCounts. */
export interface GarageSettings {
  redeemAt: 'current' | 'stored' | 'choice';
  maxSlots: number; storeCountdown: number; cooldown: number; minHealthPct: number; minGrowthPct: number;
  tiers: { vip: { maxSlots: number; cooldown: number }; svip: { maxSlots: number; cooldown: number } };
}
export interface GarageSettingsState extends GarageSettings { memberCounts?: { vip?: number; svip?: number; admin?: number } }
