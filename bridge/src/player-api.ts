import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.js';
import { isSteamId, readPlayerGarage, type StoredDino } from './garage.js';
import type { LifeRecord, PlayerStats, Store, TrailPoint } from './store.js';
import type { Skin } from './events.js';
import { primeBoard, type PrimeBoard } from './prime.js';
import { livePlayer, type Live } from './live.js';

/**
 * The player portal's view of the bridge (portal/ — the public site players
 * log into with Steam). The portal never gets the admin token: it calls only
 * these /player-api routes with its own PORTAL_TOKEN, and everything here is
 * read-only and trimmed to what a player may see about THEMSELVES — their
 * own dino's position (for their map) but nobody else's, no chat, no other
 * player's SteamID, no raw garage files.
 *
 *   GET /player-api/me/<steamId>     that player's dino, stats, lives, garage
 *   GET /player-api/leaderboard      top players by name (no SteamIDs)
 *   GET /player-api/server           online count and whether the game is up
 *
 * The portal decides which SteamID is "me" from its Steam login; this side
 * trusts the token for that, which is why the token must stay with the portal.
 */

/** BP_Carnotaurus_C or "BlueprintGeneratedClass /Game/…/BP_Carnotaurus.BP_Carnotaurus_C" → Carnotaurus. */
export function shortSpecies(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '') return null;
  const last = raw.split('.').pop() ?? raw;
  return last.replace(/^BP_/, '').replace(/_C$/, '') || null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Only numbers and known keys leave the bridge: slot files are written by the mod, not trusted blindly. */
export function cleanSkin(raw: unknown): Skin | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const colors: Skin['colors'] = {};
  if (typeof r['colors'] === 'object' && r['colors'] !== null) {
    for (const [region, c] of Object.entries(r['colors'] as Record<string, unknown>)) {
      if (!/^[A-Za-z0-9_]{1,40}$/.test(region) || typeof c !== 'object' || c === null) continue;
      const { r: cr, g: cg, b: cb } = c as Record<string, unknown>;
      const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      if (n(cr) === null || n(cg) === null || n(cb) === null) continue;
      colors[region] = { r: cr as number, g: cg as number, b: cb as number };
    }
  }
  if (Object.keys(colors).length === 0) return null;
  const out: Skin = { colors };
  if (typeof r['patternIndex'] === 'number') out.patternIndex = r['patternIndex'];
  if (typeof r['themeIndex'] === 'number') out.themeIndex = r['themeIndex'];
  if (typeof r['variation'] === 'number') out.variation = r['variation'];
  if (typeof r['female'] === 'boolean') out.female = r['female'];
  return out;
}

export interface PlayerView {
  steamId: string;
  name: string | null;
  online: boolean;
  dino: {
    species: string | null;
    growth: number | null;
    vitals: Record<'health' | 'stamina' | 'hunger' | 'thirst' | 'blood' | 'oxygen', number | null>;
    /** The game's maxima for the same vitals (bars = vitals / max). */
    max: Record<'health' | 'stamina' | 'hunger' | 'thirst' | 'blood' | 'oxygen', number | null>;
    /** Live from the game (pawn.CustomizerData): changes as soon as the player's skin does. */
    skin: Skin | null;
    prime: PrimeBoard | null;
    /** Their OWN dino's position and heading (game world units), for their map. */
    position: { x: number; y: number; z: number | null; yaw: number | null } | null;
    /** Their own recent trail (points where they moved ≥ 2 m), oldest first. */
    trail: Array<{ x: number; y: number; t: number }>;
  } | null;
  stats: { kills: number; deaths: number; spawns: number; playtime: number; longestLife: number; sessions: number };
  lives: Array<{
    species: string | null; spawnedAt: number; endedAt: number | null; end: string | null;
    growth: number | null; kills: number; killedBy: string | null; killedBySpecies: string | null;
  }>;
  garage: Array<{ slot: string; species: string | null; growth: number | null; storedAt: number | null; gift: boolean; skin: Skin | null }>;
}

