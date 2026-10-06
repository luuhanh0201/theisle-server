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

/** A start / stop / restart in progress or the last one (bridge/src/power.ts Operation). */
export interface PowerOperation {
  id: number; kind: 'start' | 'stop' | 'restart'; source: 'admin' | 'schedule' | 'config'; reason: string;
  startedAt: number;
  /** Unix ms when the stop / restart itself happens (after the countdown). */
  runAt: number;
  step: 'countdown' | 'saving' | 'stopping' | 'restarting' | 'backup' | 'starting' | 'waiting' | 'done' | 'failed' | 'cancelled';
  finishedAt: number | null;
  message: string | null;
}
/** GET /api/server/status, whole (server.ts serverStatus). */
export interface ServerStatusFull extends ServerStatus {
  unit: { activeState: string; subState: string; since: number | null; pid: number | null } | null;
  modsLoadedAt: number | null;
  error?: string;
  operation: PowerOperation | null;
  lastOperation: PowerOperation | null;
  schedule: { daily: string[]; countdownMinutes: number; next: number | null };
  timeZone: string;
  rconEnabled: boolean;
  writesEnabled: boolean;
  unitName: string;
  /** The bridge's clock (ms), for the countdown. */
  now?: number;
}
/** GET /api/server/readiness (bridge/src/readiness.ts Readiness). */
export interface Readiness {
  verdict: 'ready' | 'starting' | 'down' | 'problem';
  summary: string;
  checks: Array<{ id: string; label: string; state: 'ok' | 'fail' | 'wait'; detail: string; at?: number }>;
  lastJoin: { t: number; name?: string } | null;
  checkedAt: number;
}
/** GET /api/server/growth-events (server.ts; bridge/src/growth-events.ts). POST { start, end, multiplier, note }, DELETE /<id>. */
export interface GrowthEvents {
  events: Array<{ id: string; start: number; end: number; multiplier: number; note: string | null; createdBy: string | null; appliesAt: number | null; endsAt: number | null }>;
  applied: { at: number; multiplier: number; event: { id: string; end: number; note: string | null } | null } | null;
  daily: string[];
  limits: { min: number; max: number };
}
/** GET /api/ddos (server.ts; bridge/src/ddos.ts). PUT takes { enabled, pps, mbps, sustainSec }. */
export interface DdosView {
  enabled: boolean; pps: number; mbps: number; sustainSec: number;
  iface: string | null;
  attack: { since: number; peakPps: number; peakMbps: number; onlineBefore: number | null } | null;
  history: Array<{ t: number; pps: number; mbps: number; outMbps: number }>;
}
/** GET /api/rcon/commands (server.ts; bridge/src/rcon.ts RCON_COMMANDS). */
export interface RconCommands { enabled: boolean; commands: Record<string, { label: string; args: string; read: boolean; toggle: boolean }> }

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
  /** Their garage's slots by tier (null = no limit). */
  garageMax?: number | null;
  ping?: number | null;
  kills?: number; deaths?: number; damageDealt?: number; damageTaken?: number; playtime?: number; spawns?: number; chats?: number; stored?: number;
  /** Serving a prison sentence (bridge/src/prison.ts playerView). */
  prison?: { offense: string; remainingSec: number; escaped: boolean } | null;
  [k: string]: unknown;
}

/** GET / PUT /api/garage-settings (bridge/src/garage.ts GarageSettings); the GET adds memberCounts. */
export interface GarageSettings {
  redeemAt: 'current' | 'stored' | 'choice';
  maxSlots: number; storeCountdown: number; cooldown: number; minHealthPct: number; minGrowthPct: number;
  tiers: { vip: { maxSlots: number; cooldown: number }; svip: { maxSlots: number; cooldown: number } };
}
export interface GarageSettingsState extends GarageSettings { memberCounts?: { vip?: number; svip?: number; admin?: number } }

