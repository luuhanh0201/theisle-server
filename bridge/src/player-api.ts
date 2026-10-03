import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.js';
import { isSteamId, readGarageSettings, readPlayerGarage, ValidationError, type StoredDino } from './garage.js';
import { SLOT_MIN_GROWTH, queueMutationUse, queuePlayerCommand, type MutationUse, queueSkin, SKIN_CHANNEL_MAX, TooSoonError } from './commands.js';
import { type Item, type Rarity, dietRefusal, getItem, inventoryOf, isPendingUse, listItems, markPendingUse, resolveSkin, speciesKey } from './items.js';
import { keptSkinsOf, setKeptSkin } from './kept-skins.js';
import type { LifeRecord, PlayerStats, Store, TrailPoint } from './store.js';
import type { Skin } from './events.js';
import { readAiZones, readAiZonesStatus } from './ai-zones.js';
import { AI_BY_KEY } from './ai-species.js';
import { zoneOutline } from './zone-shape.js';
import { PRIME_NEEDED, primeBoard, type PrimeBoard } from './prime.js';
import { livePlayer, type Live } from './live.js';
import { isRange, joinToken, peersOf, voiceIdentity, VOICE_RANGES, type VoiceRoom } from './voice.js';
import { readVoiceSettings, shownName } from './voice-settings.js';
import type { Prison } from './prison.js';
import { adminIds } from './panel-auth.js';
import { MUTATION_REFERENCE, findReference } from './mutation-reference.js';
import { ACTIVE_SLOTS, DUPLICATE_UPGRADE, maxStacksOf, mutationPreview } from './mutation-tiers.js';

/**
 * The bag (Túi đồ on the portal: using a mutation item) is open to the server's
 * admins only for now (2026-10-02, the owner's call); false opens it to everyone.
 */
const BAG_ADMINS_ONLY = true;
/**
 * Players the bag is open to besides the admins (data/bag-access.json
 * { "players": ["7656…"] }, 2026-10-02: T-Rex Nổi Loạn). Their bag runs out
 * as a player's does; only admins' is unlimited.
 */
async function bagPlayers(): Promise<Set<string>> {
  try {
    const d = JSON.parse(await readFile(join(config.dataDir, 'bag-access.json'), 'utf8')) as { players?: unknown };
    return new Set(Array.isArray(d.players) ? d.players.filter((x): x is string => typeof x === 'string' && isSteamId(x)) : []);
  } catch {
    return new Set();
  }
}
export async function bagOpen(steamId: string): Promise<boolean> {
  return !BAG_ADMINS_ONLY || (await adminIds()).has(steamId) || (await bagPlayers()).has(steamId);
}
/** An admin's bag never runs out: a used item stays (items.ts settleUse). */
export async function bagUnlimited(steamId: string): Promise<boolean> {
  return (await adminIds()).has(steamId);
}

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
 *   GET /player-api/ai               the AI alive on the server now (species + position), fish apart
 *   GET /player-api/ai-zones         the AI zones admins drew (name, circle, AI kinds)
 *   POST /player-api/garage/<steamId>          { action: store|redeem, slot?, where? }
 *   POST /player-api/skin/<steamId>            { colors: { Body: {r,g,b}… (linear, 0–1) }, effects?, pattern?, theme?, variation?, keep? }
 *          or { item: "<itemId>" }: wear a skin item of their inventory (items.ts) on the dino of that species they play now
 *   POST /player-api/items/<steamId>/use       { uid, slot: 1–4 }: use a mutation item of their inventory on the
 *          dino they play now (that slot; the copy is used up once the game has it)
 *          keep: true keeps these colours for the species played now (every new dino of it), false forgets them;
 *          { forget: "BP_X_C" } forgets one species' kept colours
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
/** A slot's primeData ({ cond1..cond10, eligible }) → { done, eligible }, or null when it has none. */
export function primeTasksOf(raw: unknown): { done: number; eligible: boolean } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;
  let done = 0;
  for (let i = 1; i <= 10; i++) if (d[`cond${i}`] === true) done++;
  return { done, eligible: d['eligible'] === true || done >= PRIME_NEEDED };
}

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
  /** One entry per DINO (newest first): its stretches — relogs, the garage, rebirths — together (dinoRows). */
  lives: Array<{
    species: string | null; spawnedAt: number; endedAt: number | null; end: string | null;
    /** alive (played now), garage (in the garage), left (logged out on it / switched: no death seen), death, admin, rebirth. */
    status: 'alive' | 'garage' | 'left' | 'death' | 'admin' | 'rebirth';
    /** Seconds it lived, online, all its stretches added up. */
    seconds: number;
    /** When it was last seen. */
    lastAt: number;
    /** Times it was reborn (chuyển sinh) along the way. */
    rebirths: number;
    growth: number | null; kills: number; killedBy: string | null; killedBySpecies: string | null;
    /** Elder stacks (the dino's "đời": a rebirth at 100 % adds one); null when never read. */
    elderStacks: number | null;
  }>;
  garage: Array<{
    slot: string; species: string | null; growth: number | null; storedAt: number | null; gift: boolean; skin: Skin | null;
    /** Stored as a prime elder (the web garage highlights it). */
    prime: boolean;
    /** Elder stacks when stored (the dino's "đời"), which the slot's effect follows; null if the slot has none. */
    elderStacks: number | null;
    /** What the dino will come back with (as stored); max = its maxima then, null if the slot has none. */
    vitals: { health: number | null; stamina: number | null; thirst: number | null };
    max: { health: number | null; stamina: number | null; thirst: number | null };
  }>;
}

