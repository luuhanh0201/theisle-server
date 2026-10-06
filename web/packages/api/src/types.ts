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