/** GET /api/members (bridge/src/server.ts): the Game.ini lists and who is fixed. */
export interface MembersData {
  admins: string[]; whitelist: string[]; vips: string[]; whitelistOn: boolean;
  names: Record<string, string>; owners?: string[]; superAdmin?: string | null; pendingRestart?: boolean;
}
/** GET / PUT /api/svip (bridge/src/svip.ts). */
export interface SvipData {
  players: Array<{ steamId: string; note: string; addedAt: number; by: string | null; name?: string | null }>;
  features: Array<{ key: string; label: string; mode: 'admin' | 'testing' | 'all' }>;
  modes?: Array<{ key: 'admin' | 'testing' | 'all'; label: string; note: string }>;
}
/** GET /api/permissions (bridge/src/permissions.ts): the super admin's page. */
export interface PermDraft { role: string; allow: string[]; deny: string[]; ingame: boolean }
export interface PermissionsData {
  perms: Array<{ key: string; group: string; label: string }>;
  roles: Record<string, { label: string; perms: string[] }>;
  admins: Array<{ steamId: string; name: string | null; super: boolean; owner: boolean; perm: PermDraft; set: boolean; inGameNow: boolean }>;
  superAdmin: string | null;
}

/** GET /api/panel-access (bridge/src/panel-auth.ts): who may open the panel; PUT { ips }. */
export interface PanelAccess { ips: string[]; saved: boolean; yourIp: string | null; yourRule: string | null; webEnabled: boolean }
/** GET /api/server/audit?page&limit&q (bridge/src/audit.ts); `key` only for the super admin (to delete a line). */
export interface AuditEntry { t: number; action: string; detail?: string; ok: boolean; error?: string; by?: string | null; byId?: string | null; byName?: string | null; key?: string }
export interface AuditPage { entries: AuditEntry[]; page: number; pages: number; total: number }
/** GET /api/discord (bridge/src/discord.ts): the log by webhook, its routes, and how it is going. */
export interface DiscordData {
  enabled: boolean;
  routes: Record<string, string>;
  mentions?: Record<string, string>;
  channels: Array<{ id: string; name: string; hint: string }>;
  relay: { url: string; hasSecret: boolean } | null;
  board: string | null;
  kinds: Array<{ key: string; group: string; label: string }>;
  status: {
    queued: number; dropped: number;
    relay?: { lastOkAt: number | null; lastError: string | null };
    channels: Record<string, { webhook?: { name?: string; channelId?: string; error?: string }; lastError?: string | null; lastOkAt?: number | null; queued?: number }>;
  };
}

/** One Game.ini key the panel owns (bridge/src/gameini.ts MANAGED, without the list item RegExp). */
export type GameKeySpec = {
  section: string; group: string; label: string; help: string; verified?: false;
} & (
  | { type: 'int'; min: number; max: number; default: number }
  | { type: 'float'; min: number; max: number; step: number; default: number }
  | { type: 'bool'; default: boolean }
  | { type: 'text'; maxLen: number; default: string }
  | { type: 'list'; itemHelp: string; max: number; min?: number; suggest?: string[] }
);
/** GET /api/game-config (server.ts). PUT { settings, restart?: { countdownSeconds, reason } } answers { settings, operation }. */
export interface GameConfig {
  /** What the panel has set. */
  settings: Record<string, unknown>;
  /** The managed keys as the live Game.ini has them now. */
  effective: Record<string, unknown>;
  iniWrittenAt: number | null;
  error?: string;
  schema: Record<string, GameKeySpec>;
  knownPlayables: string[];
  groups: Record<string, string>;
  /** Saved after the server last started: waiting for a restart. */
  pendingRestart: boolean;
}

/** One backup file (bridge/src/backup.ts BackupInfo). */
export interface BackupInfo { name: string; kind: 'data' | 'settings'; size: number; createdAt: number; reason: string; parts: string[] }
/** GET /api/backups (server.ts): the files, the settings, what a wipe may take, the game's phase. */
export interface BackupsView {
  backups: BackupInfo[];
  settings: { atScheduledRestart: boolean; keep: number };
  parts: Array<{ key: string; label: string }>;
  phase: string;
}
