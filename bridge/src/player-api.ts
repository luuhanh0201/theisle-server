import { HeatMapper } from './heatmap.js';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.js';
import { garageRuleFor, isSteamId, readGarageCatalog, readGarageSettings, readPlayerGarage, ValidationError, type StoredDino } from './garage.js';
import { claimStarter, starterOffered } from './starter.js';
import { tierOf } from './member-tier.js';
import { MAX_QTY, buy, shopView } from './shop.js';
import { lootOptions, openLootBox } from './loot.js';
import { boxOptions, dinoItemOptions, openDinoBox, speciesOptions, useDinoItem } from './dino-box.js';
import { audit } from './audit.js';
import { CURRENCY, balanceOf, checkinStatus, claimCheckin, type PlayDays } from './economy.js';
import { claimQuest, questsOf, type QuestProgress } from './quests.js';
import { claimMilestone, milestonesOf, type MilestoneWatch } from './milestones.js';
import { SLOT_MIN_GROWTH, queueMutationUse, queuePlayerCommand, type MutationUse, queueSkin, queueTele, SKIN_CHANNEL_MAX, TooSoonError } from './commands.js';
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
import { EARLY_FEATURES, LOCKED_NOTE, type FeatureAccess, type FeatureKey, type ReleaseBadge, closedError, earlyAccess, featureAccess, isSvip, readSvip, releaseBadge } from './svip.js';
import { parseTrafficEvent, type Traffic } from './traffic.js';
import { MUTATION_REFERENCE, findReference } from './mutation-reference.js';
import { codeRefusal, normaliseCode, readTeleSettings, teleCodes, teleRefusal } from './tele.js';
import { friendRef, friends, friendSpot, idOfRef, searchPlayers } from './friends.js';
import { newsForPlayers, readNews } from './news.js';
import { ACTIVE_SLOTS, DUPLICATE_UPGRADE, maxStacksOf, mutationPreview } from './mutation-tiers.js';

/**
 * The bag (Túi đồ on the portal: using a mutation item) is a feature being tried:
 * open to the admins and the SVip (svip.ts, the panel's Quản trị → SVip) until
 * it is switched to everyone there. Their bag runs out as a player's does; only admins' is unlimited.
 */
export async function bagOpen(steamId: string): Promise<boolean> {
  return earlyAccess('bag', steamId);
}
/**
 * A feature by its level (svip.ts) in what /me sends: the part as is when open, marked { locked } when
 * shown locked (SVip first), null when the admins only have it (nothing of it shows).
 */
function shown<T extends object>(access: FeatureAccess, part: T): (T & { locked?: string }) | null {
  return access === 'open' ? part : access === 'locked' ? { ...part, locked: LOCKED_NOTE } : null;
}
/** The web's mark beside each feature this player sees (one Chỉ admin hides from them: none). */
async function releasesFor(steamId: string): Promise<Partial<Record<FeatureKey, ReleaseBadge>>> {
  const s = await readSvip();
  const out: Partial<Record<FeatureKey, ReleaseBadge>> = {};
  for (const { key } of EARLY_FEATURES) {
    const b = releaseBadge(s, key);
    if (b !== null && (await featureAccess(key, steamId)) !== 'hidden') out[key] = b;
  }
  return out;
}
/** A route of a feature not open to this player: 403 with why, and true (the route is done). */
async function refused(res: ServerResponse, feature: FeatureKey, steamId: string, name: string): Promise<boolean> {
  const access = await featureAccess(feature, steamId);
  if (access === 'open') return false;
  send(res, 403, { error: closedError(name, access) });
  return true;
}
/** An admin's bag never runs out: a used item stays (items.ts settleUse). */
export async function bagUnlimited(steamId: string): Promise<boolean> {
  return (await adminIds()).has(steamId);
}