/**
 * The player's dinos, one row each (newest first). The store keeps a life per
 * stretch — every relog, garage store / redeem and rebirth starts one — and the
 * page listed those: one Rex at 100 % came out as five rows, four of them
 * "Đang sống" (stretches the player logged out of), plus the admin camera
 * ("AdminPawn"). The owner did not understand it (2026-10-03). A dino is a
 * chain (store.ts): its time added up, its state from its last stretch.
 */
export function dinoRows(lives: readonly LifeRecord[], isAdmin: (steamId: string | null) => boolean, now: number): PlayerView['lives'] {
  const byChain = new Map<number, LifeRecord[]>();
  const order: number[] = [];
  for (const l of lives) {
    if (/AdminPawn/i.test(l.species)) continue;
    const list = byChain.get(l.chain);
    if (list === undefined) { byChain.set(l.chain, [l]); order.push(l.chain); } else list.push(l);
  }
  // `lives` comes newest first: each chain's first entry is its last stretch.
  return order.map((chain) => {
    const stretches = byChain.get(chain) as LifeRecord[];
    const last = stretches[0] as LifeRecord;
    const first = stretches[stretches.length - 1] as LifeRecord;
    const seconds = stretches.reduce((sum, l) => sum + Math.max(0, (l.endedAt ?? (l.pausedAt ?? Math.max(now, l.lastAt))) - l.spawnedAt), 0);
    const status: PlayerView['lives'][number]['status'] =
      last.end === 'death' || last.end === 'admin' || last.end === 'garage' || last.end === 'rebirth' ? last.end
        : last.endedAt === null && last.pausedAt === null ? 'alive' : 'left';
    const killedHidden = isAdmin(last.killer);
    const stacks = stretches.map((l) => l.elderStacks).find((v) => v !== null) ?? null;
    return {
      species: shortSpecies(last.species), spawnedAt: first.spawnedAt, endedAt: last.endedAt, end: last.end, status,
      seconds, lastAt: last.endedAt ?? last.lastAt,
      rebirths: stretches.filter((l) => l.end === 'rebirth').length,
      growth: num(last.growth), kills: stretches.reduce((sum, l) => sum + l.countedKills, 0),
      // A killer's NAME is what the game showed the victim anyway; never their SteamID.
      // Killed by an admin: not shown on the players' side (only the panel logs it).
      killedBy: status === 'death' && !killedHidden ? last.killerName : null,
      killedBySpecies: status === 'death' && !killedHidden ? shortSpecies(last.killerSpecies) : null,
      elderStacks: num(stacks),
    };
  });
}

