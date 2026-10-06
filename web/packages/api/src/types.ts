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

/** A feature's release level (bridge/src/svip.ts FEATURE_MODES): admin only, SVip first, everyone. */
export type FeatureMode = 'admin' | 'testing' | 'all';
/** GET /api/svip and the PUT's answer (server.ts svipView). PUT body: { players: [{ steamId, note }], features: { key: mode } }. */
export interface SvipView {
  players: Array<{ steamId: string; note: string; addedAt: number; by: string | null; name: string | null }>;
  features: Array<{ key: string; label: string; mode: FeatureMode }>;
  modes: Array<{ key: FeatureMode; label: string; note: string }>;
}