export function playerView(
  steamId: string, p: PlayerStats | null, lives: LifeRecord[], garage: StoredDino[], live: Live | null = null,
  trail: readonly TrailPoint[] = [],
): PlayerView {
  // Vitals and growth from the live file (1 s) when it has this player; the
  // snapshot (5 s) otherwise. Positions are never sent to the portal.
  const lp = livePlayer(live, steamId);
  const v = (key: 'health' | 'stamina' | 'hunger' | 'thirst' | 'blood' | 'oxygen'): number | null =>
    num(lp?.vitals[key] ?? null) ?? num(p?.[key]);
  return {
    steamId,
    name: p?.name ?? null,
    online: p?.online ?? false,
    dino: p?.online && p.species ? {
      species: shortSpecies(p.species),
      growth: num(lp?.growth ?? null) ?? num(p.growth),
      vitals: {
        health: v('health'), stamina: v('stamina'), hunger: v('hunger'),
        thirst: v('thirst'), blood: v('blood'), oxygen: v('oxygen'),
      },
      max: {
        health: num(p.max?.health), stamina: num(p.max?.stamina), hunger: num(p.max?.hunger),
        thirst: num(p.max?.thirst), blood: num(p.max?.blood), oxygen: num(p.max?.oxygen),
      },
      skin: cleanSkin(p.skin),
      prime: primeBoard(p.prime, num(lp?.growth ?? null) ?? num(p.growth)),
      position: ownPosition(lp, p),
      trail: trail.slice(-180).map((pt) => ({ x: pt.x, y: pt.y, t: pt.t })),
    } : null,
    stats: {
      kills: p?.kills ?? 0, deaths: p?.deaths ?? 0, spawns: p?.spawns ?? 0,
      playtime: p?.playtime ?? 0, longestLife: p?.longestLife ?? 0, sessions: p?.sessions ?? 0,
    },
    lives: lives.slice(0, 20).map((l) => ({
      species: shortSpecies(l.species), spawnedAt: l.spawnedAt, endedAt: l.endedAt, end: l.end,
      growth: num(l.growth), kills: l.kills,
      // A killer's NAME is what the game showed the victim anyway; never their SteamID.
      killedBy: l.killerName, killedBySpecies: shortSpecies(l.killerSpecies),
    })),
    garage: garage.map((g) => ({
      slot: g.slot,
      species: shortSpecies(g.meta.classPath ?? g.state?.['classPath']),
      growth: num(g.meta.growth ?? g.state?.['growth']),
      storedAt: num(g.meta.capturedAt ?? g.state?.['capturedAt']),
      gift: g.state?.['createdBy'] === 'admin',
      skin: cleanSkin(g.state?.['skin']),
    })),
  };
}

/** The live file's position (1 s) if it has them, else the last snapshot's. */
function ownPosition(lp: ReturnType<typeof livePlayer>, p: PlayerStats): NonNullable<PlayerView['dino']>['position'] {
  const loc = lp?.loc ?? p.loc;
  if (loc === null || loc === undefined) return null;
  const x = num(loc.x); const y = num(loc.y);
  if (x === null || y === null) return null;
  return { x, y, z: num(loc.z ?? null), yaw: num(lp?.yaw ?? null) ?? num(p.yaw) };
}

type Ranked = { name: string | null; species: string | null; value: number };
const rank = (list: PlayerStats[], value: (p: PlayerStats) => number, n = 10): Ranked[] =>
  list.slice(0, n).map((p) => ({ name: p.name, species: shortSpecies(p.species), value: value(p) }));

function tokenOk(req: IncomingMessage): boolean {
  const expected = config.portalToken;
  const got = req.headers['x-portal-token'];
  if (expected === null || typeof got !== 'string') return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Returns false when the path is not a /player-api route (the caller carries on). */
export async function handlePlayerApi(
  req: IncomingMessage, res: ServerResponse, path: string,
  ctx: { store: Store; serverPhase: () => Promise<string>; live?: () => Promise<Live | null> },
): Promise<boolean> {
  if (!path.startsWith('/player-api/')) return false;
  // No token configured = the portal is not set up: the routes do not exist.
  if (config.portalToken === null) { send(res, 404, { error: 'not found' }); return true; }
  if (!tokenOk(req)) { send(res, 403, { error: 'forbidden' }); return true; }
  if (req.method !== 'GET') { send(res, 405, { error: 'method not allowed' }); return true; }

  const me = /^\/player-api\/me\/(\d{17})$/.exec(path);
  if (me !== null) {
    const steamId = me[1] as string;
    if (!isSteamId(steamId)) { send(res, 400, { error: 'bad SteamID' }); return true; }
    const detail = ctx.store.player(steamId);
    const live = ctx.live ? await ctx.live() : null;
    const trail = ctx.store.map().find((m) => m.steamId === steamId)?.trail ?? [];
    send(res, 200, playerView(steamId, detail?.player ?? null, detail?.lives ?? [], await readPlayerGarage(steamId), live, trail));
    return true;
  }
  if (path === '/player-api/leaderboard') {
    const lb = ctx.store.leaderboard();
    send(res, 200, {
      kills: rank(lb.kills, (p) => p.kills),
      playtime: rank(lb.playtime, (p) => p.playtime),
      longestLife: rank(lb.longestLife, (p) => p.longestLife),
    });
    return true;
  }
  if (path === '/player-api/server') {
    send(res, 200, { online: ctx.store.online().length, phase: await ctx.serverPhase() });
    return true;
  }
  send(res, 404, { error: 'not found' });
  return true;
}