/**
 * The player portal's view of the bridge (portal/, the public site players
 * log into with Steam). The portal never gets the admin token: it calls only
 * these /player-api routes with its own PORTAL_TOKEN, and everything here is
 * read-only and trimmed to what a player may see about THEMSELVES, their
 * own dino's position (for their map) but nobody else's, no chat, no other
 * player's SteamID, no raw garage files.
 *
 *   GET /player-api/me/<steamId>     that player's dino, stats, lives, garage
 *   GET /player-api/leaderboard      top players by name (no SteamIDs)
 *   GET /player-api/server           online count, whether the game is up, name, slots, Discord
 *   GET /player-api/ai               the AI alive on the server now (species + position), fish apart
 *   GET /player-api/ai-zones         the AI zones admins drew (name, circle, AI kinds)
 *   GET /player-api/heatmap          how many players in each 500 m square, every 5 minutes (heatmap.ts)
 *   POST /player-api/garage/<steamId>          { action: store|redeem, slot?, where? }
 *   POST /player-api/skin/<steamId>            { colors: { Body: {r,g,b}… (linear, 0–1) }, effects?, pattern?, theme?, variation?, keep? }
 *          or { item: "<itemId>" }: wear a skin item of their inventory (items.ts) on the dino of that species they play now
 *   POST /player-api/items/<steamId>/use       { uid, slot: 1–4 }: use a mutation item of their inventory on the
 *          dino they play now (that slot; the copy is used up once the game has it)
 *          keep: true keeps these colours for the species played now (every new dino of it), false forgets them;
 *          { forget: "BP_X_C" } forgets one species' kept colours
 *        - that player's own store / redeem, run by DinoGarage exactly like
 *          the chat command (commands.ts → inbox). 202 { id }.
 *   GET /player-api/command/<steamId>/<id>     its outcome once the mod ran it
 *   POST /player-api/voice/<steamId>/token     join token for the proximity voice room
 *   POST /player-api/voice/<steamId>/range     { range: 15|30|60|90 } how far their voice carries
 *   GET /player-api/voice/<steamId>            who that player can hear now: volume + pan,
 *        never a position or a SteamID (voice.ts)
 *   POST /player-api/tele/<steamId>            { action: code } | { action: use, code } | { action: drop }
 *        tele con non (tele.ts): a code for others to come to them; moved next to a code's owner
 *   GET /player-api/friends/<steamId>          their friends (name, online, where now), requests in / out (friends.ts)
 *   POST /player-api/friends/<steamId>         { action: search, q } | { action: request|accept|decline|cancel|remove, ref }
 *   POST /player-api/milestones/<steamId>/claim  { milestone } a server milestone's reward, once (milestones.ts)
 *        a player is named by `ref` (a keyed hash), never by SteamID; positions only of accepted friends
 *
 * The only writes a player can make, and only for the SteamID the portal
 * logged in, the portal never takes a SteamID from the browser.
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
  /** One entry per DINO (newest first): its stretches, relogs, the garage, rebirths, together (dinoRows). */
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
 * stretch, every relog, garage store / redeem and rebirth starts one, and the
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
  if (m) return `https://${m[1]}/${m[2]}`;
  // Game.ini keeps the invite code only (gameini.ts discordCode): the game adds discord.gg/ itself.
  return /^[A-Za-z0-9-]{2,64}$/.test(raw.trim()) && raw.trim() !== 'DiscordLinkHere' ? `https://discord.gg/${raw.trim()}` : null;
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
type DinoItem = Extract<Item, { type: 'mutation' | 'mutation_ticket' | 'mutation_clear' | 'prime_ticket' | 'growth_bag' | 'food_box' | 'salt_lick' }>;
const isDinoItem = (i: Item): i is DinoItem => i.type !== 'skin' && i.type !== 'dino_box' && i.type !== 'dino';
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
  if (active) return `Dino đã có ${name} ở ô ${active.slice(-1)}, dùng thêm không mạnh hơn. Vật phẩm vẫn còn.`;
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
 *   growth_bag        +its amount on a dino below its `below` (55 % → 65 %)
 *   food_box          the food bar +its amount (food only, no nutrients)
 *   salt_lick         the sickness after vomiting cleared
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
  } else if (item.type === 'growth_bag') {
    const { amount, below } = item.data;
    if (typeof p.growth !== 'number') return { status: 409, body: { error: 'Chưa đọc được tăng trưởng của dino, thử lại sau vài giây.' } };
    if (p.growth + 1e-6 >= below) {
      return { status: 409, body: { error: below >= 1 ? 'Dino đã 100% tăng trưởng.' : `Túi tăng trưởng chỉ dùng cho dino dưới ${pct(below)} (dino đang ${pct(p.growth)}).` } };
    }
    use = { mode: 'growth', amount, below };
  } else if (item.type === 'food_box') {
    use = { mode: 'food', amount: item.data.amount };
  } else if (item.type === 'salt_lick') {
    use = { mode: 'cure' };
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

/** The codes being used, settled by what the mod said (tele.ts). */
function settleTele(store: Store, nowS: number): void {
  teleCodes.settle((by, cmdId) => {
    const started = store.commandResult(by, cmdId);
    const fin = store.teleResult(by, cmdId);
    return { started: started === null ? null : started.ok, final: fin === null ? null : { ok: fin.ok } };
  }, nowS);
}

/** What the Dino Live page shows of tele (/me). */
async function teleView(store: Store, steamId: string): Promise<Record<string, unknown>> {
  const s = await readTeleSettings();
  const nowS = Math.floor(Date.now() / 1000);
  settleTele(store, nowS);
  return { maxGrowthPct: s.maxGrowthPct, targetMaxGrowthPct: s.targetMaxGrowthPct, codeMinutes: s.codeMinutes, countdownS: s.countdownS,
    combatS: s.combatS, cooldownS: s.cooldownS, code: teleCodes.mine(steamId, nowS), cooldownLeft: teleCodes.cooldownLeft(steamId, s, nowS) };
}

/** Returns false when the path is not a /player-api route (the caller carries on). */
/** The players' heat map: one picture every 5 minutes, for everyone (made at the first ask). */
let heat: HeatMapper | null = null;

export async function handlePlayerApi(
  req: IncomingMessage, res: ServerResponse, path: string,
  ctx: {
    store: Store; serverPhase: () => Promise<string>; live?: () => Promise<Live | null>;
    serverInfo?: () => Promise<PublicServerInfo>;
    voice?: VoiceRoom;
    prison?: Prison;
    traffic?: Traffic;
    playDays?: PlayDays;
    questProgress?: QuestProgress;
    milestoneWatch?: MilestoneWatch;
  },
): Promise<boolean> {
  if (!path.startsWith('/player-api/')) return false;
  // No token configured = the portal is not set up: the routes do not exist.
  if (config.portalToken === null) { send(res, 404, { error: 'not found' }); return true; }
  if (!tokenOk(req)) { send(res, 403, { error: 'forbidden' }); return true; }
  // Site / launcher traffic the portal counted (traffic.ts → the panel's "Truy cập").
  if (path === '/player-api/track') {
    if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return true; }
    if (ctx.traffic === undefined) { send(res, 404, { error: 'not found' }); return true; }
    try {
      ctx.traffic.record(parseTrafficEvent(await readSmallJson(req)));
      send(res, 200, { ok: true });
    } catch (error) {
      send(res, error instanceof ValidationError ? 400 : 500, { error: (error as Error).message });
    }
    return true;
  }
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
  // Tele con non (tele.ts): { action: code } a code for others to come to them; { action: use, code } moved
  // next to the code's owner (DinoGarage, after its own checks); { action: drop } their code dropped.
  const teleCmd = /^\/player-api\/tele\/(\d{17})$/.exec(path);
  if (teleCmd !== null) {
    if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return true; }
    const who = teleCmd[1] as string;
    if (await refused(res, 'tele', who, 'Tele con non')) return true;
    const body = await readSmallJson(req);
    if (body === null) { send(res, 400, { error: 'expected a small JSON object' }); return true; }
    const s = await readTeleSettings();
    const nowS = Math.floor(Date.now() / 1000);
    const live = ctx.live ? await ctx.live() : null;
    try {
      if (body['action'] === 'drop') { teleCodes.drop(who); send(res, 200, { ok: true }); return true; }
      if (ctx.prison?.isInmate(who)) { send(res, 409, { error: 'Bạn đang ở tù: không tele được.' }); return true; }
      if (body['action'] === 'code') {
        const why = codeRefusal(livePlayer(live, who), s);
        if (why !== null) { send(res, 409, { error: why }); return true; }
        send(res, 200, teleCodes.issue(who, s, nowS));
        return true;
      }
      if (body['action'] !== 'use') { send(res, 400, { error: 'action must be code, use or drop' }); return true; }
      const code = normaliseCode(body['code']);
      if (code === null) { send(res, 400, { error: 'Mã gồm 6 ký tự (chữ và số).' }); return true; }
      settleTele(ctx.store, nowS);
      const { owner } = teleCodes.lookup(code, who, nowS);
      if (ctx.prison?.isInmate(owner)) { send(res, 409, { error: 'Người đưa mã đang ở tù: không tele tới được.' }); return true; }
      const wait = teleCodes.cooldownLeft(who, s, nowS);
      if (wait > 0) { send(res, 409, { error: `Tele đang hồi: chờ ${wait} giây.` }); return true; }
      const why = teleRefusal(livePlayer(live, who), livePlayer(live, owner), s,
        { me: ctx.store.player(who)?.player.species ?? null, target: ctx.store.player(owner)?.player.species ?? null });
      if (why !== null) { send(res, 409, { error: why }); return true; }
      const cmd = await queueTele(who, { target: owner, maxGrowth: s.maxGrowthPct / 100, targetMaxGrowth: s.targetMaxGrowthPct / 100,
        combatS: s.combatS, countdownS: s.countdownS, cooldownS: s.cooldownS });
      // Held for them while the mod runs it: the countdown, a poll, and some slack.
      teleCodes.reserve(code, who, cmd.id, nowS + s.countdownS + 90);
      const name = ctx.store.player(who)?.player.name ?? null;
      const ownerName = ctx.store.player(owner)?.player.name ?? null;
      await audit({ action: 'tele', ok: true, detail: `${name ?? who} nhập mã tele của ${ownerName ?? owner}` }, { steamId: who, name });
      send(res, 202, { id: cmd.id, action: cmd.type, expiresAt: cmd.expiresAt, to: ownerName, countdownS: s.countdownS });
    } catch (err) {
      if (err instanceof TooSoonError) send(res, 429, { error: 'Thao tác quá nhanh, thử lại sau vài giây.' });
      else if (err instanceof ValidationError) send(res, 409, { error: err.message });
      else throw err;
    }
    return true;
  }
  // Kết bạn (friends.ts): GET their friends (where each is now), requests in and out; POST { action:
  // search, q } | { action: request|accept|decline|cancel|remove, ref }. Nobody's SteamID goes out.
  const friendsCmd = /^\/player-api\/friends\/(\d{17})$/.exec(path);
  if (friendsCmd !== null) {
    const who = friendsCmd[1] as string;
    const access = await featureAccess('friends', who);
    if (access !== 'open') { send(res, 403, { error: closedError('Kết bạn', access) }); return true; }
    const known = ctx.store.players();
    const nameOf = (id: string): string | null => ctx.store.player(id)?.player.name ?? null;
    if (req.method === 'GET') {
      const v = await friends.view(who);
      const live = ctx.live ? await ctx.live() : null;
      const online = new Set(known.filter((p) => p.online).map((p) => p.steamId));
      send(res, 200, {
        friends: v.friends.map((f) => {
          const p = ctx.store.player(f.id)?.player ?? null;
          const spot = friendSpot(live, f.id);
          return { ref: friendRef(f.id), name: p?.name ?? null, online: online.has(f.id), species: spot ? shortSpecies(p?.species) : null, since: f.since, pos: spot };
        }).sort((a, b) => Number(b.online) - Number(a.online) || (a.name ?? '').localeCompare(b.name ?? '')),
        incoming: v.incoming.map((r) => ({ ref: friendRef(r.from), name: nameOf(r.from), at: r.at })),
        outgoing: v.outgoing.map((r) => ({ ref: friendRef(r.to), name: nameOf(r.to), at: r.at })),
        t: live?.t ?? null,
      });
      return true;
    }
    if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return true; }
    const body = await readSmallJson(req);
    if (body === null) { send(res, 400, { error: 'expected a small JSON object' }); return true; }
    try {
      const v = await friends.view(who);
      const action = typeof body['action'] === 'string' ? body['action'] : '';
      if (action === 'search') {
        const rel = (id: string): 'friend' | 'outgoing' | 'incoming' | null =>
          v.friends.some((f) => f.id === id) ? 'friend' : v.outgoing.some((r) => r.to === id) ? 'outgoing' : v.incoming.some((r) => r.from === id) ? 'incoming' : null;
        const found = searchPlayers(known.map((p) => ({ steamId: p.steamId, name: p.name, online: p.online })), body['q'], who);
        send(res, 200, { results: found.map((p) => ({ ref: friendRef(p.steamId), name: p.name ?? 'Người chơi', online: p.online, relation: rel(p.steamId) })) });
        return true;
      }
      const ids = action === 'request' ? known.map((p) => p.steamId)
        : action === 'accept' || action === 'decline' ? v.incoming.map((r) => r.from)
          : action === 'cancel' ? v.outgoing.map((r) => r.to)
            : action === 'remove' ? v.friends.map((f) => f.id) : null;
      if (ids === null) { send(res, 400, { error: 'action must be search, request, accept, decline, cancel or remove' }); return true; }
      const other = idOfRef(body['ref'], ids);
      if (other === null) { send(res, 404, { error: 'Không tìm thấy người chơi này (có thể lời mời đã hết hạn).' }); return true; }
      const name = nameOf(who);
      let out: string = action;
      if (action === 'request') out = await friends.request(who, other);
      else if (action === 'accept') await friends.accept(who, other);
      else if (action === 'decline') await friends.decline(who, other);
      else if (action === 'cancel') await friends.cancel(who, other);
      else await friends.remove(who, other);
      await audit({ action: 'friends', ok: true, detail: `${name ?? who} ${({ sent: 'mời kết bạn', accepted: 'kết bạn với', accept: 'chấp nhận kết bạn', decline: 'từ chối kết bạn', cancel: 'huỷ lời mời kết bạn', remove: 'huỷ kết bạn' } as Record<string, string>)[out] ?? out} ${nameOf(other) ?? other}` },
        { steamId: who, name });
      send(res, 200, { ok: true, result: out });
    } catch (err) {
      if (err instanceof ValidationError) send(res, 409, { error: err.message });
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
  // The dino boxes (dino-box.ts): a box opened into a dino item; the dino item used, into their garage.
  const optsRoute = /^\/player-api\/items\/(\d{17})\/(box|dino)-options\/([\w-]{1,40})$/.exec(path);
  if (optsRoute !== null) {
    if (req.method !== 'GET') { send(res, 405, { error: 'method not allowed' }); return true; }
    const [, who, kind, uid] = optsRoute as unknown as [string, string, 'box' | 'dino', string];
    try {
      const catalog = ctx.store.catalog.merge(await readGarageCatalog()).list();
      send(res, 200, kind === 'box' ? await boxOptions(who, uid, catalog) : await dinoItemOptions(who, uid, catalog));
    } catch (err) {
      if (err instanceof ValidationError) send(res, 400, { error: err.message });
      else throw err;
    }
    return true;
  }
  const boxRoute = /^\/player-api\/items\/(\d{17})\/(open|dino)$/.exec(path);
  if (boxRoute !== null) {
    if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return true; }
    const who = boxRoute[1] as string;
    const body = await readSmallJson(req);
    if (body === null) { send(res, 400, { error: 'expected a small JSON object' }); return true; }
    if (await refused(res, 'starter', who, 'Hộp dino')) return true;
    const uid = typeof body['uid'] === 'string' ? body['uid'] : '';
    const name = ctx.store.player(who)?.player.name ?? null;
    try {
      const catalog = ctx.store.catalog.merge(await readGarageCatalog()).list();
      if (boxRoute[2] === 'open') {
        const out = await openDinoBox(who, uid, body, catalog, Math.random, await bagUnlimited(who));
        await audit({ action: 'dino box open', ok: true,
          detail: `${name ?? who} mở hộp dino: ${out.label} ${Math.round(out.growth * 100)}% (${out.drawn ? 'loài ngẫu nhiên' : 'tự chọn loài'}) vào túi đồ` }, { steamId: who, name });
        send(res, 200, out);
      } else {
        const out = await useDinoItem(who, uid, body, catalog);
        await audit({ action: 'dino item use', ok: true,
          detail: `${name ?? who} nhận ${out.species} ${Math.round(out.growth * 100)}% ${out.female ? 'cái' : 'đực'} vào gara slot ${out.slot} (vật phẩm dino; prime đủ nhiệm vụ; mutation ${Object.values(out.mutations).join(', ') || 'không'})` },
        { steamId: who, name });
        send(res, 200, out);
      }
    } catch (err) {
      if (err instanceof ValidationError) send(res, 400, { error: err.message });
      else throw err;
    }
    return true;
  }
  // A hòm (loot.ts): its prizes and their chances; opened, one drawn into the bag.
  const lootRoute = /^\/player-api\/items\/(\d{17})\/loot(?:-options\/([\w-]{1,40}))?$/.exec(path);
  if (lootRoute !== null) {
    const who = lootRoute[1] as string;
    try {
      if (lootRoute[2] !== undefined) {
        if (req.method !== 'GET') { send(res, 405, { error: 'method not allowed' }); return true; }
        send(res, 200, await lootOptions(who, lootRoute[2]));
        return true;
      }
      if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return true; }
      if (await refused(res, 'bag', who, 'Túi đồ')) return true;
      const body = await readSmallJson(req);
      if (body === null) { send(res, 400, { error: 'expected a small JSON object' }); return true; }
      const out = await openLootBox(who, typeof body['uid'] === 'string' ? body['uid'] : '', await bagUnlimited(who));
      const name = ctx.store.player(who)?.player.name ?? null;
      await audit({ action: 'loot box open', ok: true,
        detail: `${name ?? who} mở ${out.box}: ${out.won.qty} × ${out.won.name} (tỉ lệ ${(out.chance * 100).toFixed(1)}%)` }, { steamId: who, name });
      // The prize only: never its chance (loot.ts).
      send(res, 200, { won: out.won, box: out.box });
    } catch (err) {
      if (err instanceof ValidationError) send(res, 400, { error: err.message });
      else throw err;
    }
    return true;
  }
  // The Hổ phách shop (shop.ts): what is on sale for them; a buy.
  const shopRoute = /^\/player-api\/shop\/(\d{17})(\/buy)?$/.exec(path);
  if (shopRoute !== null) {
    const who = shopRoute[1] as string;
    const access = await featureAccess('shop', who);
    if (shopRoute[2] === undefined) {
      if (req.method !== 'GET') { send(res, 405, { error: 'method not allowed' }); return true; }
      // Admins only (being made): nothing of it for anyone else.
      if (access === 'hidden') { send(res, 403, { error: closedError('Cửa hàng', access) }); return true; }
      send(res, 200, { currency: CURRENCY, balance: await balanceOf(who), maxQty: MAX_QTY, listings: await shopView(who),
        ...(access === 'open' ? {} : { locked: LOCKED_NOTE }) });
      return true;
    }
    if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return true; }
    if (access !== 'open') { send(res, 403, { error: closedError('Cửa hàng', access) }); return true; }
    const body = await readSmallJson(req);
    if (body === null) { send(res, 400, { error: 'expected a small JSON object' }); return true; }
    try {
      const out = await buy(who, body['listing'], body['qty']);
      const name = ctx.store.player(who)?.player.name ?? null;
      await audit({ action: 'shop buy', ok: true, detail: `${name ?? who} mua ${out.qty} × ${out.item}: ${out.spent} ${CURRENCY}, còn ${out.balance}` }, { steamId: who, name });
      send(res, 200, out);
    } catch (err) {
      if (err instanceof ValidationError) send(res, 400, { error: err.message });
      else throw err;
    }
    return true;
  }
  // The starter gift (starter.ts): taken on the home page, the ticket into their bag.
  const starterClaim = /^\/player-api\/starter\/(\d{17})\/claim$/.exec(path);
  if (starterClaim !== null) {
    if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return true; }
    const who = starterClaim[1] as string;
    if (await refused(res, 'starter', who, 'Quà tân thủ')) return true;
    try {
      const out = await claimStarter(who);
      const name = ctx.store.player(who)?.player.name ?? null;
      await audit({ action: 'starter claim', ok: true, detail: `${name ?? who} nhận quà tân thủ: ${out.item} vào túi đồ` }, { steamId: who, name });
      send(res, 200, out);
    } catch (err) {
      if (err instanceof ValidationError) send(res, 400, { error: err.message });
      else throw err;
    }
    return true;
  }
  // A quest's reward (quests.ts): done, not taken yet.
  const questClaim = /^\/player-api\/quests\/(\d{17})\/claim$/.exec(path);
  if (questClaim !== null) {
    if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return true; }
    const who = questClaim[1] as string;
    const body = await readSmallJson(req);
    if (body === null || typeof body['quest'] !== 'string') { send(res, 400, { error: 'expected { quest }' }); return true; }
    if (await refused(res, 'quests', who, 'Nhiệm vụ')) return true;
    if (!ctx.questProgress) { send(res, 503, { error: 'quests unavailable' }); return true; }
    try {
      const p = ctx.store.player(who)?.player;
      send(res, 200, await claimQuest(who, body['quest'], p?.online ? p.species ?? null : null, ctx.questProgress));
    } catch (err) {
      if (err instanceof ValidationError) send(res, 409, { error: err.message });
      else throw err;
    }
    return true;
  }
  // A server milestone's reward (milestones.ts): reached, enough minutes in game in all, not taken yet.
  const milestoneClaim = /^\/player-api\/milestones\/(\d{17})\/claim$/.exec(path);
  if (milestoneClaim !== null) {
    if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return true; }
    const who = milestoneClaim[1] as string;
    const body = await readSmallJson(req);
    if (body === null || typeof body['milestone'] !== 'string') { send(res, 400, { error: 'expected { milestone }' }); return true; }
    try {
      const out = await claimMilestone(who, body['milestone'], ctx.store.player(who)?.player.playtime ?? 0);
      const name = ctx.store.player(who)?.player.name ?? null;
      const got = [out.amber > 0 ? `${out.amber} ${CURRENCY}` : '', ...out.items].filter(Boolean).join(', ');
      await audit({ action: 'milestone claim', ok: true, detail: `${name ?? who} nhận quà mốc ${out.players} người: ${got || 'không có gì'}${out.skipped.length ? ` (bỏ qua, đã có: ${out.skipped.join(', ')})` : ''}` }, { steamId: who, name });
      send(res, 200, out);
    } catch (err) {
      if (err instanceof ValidationError) send(res, 409, { error: err.message });
      else throw err;
    }
    return true;
  }
  // The daily check-in (economy.ts): today's Hổ phách, once, after enough minutes in game.
  const checkin = /^\/player-api\/checkin\/(\d{17})$/.exec(path);
  if (checkin !== null) {
    if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return true; }
    const who = checkin[1] as string;
    if (await refused(res, 'amber', who, 'Điểm danh')) return true;
    try {
      send(res, 200, await claimCheckin(who, ctx.playDays?.minutesToday(who, Math.floor(Date.now() / 1000)) ?? 0));
    } catch (err) {
      if (err instanceof ValidationError) send(res, 409, { error: err.message });
      else throw err;
    }
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
          send(res, 409, { error: `Skin này dành cho ${item.data.species}, hãy chơi ${item.data.species} rồi mặc.` });
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
    // A store and a tele have a second outcome, when their countdown ends.
    const fin = r?.action === 'store' ? ctx.store.storeResult(steamId, id) : r?.action === 'tele' ? ctx.store.teleResult(steamId, id) : null;
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
      // By their tier (member-tier.ts): người thường / VIP / SVip / admin; maxSlots null = no limit.
      garageRules: { ...garageRuleFor(gs, await tierOf(steamId)), redeemAt: gs.redeemAt, storeCountdown: gs.storeCountdown,
        minHealthPct: gs.minHealthPct, minGrowthPct: gs.minGrowthPct },
      // Colours kept for the next times, by species (kept-skins.ts).
      keptSkins: await keptSkinsOf(steamId),
      // Their items (items.ts): what each is; a skin with the colours the game gets when they wear it.
      items: await ownedView(steamId, detail?.player.online ? detail.player.species ?? null : null, ctx.store.catalog.list()),
      // The bag's tab: open to them, or they own something (the starter ticket, shown while being tried).
      bag: (await bagOpen(steamId)) || (await inventoryOf(steamId)).length > 0,
      // The starter gift (starter.ts), while it waits on the home page.
      starter: (await starterOffered(steamId)) ? shown(await featureAccess('starter', steamId), {}) : null,
      // The Hổ phách shop's way in (its page asks /shop): {} open, { locked } shown locked, null none.
      shop: shown(await featureAccess('shop', steamId), {}),
      // SVip (svip.ts): tries the features being tested before everyone.
      svip: await isSvip(steamId),
      // Beside each feature they see (svip.ts): dev (Chỉ admin), svip (Ưu tiên), new (Công khai < 7 days).
      releases: await releasesFor(steamId),
      // Hổ phách and the daily check-in (economy.ts); being tried: shown, marked.
      economy: shown(await featureAccess('amber', steamId), {
        currency: CURRENCY,
        balance: await balanceOf(steamId),
        checkin: await checkinStatus(steamId, ctx.playDays?.minutesToday(steamId, Math.floor(Date.now() / 1000)) ?? 0),
      }),
      // The daily / weekly quests (quests.ts): given at the first ask of the day, for the dino played then.
      quests: ctx.questProgress
        ? shown(await featureAccess('quests', steamId), await questsOf(steamId, detail?.player.online ? detail.player.species ?? null : null, ctx.questProgress))
        : null,
      // The server's online milestones (milestones.ts): everyone's, not a feature being tried; null when off.
      milestones: await milestonesOf(steamId, detail?.player.playtime ?? 0, ctx.store.online().length,
        ctx.milestoneWatch?.held(Math.floor(Date.now() / 1000)) ?? {}),
      bagUnlimited: await bagUnlimited(steamId),
      // Serving a prison sentence (prison.ts), or null.
      prison: ctx.prison?.playerView(steamId) ?? null,
      // Tele con non (tele.ts): the limits, their code while it works, the cooldown left.
      tele: shown(await featureAccess('tele', steamId), await teleView(ctx.store, steamId)),
      // Kết bạn (friends.ts): how many ask them (the Map's badge); the list is GET /friends.
      friends: shown(await featureAccess('friends', steamId), { incoming: (await friends.view(steamId)).incoming.length }),
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
  if (path === '/player-api/news') {
    // Tin cập nhật (news.ts): the newest notes the panel shows, for the launcher's Trang chủ.
    send(res, 200, { items: newsForPlayers(await readNews()) });
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
  if (path === '/player-api/heatmap') {
    // Where players are, as counts per square (no names, no positions), admins left out.
    heat ??= new HeatMapper(() => ctx.store.online().map((p) => ({ steamId: p.steamId, loc: p.loc })), (id) => ctx.store.isAdmin(id));
    send(res, 200, heat.current());
    return true;
  }
  if (path === '/player-api/ai') {
    // The server owner chose to show players every live AI (2026-09-24). AI
    // spawns around players, so clusters hint where others are, say so if asked.
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
async function ownedView(steamId: string, playing: string | null, catalog: Array<{ species: string; classPath: string | null }>): Promise<unknown[]> {
  const owned = await inventoryOf(steamId);
  if (owned.length === 0) return [];
  // A dino item's species, as the game names it ("Tyrannosaurus").
  const labels = new Map(speciesOptions(catalog).map((x) => [x.key, x.label]));
  const labelOf = (key: string): string => labels.get(key) ?? key.charAt(0).toUpperCase() + key.slice(1);
  const byId = new Map((await listItems()).map((i) => [i.id, i]));
  // A feature not open to them (svip.ts): its items are shown (they own them), marked, and cannot be used yet.
  const open = { bag: await featureAccess('bag', steamId), starter: await featureAccess('starter', steamId) };
  return owned.flatMap((o) => {
    const i = byId.get(o.itemId);
    if (i === undefined) return [];
    const access = i.type === 'dino_box' || i.type === 'dino' ? open.starter : open.bag;
    return [{ uid: o.uid, id: i.id, type: i.type, name: i.name, rarity: i.rarity, source: o.source, grantedAt: o.grantedAt, note: o.note,
      ...(access === 'open' ? {} : { locked: access === 'hidden' ? 'Đang phát triển, chưa mở' : LOCKED_NOTE }),
      ...(i.type === 'skin' ? { species: i.data.species, skin: resolveSkin(i.data) }
        : i.type === 'mutation' ? { mutation: i.data.mutation, diet: i.data.diet, slot2: i.data.slot2, description: findReference(i.data.mutation)?.description ?? null,
          refusal: playing === null ? null : dietRefusal(playing, i.data.diet) }
          : i.type === 'mutation_ticket' ? { maxRarity: i.data.maxRarity }
            : i.type === 'dino_box' ? { pick: i.data.pick, growthMin: i.data.growthMin, growthMax: i.data.growthMax }
              : i.type === 'dino' && o.dino ? { dino: { ...o.dino, label: labelOf(o.dino.species) } }
                : i.type === 'growth_bag' ? { amount: i.data.amount, below: i.data.below }
                  : i.type === 'food_box' ? { amount: i.data.amount }
                    : i.type === 'loot_box' ? { prizes: i.data.pool.length } : {}) }];
  });
}