export function playerView(
  steamId: string, p: PlayerStats | null, lives: LifeRecord[], garage: StoredDino[], live: Live | null = null,
  trail: readonly TrailPoint[] = [], isAdmin: (steamId: string | null) => boolean = () => false,
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
      // As the players' boards count them (store.ts): no kill or death with an admin, small prey of a grown killer not.
      kills: p?.countedKills ?? 0, deaths: p?.countedDeaths ?? 0, spawns: p?.spawns ?? 0,
      playtime: p?.playtime ?? 0, longestLife: p?.longestLife ?? 0, sessions: p?.sessions ?? 0,
    },
    lives: dinoRows(lives, isAdmin, Math.floor(Date.now() / 1000)).slice(0, 20),
    garage: garage.map((g) => ({
      slot: g.slot,
      species: shortSpecies(g.meta.classPath ?? g.state?.['classPath']),
      growth: num(g.meta.growth ?? g.state?.['growth']),
      storedAt: num(g.meta.capturedAt ?? g.state?.['capturedAt']),
      gift: g.state?.['createdBy'] === 'admin',
      skin: cleanSkin(g.state?.['skin']),
      prime: g.state?.['prime'] === true || g.state?.['isPrime'] === true,
      // The "đời" it was stored at (capture.lua GetElderReplicationStacks / an admin's elderStacks).
      elderStacks: num(g.state?.['elderStacks']),
      // The prime tasks it had (capture.lua primeData / an admin's primeConditions): done of 10, eligible.
      primeTasks: primeTasksOf(g.state?.['primeData']),
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

type UseCtx = { store: Store; prison?: Prison };
type Answer = { status: number; body: Record<string, unknown> };
/** The items used on the dino a player plays now (a skin is worn instead: /player-api/skin). */
type DinoItem = Extract<Item, { type: 'mutation' | 'mutation_ticket' | 'mutation_clear' | 'prime_ticket' }>;
const isDinoItem = (i: Item): i is DinoItem => i.type !== 'skin';
const pct = (g: number): string => `${Math.round(g * 100)}%`;

/** The checks before a copy is used or previewed: theirs, usable on a dino, not in prison, in game with a dino (a mutation: its diet). */
async function dinoItemCopy(ctx: UseCtx, who: string, uid: string): Promise<Answer | { item: DinoItem; p: PlayerStats }> {
  const owned = (await inventoryOf(who)).find((o) => o.uid === uid);
  if (!owned) return { status: 403, body: { error: 'Bạn không có vật phẩm này.' } };
  const item = await getItem(owned.itemId);
  if (item === null || !isDinoItem(item)) return { status: 400, body: { error: 'Vật phẩm này không dùng lên dino được.' } };
  if (ctx.prison?.isInmate(who)) return { status: 400, body: { error: 'Bạn đang ở tù: không dùng được vật phẩm.' } };
  const p = ctx.store.player(who)?.player;
  if (!p?.online || !p.species) return { status: 409, body: { error: 'Vào game và điều khiển một con dino để dùng.' } };
  if (item.type === 'mutation') {
    const refused = dietRefusal(p.species, item.data.diet);
    if (refused) return { status: 409, body: { error: `Không dùng được cho ${shortSpecies(p.species)}: ${refused}.` } };
  }
  return { item, p };
}

/**
 * What a Phiếu đổi mutation may become on this species: every mutation still
 * in the game (mutation-reference.ts) of a diet the species takes; a special
 * ticket, the quest mutations too (2026-10-02: the Mutation page keeps only
 * the special ones, a ticket replaces the others).
 */
async function ticketPool(maxRarity: Rarity, species: string): Promise<Array<{ name: string; diet: string; slot2: boolean; unlock: boolean; rarity: Rarity; description: string | null }>> {
  const quest = maxRarity === 'special';
  return MUTATION_REFERENCE
    .filter((m) => m.status !== 'removed' && (quest || m.kind !== 'unlock') && dietRefusal(species, m.diet) === null)
    .map((m) => ({ name: m.name, diet: m.diet, slot2: m.kind === 'slot2', unlock: m.kind === 'unlock', rarity: (m.kind === 'unlock' ? 'special' : 'common') as Rarity,
      description: m.description }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

/** Why `name` may not go in `slot` of this dino now, or null (the game's rules: growth per slot, slot-2 kinds, not twice). */
function placeRefusal(p: PlayerStats, name: string, slot: unknown, slot2: boolean): string | null {
  if (slot !== 1 && slot !== 2 && slot !== 3 && slot !== 4) return 'Chọn ô mutation 1–4.';
  if (slot2 && slot !== 2 && slot !== 4) return `${name} chỉ đặt được ở ô 2 hoặc 4.`;
  const min = SLOT_MIN_GROWTH[slot];
  if (typeof p.growth !== 'number' || p.growth + 1e-6 < min) {
    return `Ô ${slot} mở từ ${pct(min)} tăng trưởng (dino đang ${typeof p.growth === 'number' ? pct(p.growth) : '?'}), như trong game.`;
  }
  const active = mutationPreview(name, p.mutations, null).has.find((k) => (ACTIVE_SLOTS as readonly string[]).includes(k));
  if (active) return `Dino đã có ${name} ở ô ${active.slice(-1)} — dùng thêm không mạnh hơn. Vật phẩm vẫn còn.`;
  return null;
}

/**
 * What using a copy would do on the dino they play now (the bag's box): each
 * slot's mutation, its value, whether the slot is open at this growth; a
 * mutation: it against the slot's; a ticket: what it may become. From what the
 * game reported last; the mod checks again.
 */
export async function previewMutationUse(ctx: UseCtx, who: string, uid: string): Promise<Answer> {
  const got = await dinoItemCopy(ctx, who, uid);
  if ('status' in got) return got;
  const { item, p } = got;
  const stacks = p.prime?.elderStacks ?? null;
  const base = mutationPreview(item.type === 'mutation' ? item.data.mutation : '', p.mutations, stacks);
  const slots = base.slots.map((x) => {
    const min = SLOT_MIN_GROWTH[x.slot as 1 | 2 | 3 | 4];
    return { ...x, minGrowth: min, open: typeof p.growth === 'number' && p.growth + 1e-6 >= min };
  });
  return { status: 200, body: {
    type: item.type, species: shortSpecies(p.species), growth: p.growth, prime: p.prime?.prime ?? null,
    ...base, slots,
    ...(item.type === 'mutation' ? { slot2: item.data.slot2 } : {}),
    ...(item.type === 'mutation_ticket' ? { pool: await ticketPool(item.data.maxRarity, p.species as string) } : {}),
  } };
}

/**
 * Use one copy (by its uid) of a player's inventory on the dino they play now:
 *   mutation          into `slot` (1–4)
 *   mutation_ticket   `pick` (one of its pool) into `slot`
 *   mutation_clear    `slot` emptied
 *   prime_ticket      a grown dino made prime
 * (`upgrade`: the switched-off duplicate +1 đời, mutation-tiers.ts.) The
 * player's own POST /player-api/items/…/use, and the panel's "Dùng lên dino"
 * (server.ts): the same checks for both. 202 { id }: queued; the copy goes
 * when the mod says it worked (items.ts settleUse).
 */
export async function startMutationUse(ctx: UseCtx, who: string, uid: string, slot: unknown, upgrade = false, pick: unknown = null): Promise<Answer> {
  const got = await dinoItemCopy(ctx, who, uid);
  if ('status' in got) return got;
  const { item, p } = got;
  if (isPendingUse(who, uid)) return { status: 409, body: { error: 'Vật phẩm này đang được dùng, chờ vài giây.' } };
  let use: MutationUse;
  if (item.type === 'prime_ticket') {
    if (p.prime?.prime === true) return { status: 409, body: { error: 'Dino này đã là prime.' } };
    if (typeof p.growth !== 'number' || p.growth < 0.999) return { status: 409, body: { error: `Phiếu Prime cần dino 100% (đang ${typeof p.growth === 'number' ? pct(p.growth) : '?'}).` } };
    use = { mode: 'prime' };
  } else if (item.type === 'mutation_clear') {
    if (slot !== 1 && slot !== 2 && slot !== 3 && slot !== 4) return { status: 400, body: { error: 'Chọn ô mutation 1–4.' } };
    if (!p.mutations?.[`Slot${slot}`]) return { status: 409, body: { error: `Ô ${slot} đang trống.` } };
    use = { mode: 'clear', slot };
  } else if (item.type === 'mutation_ticket') {
    const pool = await ticketPool(item.data.maxRarity, p.species as string);
    const chosen = typeof pick === 'string' ? pool.find((m) => m.name === pick) : undefined;
    if (!chosen) return { status: 400, body: { error: 'Chọn một mutation trong danh sách của phiếu.' } };
    const why = placeRefusal(p, chosen.name, slot, chosen.slot2);
    if (why) return { status: why.startsWith('Chọn') || why.includes('chỉ đặt') ? 400 : 409, body: { error: why } };
    use = { mode: 'place', mutation: chosen.name, slot: slot as 1 | 2 | 3 | 4, unlock: chosen.unlock, minGrowth: SLOT_MIN_GROWTH[slot as 1 | 2 | 3 | 4] };
  } else if (upgrade) {
    if (!DUPLICATE_UPGRADE) return { status: 409, body: { error: 'Nâng cấp mutation trùng đang tạm tắt (đang thử nghiệm). Vật phẩm vẫn còn.' } };
    const preview = mutationPreview(item.data.mutation, p.mutations, p.prime?.elderStacks ?? null);
    if (preview.upgrade === null) return { status: 409, body: { error: `Dino chưa có ${item.data.mutation}: chọn ô để thêm.` } };
    if (!preview.upgrade.ok || preview.stacks === null) return { status: 409, body: { error: preview.upgrade.why ?? 'Không nâng cấp được.' } };
    use = { mode: 'upgrade', mutation: item.data.mutation, fromStacks: preview.stacks, maxStacks: maxStacksOf(item.data.mutation) };
  } else {
    const why = placeRefusal(p, item.data.mutation, slot, item.data.slot2);
    if (why) return { status: why.startsWith('Chọn') || why.includes('chỉ đặt') ? 400 : 409, body: { error: why } };
    use = { mode: 'place', mutation: item.data.mutation, slot: slot as 1 | 2 | 3 | 4, unlock: item.data.unlock, minGrowth: SLOT_MIN_GROWTH[slot as 1 | 2 | 3 | 4] };
  }
  try {
    const cmd = await queueMutationUse(who, use);
    markPendingUse(cmd.id, who, uid);
    return { status: 202, body: { id: cmd.id, action: cmd.type, expiresAt: cmd.expiresAt } };
  } catch (err) {
    if (err instanceof ValidationError) return { status: 400, body: { error: err.message } };
    throw err;
  }
}

/** Returns false when the path is not a /player-api route (the caller carries on). */
export async function handlePlayerApi(
  req: IncomingMessage, res: ServerResponse, path: string,
  ctx: {
    store: Store; serverPhase: () => Promise<string>; live?: () => Promise<Live | null>;
    serverInfo?: () => Promise<PublicServerInfo>;
    voice?: VoiceRoom;
    prison?: Prison;
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
    // In prison: no garage (storing the dino would be a way out).
    if (ctx.prison?.isInmate(garageCmd[1] as string)) { send(res, 400, { error: 'Bạn đang ở tù: không dùng được gara.' }); return true; }
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
  const previewCmd = /^\/player-api\/items\/(\d{17})\/preview\/([\w-]{1,40})$/.exec(path);
  if (previewCmd !== null) {
    if (req.method !== 'GET') { send(res, 405, { error: 'method not allowed' }); return true; }
    if (!(await bagOpen(previewCmd[1] as string))) { send(res, 403, { error: 'Túi đồ chưa mở.' }); return true; }
    const r = await previewMutationUse(ctx, previewCmd[1] as string, previewCmd[2] as string);
    send(res, r.status, r.body);
    return true;
  }
  const useCmd = /^\/player-api\/items\/(\d{17})\/use$/.exec(path);
  if (useCmd !== null) {
    if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return true; }
    const body = await readSmallJson(req);
    if (body === null) { send(res, 400, { error: 'expected a small JSON object' }); return true; }
    if (!(await bagOpen(useCmd[1] as string))) { send(res, 403, { error: 'Túi đồ chưa mở.' }); return true; }
    const r = await startMutationUse(ctx, useCmd[1] as string, typeof body['uid'] === 'string' ? body['uid'] : '', body['slot'], body['upgrade'] === true, body['mutation'] ?? null);
    send(res, r.status, r.body);
    return true;
  }
  const skinCmd = /^\/player-api\/skin\/(\d{17})$/.exec(path);
  if (skinCmd !== null) {
    if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return true; }
    const body = await readSmallJson(req);
    if (body === null) { send(res, 400, { error: 'expected a small JSON object' }); return true; }
    const who = skinCmd[1] as string;
    // Forget the colours kept for one species (no game command).
    if (typeof body['forget'] === 'string') {
      await setKeptSkin(who, body['forget'], null);
      send(res, 200, { forgotten: body['forget'] });
      return true;
    }
    // A skin item of their own inventory, made by an admin (may be brighter / darker than a player can pick).
    if (typeof body['item'] === 'string') {
      try {
        const itemId = body['item'];
        if (!(await inventoryOf(who)).some((o) => o.itemId === itemId)) { send(res, 403, { error: 'Bạn chưa có skin này.' }); return true; }
        const item = await getItem(itemId);
        if (item === null || item.type !== 'skin') { send(res, 404, { error: 'Skin không còn tồn tại.' }); return true; }
        const playing = ctx.store.player(who)?.player.species ?? null;
        if (speciesKey(playing) !== speciesKey(item.data.species)) {
          send(res, 409, { error: `Skin này dành cho ${item.data.species} — hãy chơi ${item.data.species} rồi mặc.` });
          return true;
        }
        const cmd = await queueSkin(who, resolveSkin(item.data), Date.now(), SKIN_CHANNEL_MAX);
        send(res, 202, { id: cmd.id, action: cmd.type, expiresAt: cmd.expiresAt, item: itemId });
      } catch (err) {
        if (err instanceof TooSoonError) send(res, 429, { error: 'too many requests' });
        else if (err instanceof ValidationError) send(res, 400, { error: err.message });
        else throw err;
      }
      return true;
    }
    try {
      const cmd = await queueSkin(who, body);
      // "Giữ màu cho lần chơi sau": for the species played now (keep: false = no longer).
      const species = ctx.store.player(who)?.player.species ?? null;
      let kept: string | null = null;
      if (species !== null && cmd.type === 'skin' && typeof body['keep'] === 'boolean') {
        await setKeptSkin(who, species, body['keep'] ? cmd.skin : null);
        if (body['keep']) kept = species;
      }
      send(res, 202, { id: cmd.id, action: cmd.type, expiresAt: cmd.expiresAt, kept });
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
      ...playerView(steamId, detail?.player ?? null, detail?.lives ?? [], await readPlayerGarage(steamId), live, trail,
        (id) => ctx.store.isAdmin(id)),
      // The garage rules the web garage shows (and the mod enforces).
      garageRules: { maxSlots: gs.maxSlots, redeemAt: gs.redeemAt, storeCountdown: gs.storeCountdown, cooldown: gs.cooldown,
        minHealthPct: gs.minHealthPct, minGrowthPct: gs.minGrowthPct },
      // Colours kept for the next times, by species (kept-skins.ts).
      keptSkins: await keptSkinsOf(steamId),
      // Their items (items.ts): what each is; a skin with the colours the game gets when they wear it.
      items: await ownedView(steamId, detail?.player.online ? detail.player.species ?? null : null),
      bag: await bagOpen(steamId),
      bagUnlimited: await bagUnlimited(steamId),
      // Serving a prison sentence (prison.ts), or null.
      prison: ctx.prison?.playerView(steamId) ?? null,
    });
    return true;
  }
  if (path === '/player-api/leaderboard') {
    // The players' view: admins on no board; kills as counted (store.ts killCounts).
    const lb = ctx.store.leaderboard('players');
    send(res, 200, {
      kills: rank(lb.kills, (p) => p.countedKills),
      playtime: rank(lb.playtime, (p) => p.playtime),
      longestLife: rank(lb.longestLife, (p) => p.longestLife),
      // Who brought escaped inmates down (prison.ts).
      hunters: (ctx.prison?.hunters(20) ?? []).map((h) => ({ name: h.name, value: h.count })),
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
        ...(z.prison ? { prison: true } : {}),
      })),
    });
    return true;
  }
  if (path === '/player-api/ai') {
    // The server owner chose to show players every live AI (2026-09-24). AI
    // spawns around players, so clusters hint where others are — say so if asked.
    const ai = (ctx.live ? await ctx.live() : null)?.ai ?? null;
    send(res, 200, ai === null ? { t: null, stale: true, count: 0, list: [], escapees: (ctx.prison?.escapees() ?? []).map((e) => ({ name: e.name, s: e.species, x: e.x, y: e.y, since: e.since })) } : {
      t: ai.t, stale: ai.stale, count: ai.count, aiAlive: ai.aiAlive,
      list: ai.stale ? [] : ai.list.filter((a) => !a.f).map((a) => ({ s: shortSpecies(a.c), x: a.x, y: a.y })),
      // The game's ambient fish, apart (the map draws them as their own layer).
      // Shown on the owner's request (2026-09-27), knowing they spawn only
      // around a player in the water: fish on a lake hint that someone is there.
      fish: ai.stale ? [] : ai.list.filter((a) => a.f).map((a) => ({ s: shortSpecies(a.c), x: a.x, y: a.y })),
      // Escaped inmates, for every player to hunt (prison.ts): where the Prison mod last saw them.
      escapees: (ctx.prison?.escapees() ?? []).map((e) => ({ name: e.name, s: e.species, x: e.x, y: e.y, since: e.since })),
    });
    return true;
  }
  send(res, 404, { error: 'not found' });
  return true;
}

/**
 * A player's items for the portal: what each is, how they got it; a skin, the
 * colours it paints and its species; a mutation, what it does and, when they
 * play a dino now, why that dino cannot take it (null: it can).
 */
async function ownedView(steamId: string, playing: string | null): Promise<unknown[]> {
  const owned = await inventoryOf(steamId);
  if (owned.length === 0) return [];
  const byId = new Map((await listItems()).map((i) => [i.id, i]));
  return owned.flatMap((o) => {
    const i = byId.get(o.itemId);
    if (i === undefined) return [];
    return [{ uid: o.uid, id: i.id, type: i.type, name: i.name, rarity: i.rarity, source: o.source, grantedAt: o.grantedAt,
      ...(i.type === 'skin' ? { species: i.data.species, skin: resolveSkin(i.data) }
        : i.type === 'mutation' ? { mutation: i.data.mutation, diet: i.data.diet, slot2: i.data.slot2, description: findReference(i.data.mutation)?.description ?? null,
          refusal: playing === null ? null : dietRefusal(playing, i.data.diet) }
          : i.type === 'mutation_ticket' ? { maxRarity: i.data.maxRarity } : {}) }];
  });
}
