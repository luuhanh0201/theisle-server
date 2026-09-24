import { readFile } from 'node:fs/promises';
import { config } from './config.js';

/**
 * The server "now", as StatsLogger last wrote it (Mods/StatsLogger/Saved/
 * live.json, replaced every second): each player's position, heading and
 * vitals, and the AI alive around them (rescanned every 2 s). The snapshot
 * stream (5 s) stays the record; this is what the live map and the player
 * portal show, so they lag the game by about a second instead of up to 8.
 *
 * AI: Evrima spawns it around players and despawns it, so this live list is
 * the only true source — never a static list of spots.
 */
export interface LivePlayer {
  steamId: string;
  loc: { x: number; y: number; z?: number };
  yaw: number | null;
  vitals: Record<'health' | 'stamina' | 'hunger' | 'thirst' | 'oxygen' | 'blood', number | null>;
  growth: number | null;
}

export interface LiveAi {
  t: number;
  /** AI pawns seen alive (list may be capped; count is not). */
  count: number;
  /** Pawns at 0 health (corpses), counted, not listed. */
  dead: number;
  /** The game's own counter (TIGameStateBase.AIAlive), as a cross-check. */
  aiAlive: number | null;
  list: Array<{ c: string; x: number; y: number; z: number | null; hp: number | null }>;
  stale: boolean;
}

export interface Live {
  /** Unix seconds of the read. */
  t: number;
  /** Older than STALE_AFTER_S: the mod stopped writing (server down, mod off). */
  stale: boolean;
  players: LivePlayer[];
  ai: LiveAi | null;
}

const STALE_AFTER_S = 15;
const AI_STALE_AFTER_S = 30;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** Lua's JSON writer cannot tell an empty array from an empty object: "none" can be {}. */
function listOf(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (typeof v === 'object' && v !== null && Object.keys(v).length === 0) return [];
  return null;
}
const obj = (v: unknown): Record<string, unknown> | null =>
  (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null);

function parseAi(raw: unknown, nowS: number): LiveAi | null {
  const r = obj(raw);
  if (r === null) return null;
  const t = num(r['t']);
  const items = listOf(r['list']);
  if (t === null || items === null) return null;
  const list: LiveAi['list'] = [];
  for (const e of items) {
    const o = obj(e);
    if (o === null) continue;
    const x = num(o['x']); const y = num(o['y']);
    if (x === null || y === null || typeof o['c'] !== 'string') continue;
    list.push({ c: o['c'].slice(0, 120), x, y, z: num(o['z']), hp: num(o['hp']) });
  }
  return {
    t, count: num(r['count']) ?? list.length, dead: num(r['dead']) ?? 0, aiAlive: num(r['aiAlive']),
    list, stale: nowS - t > AI_STALE_AFTER_S,
  };
}

/** Only well-formed entries leave the bridge; the file is written by a mod, not trusted blindly. */
export function parseLive(text: string, nowS: number): Live | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = obj(raw);
  if (r === null) return null;
  const t = num(r['t']);
  const items = listOf(r['players']);
  if (t === null || items === null) return null;
  const players: LivePlayer[] = [];
  for (const e of items) {
    const o = obj(e);
    if (o === null || typeof o['id'] !== 'string' || !/^\d{17}$/.test(o['id'])) continue;
    const x = num(o['x']); const y = num(o['y']);
    if (x === null || y === null) continue;
    const z = num(o['z']);
    players.push({
      steamId: o['id'],
      loc: z === null ? { x, y } : { x, y, z },
      yaw: num(o['yaw']),
      vitals: {
        health: num(o['health']), stamina: num(o['stamina']), hunger: num(o['hunger']),
        thirst: num(o['thirst']), oxygen: num(o['oxygen']), blood: num(o['blood']),
      },
      growth: num(o['growth']),
    });
  }
  return { t, stale: nowS - t > STALE_AFTER_S, players, ai: parseAi(r['ai'], nowS) };
}

let lastGood: Live | null = null;

/** The latest read; keeps the last good one while the mod swaps the file. */
export async function readLiveState(nowS = Math.floor(Date.now() / 1000)): Promise<Live | null> {
  try {
    const parsed = parseLive(await readFile(config.livePath, 'utf8'), nowS);
    if (parsed !== null) lastGood = parsed;
  } catch {
    // Missing for a moment while the mod replaces it, or never written yet.
  }
  if (lastGood === null) return null;
  return {
    ...lastGood,
    stale: nowS - lastGood.t > STALE_AFTER_S,
    ai: lastGood.ai && { ...lastGood.ai, stale: nowS - lastGood.ai.t > AI_STALE_AFTER_S },
  };
}

/** This player's live entry, if the live file is fresh and has them. */
export function livePlayer(live: Live | null, steamId: string): LivePlayer | null {
  if (live === null || live.stale) return null;
  return live.players.find((p) => p.steamId === steamId) ?? null;
}
