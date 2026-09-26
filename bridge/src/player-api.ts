import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.js';
import { isSteamId, readGarageSettings, readPlayerGarage, ValidationError, type StoredDino } from './garage.js';
import { queuePlayerCommand, TooSoonError } from './commands.js';
import type { LifeRecord, PlayerStats, Store, TrailPoint } from './store.js';
import type { Skin } from './events.js';
import { readAiZones, readAiZonesStatus } from './ai-zones.js';
import { AI_BY_KEY } from './ai-species.js';
import { zoneOutline } from './zone-shape.js';
import { primeBoard, type PrimeBoard } from './prime.js';
import { livePlayer, type Live } from './live.js';
import { isRange, joinToken, peersOf, voiceIdentity, VOICE_RANGES, type VoiceRoom } from './voice.js';
import { readVoiceSettings, shownName } from './voice-settings.js';

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
 *   GET /player-api/server           online count, whether the game is up, name, slots, Discord
 *   GET /player-api/ai               the AI alive on the server now (species + position)
 *   GET /player-api/ai-zones         the AI zones admins drew (name, circle, AI kinds)
 *   POST /player-api/garage/<steamId>          { action: store|redeem, slot?, where? }
 *        — that player's own store / redeem, run by DinoGarage exactly like
 *          the chat command (commands.ts → inbox). 202 { id }.
 *   GET /player-api/command/<steamId>/<id>     its outcome once the mod ran it
 *   POST /player-api/voice/<steamId>/token     join token for the proximity voice room
 *   POST /player-api/voice/<steamId>/range     { range: 15|30|60|90 } how far their voice carries
 *   GET /player-api/voice/<steamId>            who that player can hear now: volume + pan,
 *        never a position or a SteamID (voice.ts)
 *
 * The only writes a player can make, and only for the SteamID the portal
 * logged in — the portal never takes a SteamID from the browser.
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
  garage: Array<{
    slot: string; species: string | null; growth: number | null; storedAt: number | null; gift: boolean; skin: Skin | null;
    /** Stored as a prime elder (the web garage highlights it). */
    prime: boolean;
    /** What the dino will come back with (as stored); max = its maxima then, null if the slot has none. */
    vitals: { health: number | null; stamina: number | null; thirst: number | null };
    max: { health: number | null; stamina: number | null; thirst: number | null };
  }>;
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
      prime: g.state?.['prime'] === true,
      vitals: { health: num(g.state?.['health']), stamina: num(g.state?.['stamina']), thirst: num(g.state?.['thirst']) },
      max: { health: num(g.state?.['maxHealth']), stamina: num(g.state?.['maxStamina']), thirst: num(g.state?.['maxThirst']) },
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

