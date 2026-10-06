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

/** The chat commands the PlayerCommands mod has (bridge/src/commands-settings.ts COMMANDS). */
export type CommandName = 'slay' | 'unstuck' | 'prime' | 'status' | 'food';

/** GET / PUT /api/commands-settings (bridge/src/commands-settings.ts CommandsSettings). */
export interface CommandsSettings {
  slayCooldown: number;
  unstuckCooldown: number;
  foodCooldown: number;
  enabled: Record<CommandName, boolean>;
}

/** What players see of who is talking near them (bridge/src/voice-settings.ts NAME_MODES). */
export type VoiceNameMode = 'name' | 'id' | 'none';

/** PUT /api/voice-settings and its answer (bridge/src/voice-settings.ts VoiceSettings). */
export interface VoiceSettings { nameMode: VoiceNameMode }

/** GET /api/voice-settings: the settings, and whether voice runs on the bridge (server.ts). */
export interface VoiceSettingsStatus extends VoiceSettings { enabled: boolean; url: string | null }

/** One in-game text the admin may change (bridge/src/messages.ts MessageDef). */
export interface MessageDef {
  key: string;
  group: string;
  label: string;
  default: string;
  /** The {names} it may use. */
  vars: string[];
  /** Not sent unless the admin writes a text (the default is only the suggested wording). */
  offByDefault?: boolean;
  fromBridge?: boolean;
}

/** A periodic announcement (bridge/src/messages.ts Periodic); a new one has no id until saved. */
export interface PeriodicMessage { id?: string; text: string; everyMin: number; enabled: boolean }

/** PUT /api/messages and its answer (bridge/src/messages.ts MessagesSettings). */
export interface MessagesSettings {
  /** Only the texts an admin changed; "" = do not send. */
  texts: Record<string, string>;
  /** Seconds left at which a restart / stop countdown announces, largest first. */
  countdownMarks: number[];
  periodic: PeriodicMessage[];
  /** Clear corpses every `everyMin` minutes (0 = off), announced `warnSec` before. */
  corpseWipe: { everyMin: number; warnSec: number };
}

/** GET /api/messages: the settings and every text there is (server.ts). */
export interface MessagesWithCatalog extends MessagesSettings { catalog: MessageDef[] }

/** PUT /api/flora-settings and its answer (bridge/src/flora-settings.ts FloraSettings). */
export interface FloraSettings {
  control: boolean;
  migrationNutrientPct: number;
  migrationMultiplier: number;
  massNutrientPct: number;
  massMultiplier: number;
  outsideAmountPct: number;
  migrationMaxPerArea: number;
  massMaxPerArea: number;
  outsideMaxPerArea: number;
}

/** The Flora mod's last control round (mods/Flora, flora.json `control`). */
export interface FloraControl { t: number; on: boolean; active: number; plants: number; plantsNutri: number; fruits: number; fruitsNutri: number; trimmed?: number }

/** GET /api/flora-settings (server.ts): the settings, the last round, when the plants were read. */
export interface FloraSettingsStatus { settings: FloraSettings; control: FloraControl | null; t: number | null }

/** PUT /api/fish-settings's body (bridge/src/fish-settings.ts FishSettings). */
export interface FishSettings { control: boolean; perPlayer: number; perWater: number; cooldownSec: number; species: string[] }

/** The fish counted near players (bridge/src/fish-settings.ts FishCensus). */
export interface FishCensus { t: number; online: number; total: number; species: Record<string, number>; perPlayer?: number; perWater?: number; cooldownSec?: number }

/** GET /api/fish-settings (server.ts). */
export interface FishSettingsStatus {
  settings: FishSettings;
  species: Array<{ key: string; cls: string; label: string }>;
  census: FishCensus | null;
  disallowed: string[];
}

/** PUT /api/fish-settings's answer: `rcon` 'sent' | 'not needed' | 'unavailable' | 'restart needed' | 'failed: …'. */
export interface FishSaved { settings: FishSettings; disallowed: string[]; rcon: string }

/** Where a dino comes out of the garage (bridge/src/garage.ts RedeemAt). */
export type RedeemAt = 'current' | 'stored' | 'choice';
/** One member tier's garage rule (maxSlots 0 = no limit). */
export interface TierRule { maxSlots: number; cooldown: number }

/** PUT /api/garage-settings and its answer (bridge/src/garage.ts GarageSettings). */
export interface GarageSettings {
  redeemAt: RedeemAt;
  maxSlots: number;
  storeCountdown: number;
  cooldown: number;
  minHealthPct: number;
  minGrowthPct: number;
  tiers: { vip: TierRule; svip: TierRule };
}

/** GET /api/garage-settings (server.ts): with how many members each tier has. */
export interface GarageSettingsStatus extends GarageSettings { memberCounts: { vip: number; svip: number; admin: number } }

/** GET /api/panel-access and the PUT's answer (bridge/src/panel-access.ts, server.ts). PUT body: { ips }. */
export interface PanelAccess {
  ips: string[];
  /** false: the list comes from PANEL_ALLOWED_IPS in .env, never saved on the panel. */
  saved: boolean;
  /** Where this admin comes from (null through the SSH tunnel), and the rule that lets it in (an IPv6 /64). */
  yourIp: string | null;
  yourRule: string | null;
  webEnabled: boolean;
}

/** A Discord channel as the panel sees it: the webhook URL only as a hint (bridge/src/discord.ts publicView). */
export interface DiscordChannelView { id: string; name: string; hint: string }
/** What the bridge knows of a channel's webhook and its sending (discord.ts status()). */
export interface DiscordChannelState {
  queued: number; lastOkAt: number | null; lastError: string | null; waitUntil: number;
  webhook: { name: string | null; channelId: string | null; error: string | null; at: number } | null;
}
/** GET /api/discord and the PUT's answer (server.ts). */
export interface DiscordView {
  enabled: boolean;
  routes: Record<string, string>;
  mentions: Record<string, string>;
  channels: DiscordChannelView[];
  relay: { url: string; hasSecret: boolean } | null;
  board: string | null;
  kinds: Array<{ key: string; group: string; label: string }>;
  status: { queued: number; dropped: number; relay: { lastOkAt: number | null; lastError: string | null }; channels: Record<string, DiscordChannelState> };
}

/** A feature's release level (bridge/src/svip.ts FEATURE_MODES): admin only, SVip first, everyone. */
export type FeatureMode = 'admin' | 'testing' | 'all';
/** GET /api/svip and the PUT's answer (server.ts svipView). PUT body: { players: [{ steamId, note }], features: { key: mode } }. */
export interface SvipView {
  players: Array<{ steamId: string; note: string; addedAt: number; by: string | null; name: string | null }>;
  features: Array<{ key: string; label: string; mode: FeatureMode }>;
  modes: Array<{ key: FeatureMode; label: string; note: string }>;
}
