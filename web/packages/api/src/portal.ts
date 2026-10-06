/**
 * What the player site's routes send (portal/src/server.ts, which passes on the bridge's
 * /player-api/*: bridge/src/player-api.ts). Keep in step with the bridge; each page block adds the
 * fields it reads (web/PORTAL-MIGRATION.md).
 */

/** "Đang phát triển" (admins), "Ưu tiên" (SVip first), "NEW" (public < 7 days): bridge svip.ts releasesFor. */
export type ReleaseBadge = 'dev' | 'svip' | 'new' | '';
/** A feature being tried may be shown locked (bridge svip.ts `shown`). */
export type Shown<T> = (T & { locked?: string }) | null;

export interface PlayerVitals {
  health: number | null; stamina: number | null; hunger: number | null; thirst: number | null; blood: number | null; oxygen: number | null;
}

/** The dino played now (playerView `dino`), null when not in game. */
export interface PlayerDino {
  species: string | null;
  growth: number | null;
  vitals: PlayerVitals;
  max: PlayerVitals;
  skin: Record<string, unknown> | null;
  prime: Record<string, unknown> | null;
  position: { x: number; y: number; z: number | null; yaw: number | null } | null;
  trail: Array<{ x: number; y: number; t: number }>;
  elderStacks?: number | null;
}

/** A garage slot (playerView `garage`). */
export interface PlayerSlot {
  slot: string; species: string | null; growth: number | null; storedAt: number | null; gift: boolean;
  skin: Record<string, unknown> | null; prime: boolean; elderStacks: number | null;
  primeTasks: { done: number; eligible: boolean } | null;
  vitals: { health: number | null; stamina: number | null; thirst: number | null };
  max: { health: number | null; stamina: number | null; thirst: number | null };
}

/** The daily check-in (bridge economy.ts checkinStatus). */
export interface Checkin {
  claimed: boolean; day: number; rewards: number[]; bonusItem: string | null; minutes: number; needed: number; ready: boolean;
}
/** A daily / weekly quest (bridge quests.ts QuestView). */
export interface Quest {
  id: string; label: string; kind: string; unit: string; target: number; progress: number; reward: number;
  done: boolean; claimed: boolean; period: string;
}
/** The quests of today and this week (bridge quests.ts questsOf). */
export interface Quests { daily: Quest[]; weekly: Quest | null }

/** GET /api/me: the logged-in player (401 when not logged in). */
export interface PlayerMe {
  steamId: string;
  name: string | null;
  online: boolean;
  dino: PlayerDino | null;
  stats: { kills: number; deaths: number; spawns: number; playtime: number; longestLife: number; sessions: number };
  lives: Array<Record<string, unknown>>;
  garage: PlayerSlot[];
  garageRules?: { maxSlots: number | null; redeemAt: string; storeCountdown: number; cooldown?: number; tier?: string; minHealthPct?: number; minGrowthPct?: number };
  keptSkins?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  /** The bag's menu entry: open to them, or they own something. */
  bag?: boolean;
  /** The starter gift (bridge starter.ts), while it waits on Trang chủ; locked: the text why. */
  starter?: Shown<Record<string, unknown>>;
  /** The shop's menu entry: {} open, { locked } shown locked, null none (older bridges: undefined, then by `economy`). */
  shop?: Shown<Record<string, never>>;
  svip?: boolean;
  releases?: Partial<Record<'bag' | 'shop' | 'amber' | 'quests' | 'starter' | string, ReleaseBadge>>;
  economy?: Shown<{ currency: string; balance: number; checkin: Checkin }>;
  quests?: Shown<Quests>;
  bagUnlimited?: boolean;
  prison?: Record<string, unknown> | null;
  tele?: Shown<Record<string, unknown>>;
  /** Kết bạn: how many ask them (the Map's badge). */
  friends?: Shown<{ incoming: number }>;
}

/** GET /api/server (bridge player-api.ts /player-api/server). */
export interface PortalServer {
  online: number;
  phase: string;
  name: string | null;
  maxPlayers: number | null;
  discord: string | null;
}