/** A JSON object body of at most 2 KB, or null. */
async function readSmallJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2048) return null;
    chunks.push(chunk as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** A Discord invite as a clickable https link, or null (the game's placeholder, junk, other sites). */
export function discordLink(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^(?:https?:\/\/)?(?:www\.)?(discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]{2,64})\/?$/.exec(raw.trim());
  return m ? `https://${m[1]}/${m[2]}` : null;
}

export interface PublicServerInfo { name: string | null; maxPlayers: number | null; discord: string | null }

/** What the portal's home page shows about the server, from the live Game.ini. */
export function publicServerInfo(effective: Record<string, unknown>): PublicServerInfo {
  const name = typeof effective['ServerName'] === 'string' ? effective['ServerName'].trim().slice(0, 100) : '';
  const max = num(effective['MaxPlayerCount']);
  return { name: name || null, maxPlayers: max !== null && max > 0 ? max : null, discord: discordLink(effective['Discord']) };
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
  ctx: {
    store: Store; serverPhase: () => Promise<string>; live?: () => Promise<Live | null>;
    serverInfo?: () => Promise<PublicServerInfo>;
    voice?: VoiceRoom;
  },
): Promise<boolean> {
  if (!path.startsWith('/player-api/')) return false;
  // No token configured = the portal is not set up: the routes do not exist.
  if (config.portalToken === null) { send(res, 404, { error: 'not found' }); return true; }
  if (!tokenOk(req)) { send(res, 403, { error: 'forbidden' }); return true; }
  const voice = /^\/player-api\/voice\/(\d{17})(?:\/(token|range))?$/.exec(path);
  if (voice !== null) {
    const cfg = config.voice;
    const room = ctx.voice;
    if (cfg === null || room === undefined) { send(res, 404, { error: 'voice is not set up' }); return true; }
    const steamId = voice[1] as string;
    if (voice[2] !== undefined && req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return true; }
    const { nameMode } = await readVoiceSettings();
    const nameOf = (id: string): string | null =>
      shownName(nameMode, ctx.store.player(id)?.player.name ?? null, voiceIdentity(id, cfg.apiSecret));
    if (voice[2] === 'token') {
      // The name other clients see inside the room follows the same rule.
      const name = nameOf(steamId) ?? '';
      send(res, 200, {
        url: cfg.publicUrl, room: cfg.room, identity: voiceIdentity(steamId, cfg.apiSecret),
        token: joinToken(cfg, steamId, name, Math.floor(Date.now() / 1000)),
        ranges: VOICE_RANGES, range: room.rangeOf(steamId),
      });
      return true;
    }
    if (voice[2] === 'range') {
      const body = await readSmallJson(req);
      if (body === null || !isRange(body['range'])) {
        send(res, 400, { error: `range must be one of ${VOICE_RANGES.join(', ')}` });
        return true;
      }
      room.setRange(steamId, body['range']);
      send(res, 200, { range: room.rangeOf(steamId) });
      return true;
    }
    if (req.method !== 'GET') { send(res, 405, { error: 'method not allowed' }); return true; }
    const live = ctx.live ? await ctx.live() : null;
    const players = live === null || live.stale ? [] : live.players;
    const view = peersOf(steamId, players, await room.members(), cfg, nameOf, (id) => room.rangeOf(id));
    send(res, 200, { t: live?.t ?? null, nameMode, ...view });
    return true;
  }
  const garageCmd = /^\/player-api\/garage\/(\d{17})$/.exec(path);
  if (garageCmd !== null) {
    if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return true; }
    const body = await readSmallJson(req);
    if (body === null) { send(res, 400, { error: 'expected a small JSON object' }); return true; }
    try {
      const cmd = await queuePlayerCommand(garageCmd[1] as string, body['action'], { slot: body['slot'], where: body['where'] });
      send(res, 202, { id: cmd.id, action: cmd.type, expiresAt: cmd.expiresAt });
    } catch (err) {
      if (err instanceof TooSoonError) send(res, 429, { error: 'too many requests' });
      else if (err instanceof ValidationError) send(res, 400, { error: err.message });
      else throw err;
    }
    return true;
  }
  if (req.method !== 'GET') { send(res, 405, { error: 'method not allowed' }); return true; }

  const cmdResult = /^\/player-api\/command\/(\d{17})\/(\d{1,12})$/.exec(path);
  if (cmdResult !== null) {
    const steamId = cmdResult[1] as string;
    const id = Number(cmdResult[2]);
    const r = ctx.store.commandResult(steamId, id);
    // A store has a second outcome, when its countdown ends.
    const fin = r?.action === 'store' ? ctx.store.storeResult(steamId, id) : null;
    send(res, 200, r === null ? { status: 'pending' } : {
      status: 'done', action: r.action, ok: r.ok,
      messages: Array.isArray(r.messages) ? r.messages.filter((m) => typeof m === 'string').slice(0, 10) : [],
      error: r.error ?? null,
      final: fin === null ? null : { ok: fin.ok, reason: fin.reason ?? null },
    });
    return true;
  }

  const me = /^\/player-api\/me\/(\d{17})$/.exec(path);
  if (me !== null) {
    const steamId = me[1] as string;
    if (!isSteamId(steamId)) { send(res, 400, { error: 'bad SteamID' }); return true; }
    const detail = ctx.store.player(steamId);
    const live = ctx.live ? await ctx.live() : null;
    const trail = ctx.store.map().find((m) => m.steamId === steamId)?.trail ?? [];
    const gs = await readGarageSettings();
    send(res, 200, {
      ...playerView(steamId, detail?.player ?? null, detail?.lives ?? [], await readPlayerGarage(steamId), live, trail),
      // The garage rules the web garage shows (and the mod enforces).
      garageRules: { maxSlots: gs.maxSlots, redeemAt: gs.redeemAt, storeCountdown: gs.storeCountdown, cooldown: gs.cooldown },
    });
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
    const info = ctx.serverInfo ? await ctx.serverInfo() : { name: null, maxPlayers: null, discord: null };
    send(res, 200, { online: ctx.store.online().length, phase: await ctx.serverPhase(), ...info });
    return true;
  }
  if (path === '/player-api/ai-zones') {
    // The AI zones admins drew, for the players' map: where, how big, which
    // AI. Only while zones are on, and only the zones that are on.
    const zones = await readAiZones();
    const status = await readAiZonesStatus();
    send(res, 200, {
      zones: !zones.enabled ? [] : zones.zones.filter((z) => z.enabled).map((z) => ({
        name: z.name, x: z.x, y: z.y, radiusM: z.radiusM,
        // Not a circle: its outline (game units), which the map draws as is.
        ...(zoneOutline(z) ? { outline: zoneOutline(z) } : {}),
        species: z.species.map((k) => AI_BY_KEY.get(k)?.label ?? k),
        count: status && !status.stale ? status.zones[z.id]?.count ?? null : null,
      })),
    });
    return true;
  }
  if (path === '/player-api/ai') {
    // The server owner chose to show players every live AI (2026-09-24). AI
    // spawns around players, so clusters hint where others are — say so if asked.
    const ai = (ctx.live ? await ctx.live() : null)?.ai ?? null;
    send(res, 200, ai === null ? { t: null, stale: true, count: 0, list: [] } : {
      t: ai.t, stale: ai.stale, count: ai.count, aiAlive: ai.aiAlive,
      // Not the fish: they spawn only around a player in the water — a dot on a lake would be a player.
      list: ai.stale ? [] : ai.list.filter((a) => !a.f).map((a) => ({ s: shortSpecies(a.c), x: a.x, y: a.y })),
    });
    return true;
  }
  send(res, 404, { error: 'not found' });
  return true;
}
