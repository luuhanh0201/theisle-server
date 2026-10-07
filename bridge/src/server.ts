import { QUEST_KINDS, readQuestSettings, saveQuestSettings, type QuestProgress } from './quests.js';
import { CURRENCY, credit, economySummary, readEconomySettings, readLedger, saveEconomySettings, type PlayDays } from './economy.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { config } from './config.js';
import type { Store } from './store.js';
import { queueAdminAction, queueKill, queueLightTest } from './commands.js';
import { lastPrimeOf } from './prime-history.js';
import { lifeDetails, restoreLife } from './life-history.js';
import { readNotes, setNote } from './notes.js';
import { actingAs, audit, describeChanges, readAuditPage } from './audit.js';
import { auditKey, chatKey, deleteAuditLines, hideChat, isHiddenChat } from './deletions.js';
import { currentLogin, panelGate } from './panel-gate.js';
import { adminIds, readAccess, ruleFor, saveAccess, sessionSecret, writeAllowed, writeToken } from './panel-auth.js';
import { DEFAULT_PERM, PERMS, ROLES, denied, isSuper, permsOf, readPermissions, savePermission, validatePerm } from './permissions.js';
import type { Power } from './power.js';
import { readSchedule, writeSchedule, validateSchedule, occurrences } from './power.js';
import type { Rcon } from './rcon.js';
import { RCON_COMMANDS } from './rcon.js';
import { MANAGED, GROUPS, KNOWN_PLAYABLES, readLive, readSettings, saveSettings, type ManagedKey } from './gameini.js';
import { readReadiness } from './readiness.js';
import { readLiveState, livePlayer } from './live.js';
import { KEEP_DAYS, type Traffic } from './traffic.js';
import { EARLY_FEATURES, FEATURE_MODES, readSvip, saveSvip, type SvipState } from './svip.js';
import { STARTER_ITEM_IDS } from './starter.js';
import { readShop, saveShop } from './shop.js';
import { memberTiers, syncGarageMembers } from './member-tier.js';
import type { Metrics } from './metrics.js';
import type { VoiceRoom } from './voice.js';
import { handlePlayerApi, publicServerInfo, startMutationUse } from './player-api.js';
import { GROWTH_MAX, GROWTH_MIN, addGrowthEvent, firstDailyAt, readGrowthApplied, readGrowthEvents, removeGrowthEvent } from './growth-events.js';
import { readCommandsSettings, saveCommandsSettings } from './commands-settings.js';
import { readVoiceSettings, saveVoiceSettings } from './voice-settings.js';
import { speciesOfClassPath } from './catalog.js';
import { maximaAt } from './species-stats.js';
import { labPoints, SPECIES_LAB_MEASURED } from './species-lab.js';
import { AI_SPECIES } from './ai-species.js';
import { readAiZones, readAiZonesStatus, saveAiZones, zonePoints, type AiZonesSettings } from './ai-zones.js';
import { dropResult, queueDrop, validateDrop } from './ai-drop.js';
import { validateReset, type AiReset } from './ai-reset.js';
import { readPteraSettings, savePteraSettings } from './ptera-settings.js';
import { readTeleSettings, saveTeleSettings } from './tele.js';
import { readSanctuaries, readZoneGuard, saveZoneGuard, syncZoneGuard } from './zone-guard.js';
import { DISCORD_KINDS, banChangeLine, publicView, type DiscordLog } from './discord.js';
import { registerCommands } from './relay.js';
import { saveDdos, type DdosSettings, type DdosWatch } from './ddos.js';
import {
  DATA_PARTS, backupPath, createDataBackup, defaultRoots, deleteBackup, exportSettings, listBackups, prune, readBackupSettings,
  restore, saveBackupSettings, wipe, type DataPart,
} from './backup.js';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat as statFile, unlink as unlinkFile } from 'node:fs/promises';
import {
  PERMANENT_HOURS, banPlayer, banVars, durationText, formatGameTime, parseGameTime, readBans, readReasons, saveReasons, validateBan, validateBanEdit,
  type BanWatcher,
} from './bans.js';
import { readAmbient, setAmbient } from './ai-ambient.js';
import { readFlora, requestFloraRefresh } from './flora.js';
import { readFloraSettings, saveFloraSettings } from './flora-settings.js';
import { FISH_SPECIES, currentDisallowed, readFishCensus, readFishSettings, saveFish } from './fish-settings.js';
import { MESSAGES, currentMessages, renderMessage, saveMessages, type MessagesSettings } from './messages.js';
import { NEWS_LIMITS, describeNewsChanges, readNews, saveNews } from './news.js';
import { MUTATION_REFERENCE, REFERENCE_CHECKED, SOURCES, findReference } from './mutation-reference.js';
import {
  listAll,
  listPlayer,
  readSlot,
  readPlayerGarage,
  readGarageCatalog,
  isSteamId,
  createSlot,
  deleteSlot,
  ValidationError,
  NotFoundError,
  ConflictError,
  type NewSlotSpec,
  readGarageSettings,
  saveGarageSettings, garageRuleFor,
} from './garage.js';
import { addPrimeFix, listPrimeFixes } from './prime-fixes.js';
import type { Prison } from './prison.js';
import type { KillScenes } from './kill-scene.js';
import { REACH_RULES } from './damage-reach.js';
import { type Item, ITEM_TYPES, RARITIES, LIGHT_MAX, LIGHT_MIN, createItem, getItem, grantItem, listItems, ownerCounts, ownersOf, resolveSkin,
  fillBags, inventoryOf, revokeItem, speciesKey, updateItem } from './items.js';
import { queueSkinRepaint } from './commands.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function sendFile(res: ServerResponse, name: string, root = publicDir): Promise<void> {
  // Only ever serve out of the root, whatever the request path looked like.
  const resolved = join(root, normalize(name).replace(/^(\.\.[/\\])+/, ''));
  if (!resolved.startsWith(root)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  try {
    const body = await readFile(resolved);
    const ext = resolved.slice(resolved.lastIndexOf('.'));
    res.writeHead(200, {
      'content-type': contentTypes[ext] ?? 'application/octet-stream',
      // Revalidate every time: otherwise a browser keeps showing the old panel
      // after a deploy until someone thinks to hard-reload. The map (2.5 MB)
      // is the exception: the panel asks for it with ?v=<map version>.
      'cache-control': name.startsWith('map/') || name.startsWith('dino3d/') ? 'public, max-age=604800' : 'no-cache',
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

/**
 * A teleport is dropped from this high above the spot (cm). A ground point's
 * height is the centre of whatever stood there, a small AI's is lower than a
 * big dino's: put there exactly, a Rex went under the landscape (2026-10-02).
 */
const TELEPORT_DROP_CM = 400;

/** Read a JSON request body, capped so a bad client cannot exhaust memory. */
async function readJsonBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new ValidationError('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('body is not valid JSON');
  }
}

/**
 * Write endpoints edit player data, so they fail closed: with ADMIN_TOKEN
 * unset, nothing can write at all. The x-admin-token header is ADMIN_TOKEN
 * itself (a script) or the token of the admin's own login (the panel fills it
 * in), which only a page of the panel can know.
 */
function authorizeWrite(req: IncomingMessage): string | null {
  if (config.adminToken === null) {
    return 'writes are disabled, set ADMIN_TOKEN to enable them';
  }
  if (!writeAllowed(req.headers['x-admin-token'], config.adminToken, sessionSecret(), currentLogin.getStore()?.cookie)) {
    return 'invalid or missing x-admin-token';
  }
  return null;
}

function parseLimit(url: URL, fallback: number, max: number): number {
  const raw = url.searchParams.get('limit');
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/** ?type=death,chat -> the set of types, or null for "all". */
function parseTypes(url: URL): ReadonlySet<string> | null {
  const raw = url.searchParams.get('type');
  if (raw === null || raw.trim() === '') return null;
  return new Set(raw.split(',').map((t) => t.trim()).filter((t) => t !== ''));
}

/**
 * Mutations are written into the game with FName(name). Accept only names the
 * game itself reported ON THIS SPECIES. With allowUnconfirmedMutations, a name
 * seen on another species is let through (the admin ticked a box saying they
 * know); a name never seen anywhere is always refused.
 */
async function assertMutationsFor(store: Store, body: NewSlotSpec & { allowUnconfirmedMutations?: unknown }): Promise<void> {
  const mutations = body.mutations;
  if (mutations === undefined || mutations === null || typeof mutations !== 'object') return;
  const names = Object.values(mutations as Record<string, unknown>).filter(
    (v): v is string => typeof v === 'string' && v !== '',
  );
  if (names.length === 0) return;
  if (typeof body.classPath !== 'string') return;   // createSlot reports that

  const catalog = store.catalog.merge(await readGarageCatalog());
  const species = speciesOfClassPath(body.classPath);
  const allowOthers = body.allowUnconfirmedMutations === true;

  const unknown = names.filter((n) => !catalog.knows(n));
  if (unknown.length > 0) {
    throw new ValidationError(`mutation not seen on this server: ${unknown.join(', ')}`);
  }
  const unconfirmed = names.filter((n) => !catalog.confirms(species, n));
  if (unconfirmed.length > 0 && !allowOthers) {
    throw new ValidationError(
      `mutation not confirmed on ${species}: ${unconfirmed.join(', ')}, ` +
        'send allowUnconfirmedMutations: true to use it anyway',
    );
  }
}

export interface Ctx {
  store: Store;
  power: Power;
  rcon: Rcon;
  metrics?: Metrics;
  voice?: VoiceRoom;
  aiReset?: AiReset;
  discord?: DiscordLog;
  bans?: BanWatcher;
  ddos?: { watch: DdosWatch; settings: DdosSettings; iface: string | null };
  prison?: Prison;
  killScenes?: KillScenes;
  /** Site / launcher traffic (traffic.ts): the panel's "Truy cập" page. */
  traffic?: Traffic;
  /** Minutes in game per day (economy.ts): the daily check-in. */
  playDays?: PlayDays;
  /** The daily quests' progress (quests.ts). */
  questProgress?: QuestProgress;
  /** An admin's rights in the game were switched on / off: the AdminGuard mod's file is written again. */
  onAdminsChanged?: () => Promise<void>;
}

const fmtTime = (s: number): string => new Date(s * 1000).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

/** SVip for the panel: the players (with the names seen in game), the features with their release level, the levels. */
let svipNames: (id: string) => string | null = () => null;
function svipView(s: SvipState): unknown {
  return { players: s.players.map((p) => ({ ...p, name: svipNames(p.steamId) })), features: EARLY_FEATURES.map((f) => ({ ...f, mode: s.features[f.key] })), modes: FEATURE_MODES };
}
/** The features' levels for the audit, by name: "Cửa hàng…: Chỉ admin (Đang phát triển)". */
function featureLevels(s: SvipState): Record<string, string> {
  const name = (k: string): string => FEATURE_MODES.find((m) => m.key === k)?.label ?? k;
  return Object.fromEntries(EARLY_FEATURES.map((f) => [f.key, name(s.features[f.key])]));
}

/** Everything the Server tab shows, in one call. */
async function serverStatus(ctx: Ctx): Promise<unknown> {
  const [status, schedule] = await Promise.all([ctx.power.status(), readSchedule()]);
  const next = occurrences(schedule, Date.now()).find((d) => d.getTime() > Date.now());
  return {
    ...status,
    operation: ctx.power.current,
    lastOperation: ctx.power.last,
    schedule: { daily: schedule.daily, countdownMinutes: schedule.countdownMinutes, next: next ? Math.floor(next.getTime() / 1000) : null },
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    rconEnabled: ctx.rcon.enabled,
    writesEnabled: config.adminToken !== null,
    unitName: config.game.unit,
    /** Server clock (ms), so the panel's countdown is right even if the browser's is off. */
    now: Date.now(),
  };
}

/** What a messages save changed: each text (old → new), then the timings. */
function describeMessageChanges(before: MessagesSettings, after: MessagesSettings): string {
  const parts: string[] = [];
  for (const key of new Set([...Object.keys(before.texts), ...Object.keys(after.texts)])) {
    const a = before.texts[key];
    const b = after.texts[key];
    if (a === b) continue;
    const show = (v: string | undefined): string => (v === undefined ? '(mặc định)' : v === '' ? '(tắt)' : `"${v}"`);
    parts.push(`${key}: ${show(a)} → ${show(b)}`);
  }
  const rest = describeChanges(
    { countdownMarks: before.countdownMarks, corpseWipe: before.corpseWipe, periodic: before.periodic.map((p) => `${p.enabled ? '' : '(tắt) '}${p.everyMin}p: ${p.text}`) },
    { countdownMarks: after.countdownMarks, corpseWipe: after.corpseWipe, periodic: after.periodic.map((p) => `${p.enabled ? '' : '(tắt) '}${p.everyMin}p: ${p.text}`) },
  );
  if (rest) parts.push(rest);
  return parts.join(' · ');
}

/** What an AI zones save changed: the switches, then zones added, removed and changed. */
function describeZoneChanges(before: AiZonesSettings, after: AiZonesSettings): string {
  const parts: string[] = [];
  const top = describeChanges({ enabled: before.enabled, globalMax: before.globalMax }, { enabled: after.enabled, globalMax: after.globalMax });
  if (top) parts.push(top);
  const old = new Map(before.zones.map((z) => [z.id, z]));
  const now = new Map(after.zones.map((z) => [z.id, z]));
  for (const z of after.zones) if (!old.has(z.id)) parts.push(`+ vùng "${z.name}" (${z.species.join(', ')}; tối thiểu ${z.min}, tối đa ${z.max}, mỗi lượt ${z.perTurnMin}–${z.perTurnMax} con / ${z.everySec} s, cách nhau ≥ ${z.spacingM} m)`);
  for (const z of before.zones) if (!now.has(z.id)) parts.push(`− vùng "${z.name}"`);
  for (const z of after.zones) {
    const was = old.get(z.id);
    if (!was) continue;
    const d = describeChanges({ ...was }, { ...z });
    if (d) parts.push(`vùng "${z.name}": ${d}`);
  }
  return parts.join(' · ');
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: Ctx,
): Promise<void> {
  const { store, power } = ctx;
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  // The player portal's read-only routes, behind their own token.
  if (await handlePlayerApi(req, res, path, { store, serverPhase: async () => (await power.status()).phase, live: readLiveState,
    serverInfo: async () => publicServerInfo((await readLive()).effective),
    ...(ctx.voice ? { voice: ctx.voice } : {}), ...(ctx.prison ? { prison: ctx.prison } : {}),
    ...(ctx.traffic ? { traffic: ctx.traffic } : {}), ...(ctx.playDays ? { playDays: ctx.playDays } : {}),
    ...(ctx.questProgress ? { questProgress: ctx.questProgress } : {}) })) return;

  // Everything else is the admin panel: allowed address + admin login (panel-gate.ts).
  const login = await panelGate(req, res, url, (name) => sendFile(res, name), (id) => store.player(id)?.player.name ?? null);
  if (login === null) return;
  const name = login.steamId !== null ? store.player(login.steamId)?.player.name ?? null : null;
  await currentLogin.run(login, () => actingAs.run({ steamId: login.steamId, name }, () => handlePanel(req, res, ctx, url, login, name)));
}

async function handlePanel(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: Ctx,
  url: URL,
  login: { steamId: string | null; cookie: string | undefined; ip: string | null },
  name: string | null,
): Promise<void> {
  const { store, power, rcon } = ctx;
  const path = url.pathname;

  // Who is logged in, and the token the panel sends with every change.
  if (path === '/api/me' && req.method === 'GET') {
    const secret = sessionSecret();
    sendJson(res, 200, {
      steamId: login.steamId, name, ip: login.ip, via: login.ip === null ? 'tunnel' : 'web',
      token: secret !== null && login.cookie !== undefined && login.steamId !== null ? writeToken(secret, login.cookie) : null,
      // What this admin may do (permissions.ts): the panel hides the rest.
      perms: [...await permsOf(login.steamId)], super: isSuper(login.steamId),
    });
    return;
  }
  // Every other route: the admin's permission for it (permissions.ts), checked before anything runs.
  const refused = await denied(login.steamId, req.method ?? 'GET', path);
  if (refused !== null) {
    sendJson(res, 403, { error: refused });
    return;
  }
  // Panel → Quản trị → Phân quyền (the super admin only, "*" above).
  if (path === '/api/permissions' && req.method === 'GET') {
    const store = await readPermissions();
    const live = await readLive();
    const inIni = new Set(Array.isArray(live.effective['AdminsSteamIDs']) ? live.effective['AdminsSteamIDs'] as string[] : []);
    const admins = [...await adminIds()].map((id) => ({
      steamId: id, name: ctx.store.player(id)?.player.name ?? null,
      super: id === config.panel.superAdminId, owner: config.panel.ownerIds.includes(id),
      perm: store.admins[id] ?? DEFAULT_PERM, set: store.admins[id] !== undefined,
      // In the Game.ini the game read at its last start (or will read at the next).
      inGameNow: inIni.has(id),
    }));
    sendJson(res, 200, { perms: PERMS, roles: ROLES, admins, superAdmin: config.panel.superAdminId });
    return;
  }
  // --- items (items.ts): the kinds an admin makes (skins for now), who has which, applying a skin ---
  if (path === '/api/items' && req.method === 'GET') {
    const counts = await ownerCounts();
    sendJson(res, 200, {
      items: (await listItems()).map((i) => ({ ...i, owners: counts[i.id] ?? 0, ...(i.type === 'skin' ? { resolved: resolveSkin(i.data) } : {}) })),
      types: ITEM_TYPES, rarities: RARITIES, light: { min: LIGHT_MIN, max: LIGHT_MAX },
      // What a mutation item may be (Vật phẩm → Mutation): every mutation still in the game.
      mutations: MUTATION_REFERENCE.filter((m) => m.status !== 'removed').map((m) => ({
        name: m.name, description: m.description, diet: m.diet, kind: m.kind, unlock: m.unlock ?? null,
        stat: m.stat, tiers: m.tiers, status: m.status, femaleOnly: m.femaleOnly === true,
      })),
    });
    return;
  }
  const itemOwners = /^\/api\/items\/([a-z0-9_]{4,20})\/owners$/.exec(path);
  if (itemOwners && req.method === 'GET') {
    const owners = await ownersOf(itemOwners[1] as string);
    sendJson(res, 200, { owners: owners.map((o) => ({ ...o, name: ctx.store.player(o.steamId)?.player.name ?? null })) });
    return;
  }
  const itemOne = /^\/api\/items\/([a-z0-9_]{4,20})$/.exec(path);
  const itemAct = /^\/api\/items\/([a-z0-9_]{4,20})\/(grant|apply)$/.exec(path);
  const itemRevoke = /^\/api\/items\/([a-z0-9_]{4,20})\/grant\/(\d{17})$/.exec(path);
  if ((path === '/api/items' && req.method === 'POST') || (itemOne && req.method === 'PUT')
    || (itemAct && req.method === 'POST') || (itemRevoke && req.method === 'DELETE')) {
    const deniedWrite = authorizeWrite(req);
    if (deniedWrite !== null) { sendJson(res, 403, { error: deniedWrite }); return; }
    try {
      const label = (i: Item): string => `${i.name} · ${i.type === 'skin' ? `skin ${i.data.species}` : i.type === 'mutation' ? `mutation ${i.data.mutation}`
        : ITEM_TYPES.find((t) => t.key === i.type)?.label ?? i.type}`;
      if (path === '/api/items') {
        const item = await createItem(await readJsonBody(req), login.steamId);
        await audit({ action: 'item created', detail: `${label(item)} · ${item.id}`, ok: true });
        // Into every admin's bag at once (items.ts fillBags; the bridge's minute sweep does it too).
        await fillBags(await adminIds(), STARTER_ITEM_IDS);
        sendJson(res, 201, { item });
        return;
      }
      if (itemOne) {
        const { before, after } = await updateItem(itemOne[1] as string, await readJsonBody(req));
        // Given out again (no longer retired): back in the admins' bags.
        if (before.retired && !after.retired) await fillBags(await adminIds(), STARTER_ITEM_IDS);
        await audit({ action: 'item updated', detail: `${label(after)} · ${after.id}`
          + (before.retired !== after.retired ? (after.retired ? ' · ngừng phát hành' : ' · phát hành lại') : ''), ok: true });
        sendJson(res, 200, { item: after });
        return;
      }
      if (itemRevoke) {
        const [, itemId, steamId] = itemRevoke as unknown as [string, string, string];
        if (!(await revokeItem(steamId, itemId))) { sendJson(res, 404, { error: 'người chơi không có vật phẩm này' }); return; }
        const item = await getItem(itemId);
        await audit({ action: 'item revoked', detail: `${item ? label(item) : itemId} ← ${ctx.store.player(steamId)?.player.name ?? '?'} (${steamId})`, ok: true });
        sendJson(res, 200, { ok: true });
        return;
      }
      const [, itemId, act] = itemAct as unknown as [string, string, 'grant' | 'apply'];
      const body = (await readJsonBody(req)) as { steamId?: unknown; note?: unknown; slot?: unknown; upgrade?: unknown };
      const steamId = typeof body.steamId === 'string' ? body.steamId.trim() : '';
      if (!/^\d{17}$/.test(steamId)) throw new ValidationError('steamId must be a SteamID64');
      const item = await getItem(itemId);
      if (item === null) { sendJson(res, 404, { error: 'no such item' }); return; }
      const who = ctx.store.player(steamId)?.player;
      if (act === 'grant') {
        await grantItem(steamId, itemId, 'admin', login.steamId, body.note);
        await audit({ action: 'item granted', detail: `${label(item)} → ${who?.name ?? '?'} (${steamId})`, ok: true });
        sendJson(res, 200, { ok: true });
        return;
      }
      // A mutation: one copy of their inventory used on the dino they play, as the player would (player-api.ts).
      if (item.type === 'mutation') {
        const copy = (await inventoryOf(steamId)).find((o) => o.itemId === itemId);
        if (!copy) { sendJson(res, 409, { error: 'người chơi chưa có mutation này trong kho, tặng trước rồi dùng' }); return; }
        const upgrade = body.upgrade === true;
        const r = await startMutationUse({ store: ctx.store, ...(ctx.prison ? { prison: ctx.prison } : {}) }, steamId, copy.uid, body.slot, upgrade);
        if (r.status === 202) {
          await audit({ action: 'mutation used', detail: `${label(item)} → ${who?.name ?? '?'} (${steamId}) · ${upgrade ? 'nâng cấp +1 đời' : `ô ${String(body.slot)}`}`, ok: true });
        }
        sendJson(res, r.status, r.body);
        return;
      }
      // A ticket: chosen in the player's own bag (Túi đồ), not from here.
      if (item.type !== 'skin') { sendJson(res, 400, { error: 'phiếu được dùng trong Túi đồ của người chơi' }); return; }
      // Apply a skin now, on the dino they play (it must be the skin's species).
      if (speciesKey(who?.species) !== speciesKey(item.data.species)) {
        sendJson(res, 409, { error: `người chơi không đang chơi ${item.data.species}${who?.species ? ` (đang: ${String(who.species).replace(/^BP_/, '').replace(/_C$/, '')})` : ''}` });
        return;
      }
      const cmd = await queueSkinRepaint(steamId, resolveSkin(item.data));
      await audit({ action: 'skin applied', detail: `${label(item)} → ${who?.name ?? '?'} (${steamId})`, ok: true });
      sendJson(res, 202, { id: cmd.id });
    } catch (error) {
      if (error instanceof ValidationError) { sendJson(res, 400, { error: error.message }); return; }
      throw error;
    }
    return;
  }

  const permFor = /^\/api\/permissions\/(\d{17})$/.exec(path);
  if (permFor && req.method === 'PUT') {
    const deniedWrite = authorizeWrite(req);
    if (deniedWrite !== null) { sendJson(res, 403, { error: deniedWrite }); return; }
    try {
      const steamId = permFor[1] as string;
      if (!(await adminIds()).has(steamId)) throw new ValidationError('không phải admin của panel');
      const perm = validatePerm(await readJsonBody(req));
      const { before, after } = await savePermission(steamId, perm);
      // In game on / off: the game's admin list is written again (the game reads it at its next start).
      if (before.ingame !== after.ingame) {
        const settings = await readSettings();
        if (!Array.isArray(settings['AdminsSteamIDs'])) {
          const live = await readLive();
          settings['AdminsSteamIDs'] = Array.isArray(live.effective['AdminsSteamIDs']) ? live.effective['AdminsSteamIDs'] : [];
        }
        await saveSettings(settings);
        await ctx.onAdminsChanged?.();
      }
      const who = ctx.store.player(steamId)?.player.name ?? steamId;
      await audit({ action: 'admin permissions changed', detail: `${who} · ${ROLES[after.role].label}`
        + (after.allow.length ? ` · thêm ${after.allow.join(', ')}` : '') + (after.deny.length ? ` · bỏ ${after.deny.join(', ')}` : '')
        + ` · trong game ${after.ingame ? 'BẬT' : 'TẮT'}${before.ingame !== after.ingame ? ' (đổi, có hiệu lực hoàn toàn sau restart)' : ''}`, ok: true });
      sendJson(res, 200, { ok: true, perm: after });
    } catch (error) {
      if (error instanceof ValidationError) { sendJson(res, 400, { error: error.message }); return; }
      throw error;
    }
    return;
  }
  if (path === '/api/prison' && req.method === 'GET') {
    if (!ctx.prison) { sendJson(res, 503, { error: 'prison is not running' }); return; }
    sendJson(res, 200, await ctx.prison.view());
    return;
  }
  if (path === '/api/bans' && req.method === 'GET') {
    const now = Math.floor(Date.now() / 1000);
    const list = (await readBans()).map((b) => ({ ...b, duration: durationText(b), active: b.permanent || (b.endsAt !== null && b.endsAt > now) }))
      .sort((a, b) => (b.bannedAt ?? 0) - (a.bannedAt ?? 0));
    const live = await readLive().catch(() => null);
    const adminsRaw = live?.settings['AdminsSteamIDs'] ?? live?.effective['AdminsSteamIDs'];
    const admins = Array.isArray(adminsRaw) ? adminsRaw.filter((x): x is string => typeof x === 'string') : [];
    sendJson(res, 200, { bans: list, reasons: await readReasons(), permanentHours: PERMANENT_HOURS, rcon: ctx.rcon.enabled, admins });
    return;
  }
  if (path === '/api/ddos' && req.method === 'GET') {
    if (!ctx.ddos) { sendJson(res, 503, { error: 'DDoS watch is not running' }); return; }
    const d = ctx.ddos;
    sendJson(res, 200, { ...d.settings, iface: d.iface, attack: d.watch.attack, history: d.watch.history.slice(-60) });
    return;
  }
  if (path === '/api/discord/url' && req.method === 'GET') {
    // One saved webhook URL, shown to an admin who asked (the eye on the panel); logged.
    const c = ctx.discord?.settings.channels.find((x) => x.id === url.searchParams.get('channel'));
    if (!c) { sendJson(res, 404, { error: 'no such channel' }); return; }
    await audit({ action: 'Discord webhook URL viewed', detail: c.name, ok: true });
    sendJson(res, 200, { url: c.url });
    return;
  }
  if (path === '/api/backups' && req.method === 'GET') {
    const roots = defaultRoots();
    sendJson(res, 200, { backups: await listBackups(roots), settings: await readBackupSettings(), parts: DATA_PARTS, phase: (await ctx.power.status()).phase });
    return;
  }
  const backupFile = /^\/api\/backups\/file\/([^/]+)$/.exec(path);
  if (backupFile && req.method === 'GET') {
    const file = backupPath(defaultRoots(), decodeURIComponent(backupFile[1] as string));
    const s = await statFile(file).catch(() => null);
    if (!s) { sendJson(res, 404, { error: 'không có bản backup này' }); return; }
    await audit({ action: 'backup downloaded', detail: String(backupFile[1]), ok: true });
    res.writeHead(200, {
      'content-type': 'application/gzip', 'content-length': String(s.size), 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="${decodeURIComponent(backupFile[1] as string)}"`,
    });
    createReadStream(file).pipe(res);
    return;
  }
  if (path === '/api/discord' && req.method === 'GET') {
    if (!ctx.discord) { sendJson(res, 503, { error: 'Discord log is not running' }); return; }
    await ctx.discord.refreshInfo();
    sendJson(res, 200, { ...(publicView(ctx.discord.settings) as object), kinds: DISCORD_KINDS, status: ctx.discord.status() });
    return;
  }
  if (path === '/api/members' && req.method === 'GET') {
    // Thành viên: the game's admin, whitelist and VIP lists (Game.ini, saved through /api/game-config),
    // with the names seen in game; the owners (ADMIN_STEAM_IDS) cannot be taken off here.
    const live = await readLive();
    const listOf = (k: string): string[] => {
      const v = live.settings[k] ?? live.effective[k];
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    };
    const lists = { admins: listOf('AdminsSteamIDs'), whitelist: listOf('WhitelistIDs'), vips: listOf('VIPs') };
    const ids = new Set([...lists.admins, ...lists.whitelist, ...lists.vips]);
    const names = Object.fromEntries([...ids].map((id) => [id, store.player(id)?.player.name ?? null]));
    const on = live.settings['bServerWhitelist'] ?? live.effective['bServerWhitelist'];
    sendJson(res, 200, { ...lists, whitelistOn: on === true, names, owners: config.panel.ownerIds, superAdmin: config.panel.superAdminId,
      // Saved since the game started: the game itself has the lists from its next start.
      pendingRestart: await power.status().then((st) => live.iniWrittenAt !== null && st.unit?.since != null && live.iniWrittenAt > st.unit.since) });
    return;
  }
  // Hổ phách (economy.ts): the settings, who has most, the ledger.
  if (path === '/api/economy' && req.method === 'GET') {
    const sum = await economySummary();
    sendJson(res, 200, { currency: CURRENCY, settings: await readEconomySettings(),
      summary: { ...sum, top: sum.top.map((x) => ({ ...x, name: ctx.store.player(x.steamId)?.player.name ?? null })) } });
    return;
  }
  // The Hổ phách shop (shop.ts): the listings, and the items it may sell for the panel's picker.
  if (path === '/api/shop' && req.method === 'GET') {
    const items = (await listItems()).filter((i) => !i.retired && !ITEM_TYPES.find((t) => t.key === i.type)?.system)
      .map((i) => ({ id: i.id, type: i.type, name: i.name, rarity: i.rarity }));
    sendJson(res, 200, { listings: await readShop(), items });
    return;
  }
  if (path === '/api/quests' && req.method === 'GET') {
    sendJson(res, 200, { settings: await readQuestSettings(), kinds: QUEST_KINDS });
    return;
  }
  if (path === '/api/economy/ledger' && req.method === 'GET') {
    const id = url.searchParams.get('steamId');
    const lines = await readLedger(id !== null && /^\d{17}$/.test(id) ? id : null, 300);
    sendJson(res, 200, { lines: lines.map((l) => ({ ...l, name: ctx.store.player(l.steamId)?.player.name ?? null })) });
    return;
  }
  if (path === '/api/svip' && req.method === 'GET') {
    sendJson(res, 200, svipView(await readSvip()));
    return;
  }
  if (path === '/api/panel-access' && req.method === 'GET') {
    sendJson(res, 200, { ...await readAccess(), yourIp: login.ip, yourRule: login.ip ? ruleFor(login.ip) : null, webEnabled: config.panel.baseUrl !== null });
    return;
  }

  // --- writes ---------------------------------------------------------
  // POST   /api/garage/<steamId>/<slot>   put a dino straight into a garage
  // DELETE /api/garage/<steamId>/<slot>   remove one (soft: moved to deleted/)
  // POST   /api/player/<steamId>/kill     remove the dino they are playing now
  // PUT    /api/mutations/<name>          { description }, "" clears it
  // POST   /api/server/<start|stop|restart|cancel>   { countdownSeconds, reason }
  // PUT    /api/server/schedule           { daily: ["04:00"], countdownMinutes }
  // POST   /api/rcon/<command>            { args }
  // PUT    /api/game-config               { settings, restart?: { countdownSeconds, reason } }
  if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT') {
    const garage = /^\/api\/garage\/([^/]+)\/([^/]+)$/.exec(path);
    const kill = /^\/api\/player\/([^/]+)\/kill$/.exec(path);
    const adminAct = /^\/api\/player\/(\d{17})\/admin$/.exec(path);
    const note = /^\/api\/mutations\/([^/]+)$/.exec(path);
    const power_ = /^\/api\/server\/(start|stop|restart|cancel)$/.exec(path);
    const rconCmd = /^\/api\/rcon\/([A-Za-z]+)$/.exec(path);
    const prisonAct = /^\/api\/prison\/sentence\/([a-f0-9]{10})\/(release|extend)$/.exec(path);
    const growthDel = /^\/api\/server\/growth-events\/(ge_[0-9a-f]{8})$/.exec(path);
    const allowed =
      (prisonAct !== null && req.method === 'POST') ||
      (path === '/api/prison/jail' && req.method === 'POST') ||
      (path === '/api/prison/settings' && req.method === 'PUT') ||
      (garage !== null && req.method !== 'PUT') ||
      (kill !== null && req.method === 'POST') ||
      (adminAct !== null && req.method === 'POST') ||
      (note !== null && req.method === 'PUT') ||
      (power_ !== null && req.method === 'POST') ||
      (rconCmd !== null && req.method === 'POST') ||
      (path === '/api/server/schedule' && req.method === 'PUT') ||
      (path === '/api/chat/delete' && req.method === 'POST') ||
      (path === '/api/server/audit/delete' && req.method === 'POST') ||
      (path === '/api/server/growth-events' && req.method === 'POST') ||
      (growthDel !== null && req.method === 'DELETE') ||
      (path === '/api/game-config' && req.method === 'PUT') ||
      (path === '/api/garage-settings' && req.method === 'PUT') ||
      (path === '/api/prime-fixes' && req.method === 'POST') ||
      (path === '/api/light-test' && req.method === 'POST') ||
      (path === '/api/restore-life' && req.method === 'POST') ||
      (path === '/api/commands-settings' && req.method === 'PUT') ||
      (path === '/api/voice-settings' && req.method === 'PUT') ||
      (path === '/api/panel-access' && req.method === 'PUT') ||
      (path === '/api/svip' && req.method === 'PUT') ||
      (path === '/api/economy/settings' && req.method === 'PUT') ||
      (path === '/api/quests' && req.method === 'PUT') ||
      (path === '/api/shop' && req.method === 'PUT') ||
      (path === '/api/economy/adjust' && req.method === 'POST') ||
      (path === '/api/ai-zones' && req.method === 'PUT') ||
      (path === '/api/ai-drop' && req.method === 'POST') ||
      (path === '/api/messages' && req.method === 'PUT') ||
      (path === '/api/news' && req.method === 'PUT') ||
      (path === '/api/ptera-carry' && req.method === 'PUT') ||
      (path === '/api/tele-settings' && req.method === 'PUT') ||
      (path === '/api/zone-guard' && req.method === 'PUT') ||
      (path === '/api/discord' && req.method === 'PUT') ||
      (path === '/api/bans' && req.method === 'POST') ||
      ((path === '/api/bans/unban' || path === '/api/bans/edit') && req.method === 'POST') ||
      (path === '/api/ban-reasons' && req.method === 'PUT') ||
      (path === '/api/discord/test' && req.method === 'POST') ||
      (path === '/api/discord/register-commands' && req.method === 'POST') ||
      (path === '/api/ddos' && req.method === 'PUT') ||
      (path === '/api/backups' && req.method === 'POST') ||
      (path === '/api/backup-settings' && req.method === 'PUT') ||
      ((path === '/api/backups/export-settings' || path === '/api/backups/wipe' || path === '/api/backups/restore') && req.method === 'POST') ||
      (/^\/api\/backups\/file\/[^/]+$/.test(path) && req.method === 'DELETE') ||
      (path === '/api/flora-settings' && req.method === 'PUT') ||
      (path === '/api/map/flora/refresh' && req.method === 'POST') ||
      (path === '/api/fish-settings' && req.method === 'PUT') ||
      (path === '/api/ai-ambient' && req.method === 'PUT') ||
      ((path === '/api/ai-reset' || path === '/api/ai-reset/cancel') && req.method === 'POST');
    if (!allowed) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    const denied = authorizeWrite(req);
    if (denied !== null) {
      sendJson(res, 403, { error: denied });
      return;
    }

    if (power_ !== null) {
      const verb = power_[1] as 'start' | 'stop' | 'restart' | 'cancel';
      if (verb === 'cancel') {
        const ok = power.cancel();
        sendJson(res, ok ? 200 : 409, ok ? { cancelled: true } : { error: 'nothing to cancel (only a countdown can be)' });
        return;
      }
      const body = (await readJsonBody(req)) as { countdownSeconds?: unknown; reason?: unknown };
      const op = power.request(verb, {
        countdownSeconds: Number(body.countdownSeconds ?? 0),
        reason: typeof body.reason === 'string' ? body.reason : '',
      });
      await audit({ action: `server ${verb} requested`, detail: [`countdown ${Math.round((op.runAt - op.startedAt) / 1000)}s`, op.reason].filter(Boolean).join(' · '), ok: true });
      sendJson(res, 202, { operation: op });
      return;
    }

    // The super admin deletes chat lines / admin log lines (deletions.ts): nothing written to the admin log.
    if (path === '/api/chat/delete' || path === '/api/server/audit/delete') {
      if (!isSuper(login.steamId)) { sendJson(res, 403, { error: 'chỉ admin tổng' }); return; }
      const body = (await readJsonBody(req)) as { keys?: unknown };
      const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === 'string').slice(0, 1000) : [];
      if (keys.length === 0) { sendJson(res, 400, { error: 'keys required' }); return; }
      const deleted = path === '/api/chat/delete' ? await hideChat(keys) : await deleteAuditLines(keys);
      sendJson(res, 200, { deleted });
      return;
    }

    // Sự kiện tốc độ lớn (growth-events.ts): applied at the next start of the game.
    if (path === '/api/server/growth-events') {
      const ev = addGrowthEvent(config.dataDir, await readJsonBody(req), login?.steamId ?? null);
      await audit({ action: 'growth event added', detail: `×${ev.multiplier} · ${fmtTime(ev.start)} → ${fmtTime(ev.end)}${ev.note ? ` · ${ev.note}` : ''}`, ok: true });
      sendJson(res, 201, { event: ev });
      return;
    }
    if (growthDel !== null) {
      const gone = removeGrowthEvent(config.dataDir, growthDel[1] as string);
      if (gone === null) { sendJson(res, 404, { error: 'no such event' }); return; }
      await audit({ action: 'growth event removed', detail: `×${gone.multiplier} · ${fmtTime(gone.start)} → ${fmtTime(gone.end)}`, ok: true });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (path === '/api/server/schedule') {
      const next = validateSchedule(await readJsonBody(req));
      const current = await readSchedule();
      await writeSchedule({ ...current, ...next });
      await audit({ action: 'restart schedule set', detail: `${next.daily.join(', ') || '(none)'} · countdown ${next.countdownMinutes}m`, ok: true });
      sendJson(res, 200, { schedule: next });
      return;
    }

    if (rconCmd !== null) {
      const name = rconCmd[1] as string;
      const spec = RCON_COMMANDS[name];
      if (spec === undefined) {
        sendJson(res, 404, { error: `unknown RCON command: ${name}` });
        return;
      }
      const body = (await readJsonBody(req)) as { args?: unknown };
      try {
        const response = await rcon.run(name, body.args);
        if (!spec.read) await audit({ action: `rcon ${name}`, detail: body.args === undefined ? '' : String(body.args).slice(0, 120), ok: true });
        // Corpses cleared by hand: players hear it, as with the scheduled wipe.
        const done = name === 'wipeCorpses' ? renderMessage('corpses.done') : null;
        if (done !== null) await rcon.run('announce', done).catch(() => undefined);
        sendJson(res, 200, { command: name, response });
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        if (!spec.read) await audit({ action: `rcon ${name}`, ok: false, error: (error as Error).message });
        sendJson(res, 502, { error: (error as Error).message });
      }
      return;
    }

    if (path === '/api/commands-settings') {
      const before = await readCommandsSettings();
      const saved = await saveCommandsSettings(await readJsonBody(req));
      await audit({ action: 'player command settings saved', detail: describeChanges({ ...before }, { ...saved }) || 'không đổi gì', ok: true });
      sendJson(res, 200, saved);
      return;
    }

    if (path === '/api/ai-zones') {
      const before = await readAiZones();
      const saved = await saveAiZones(await readJsonBody(req), store.groundPoints);
      // A zone marked "small dinos only" (or no longer) changes what ZoneGuard guards.
      await syncZoneGuard();
      await audit({ action: 'AI zones saved', detail: describeZoneChanges(before, saved) || 'không đổi gì', ok: true });
      sendJson(res, 200, saved);
      return;
    }

    if (path === '/api/ai-reset' || path === '/api/ai-reset/cancel') {
      if (!ctx.aiReset) { sendJson(res, 503, { error: 'AI reset is not available' }); return; }
      if (path === '/api/ai-reset/cancel') {
        const cancelled = ctx.aiReset.cancel();
        sendJson(res, cancelled ? 200 : 409, cancelled ? ctx.aiReset.status() : { error: 'nothing to cancel (only during the countdown)' });
        return;
      }
      const { op, done } = ctx.aiReset.request(validateReset(await readJsonBody(req)));
      done.catch((error: unknown) => console.error('[ai-reset] failed:', error));
      await audit({ action: 'AI reset requested', detail: `${op.species.length ? op.species.join(', ') : op.keepZoneSpecies ? 'AI không thuộc loài của vùng' : 'mọi AI'} · đếm ngược ${op.countdownSec} s`, ok: true });
      sendJson(res, 202, { operation: op });
      return;
    }

    if (path === '/api/ai-ambient') {
      const body = (await readJsonBody(req)) as { on?: unknown };
      if (typeof body.on !== 'boolean') throw new ValidationError('on must be true or false');
      const before = await readAmbient(rcon);
      const after = await setAmbient(rcon, body.on);
      await audit({
        action: `game AI around players ${body.on ? 'on' : 'off'}`,
        detail: `server: ${before.live ?? '?'} → ${after.live ?? '?'}${after.toggled ? ' (RCON ToggleAI)' : ''} · Game.ini bSpawnAI: ${before.ini ?? '?'} → ${after.ini ?? '?'}`,
        ok: after.live === null || after.live === body.on,
      });
      sendJson(res, 200, after);
      return;
    }

    if (path === '/api/fish-settings') {
      const before = await readFishSettings();
      const saved = await saveFish(await readJsonBody(req), rcon);
      await audit({
        action: 'fish settings saved',
        detail: `${describeChanges({ ...before }, { ...saved.settings }) || 'không đổi gì'} · DisallowedAIClasses: ${saved.disallowed.join(', ') || '(trống)'} · RCON: ${saved.rcon}`,
        ok: true,
      });
      sendJson(res, 200, saved);
      return;
    }

    if (path === '/api/map/flora/refresh') {
      // The map's "Tải lại thực vật": the mod reads the plants again now (flora.ts), not at the next ten minutes.
      const r = await requestFloraRefresh();
      sendJson(res, r.ok ? 202 : 429, r.ok ? r : { error: `vừa đọc lại, thử lại sau ${r.retryIn} giây`, retryIn: r.retryIn });
      return;
    }

    if (path === '/api/flora-settings') {
      const before = await readFloraSettings();
      const saved = await saveFloraSettings(await readJsonBody(req));
      await audit({ action: 'plant settings saved', detail: describeChanges({ ...before }, { ...saved }) || 'không đổi gì', ok: true });
      sendJson(res, 200, saved);
      return;
    }

    if (path === '/api/zone-guard') {
      const before = await readZoneGuard();
      const saved = await saveZoneGuard(await readJsonBody(req));
      await audit({ action: 'small-dinos-only zones saved', detail: describeChanges({ ...before }, { ...saved }) || 'không đổi gì', ok: true });
      sendJson(res, 200, saved);
      return;
    }

    if (path === '/api/ptera-carry') {
      const before = await readPteraSettings();
      const saved = await savePteraSettings(await readJsonBody(req));
      await audit({ action: 'Ptera carry settings saved', detail: describeChanges({ ...before }, { ...saved }) || 'không đổi gì', ok: true });
      sendJson(res, 200, saved);
      return;
    }

    if (path === '/api/tele-settings') {
      const before = await readTeleSettings();
      const saved = await saveTeleSettings(await readJsonBody(req));
      await audit({ action: 'Tele settings saved', detail: describeChanges({ ...before }, { ...saved }) || 'không đổi gì', ok: true });
      sendJson(res, 200, saved);
      return;
    }

    if (path === '/api/news') {
      const before = await readNews();
      const saved = await saveNews(await readJsonBody(req));
      await audit({ action: 'news saved', detail: describeNewsChanges(before, saved) || 'không đổi gì', ok: true });
      sendJson(res, 200, saved);
      return;
    }

    if (path === '/api/messages') {
      const before = currentMessages();
      const saved = await saveMessages(await readJsonBody(req));
      await audit({ action: 'messages saved', detail: describeMessageChanges(before, saved) || 'không đổi gì', ok: true });
      sendJson(res, 200, saved);
      return;
    }

    if (path === '/api/ai-drop') {
      const drop = validateDrop(await readJsonBody(req));
      const player = livePlayer(await readLiveState(), drop.steamId);
      if (player === null) {
        sendJson(res, 409, { error: 'that player is not in the game right now (no live position)' });
        return;
      }
      const queued = await queueDrop(drop, player.loc, store.groundPoints);
      await audit({
        action: 'AI dropped near a player',
        detail: `${drop.steamId} · ${drop.count} × ${drop.species} ${Math.round(drop.growth * 100)}% · ~${drop.distanceM} m · lệnh ${queued.id}`,
        ok: true,
      });
      sendJson(res, 202, { id: queued.id, spots: queued.spots.length });
      return;
    }

    if (path === '/api/prison/settings' || path === '/api/prison/jail' || prisonAct !== null) {
      if (!ctx.prison) { sendJson(res, 503, { error: 'prison is not running' }); return; }
      const who = name ?? 'admin';
      if (path === '/api/prison/settings') {
        const before = ctx.prison.settings;
        const saved = await ctx.prison.saveSettings(await readJsonBody(req));
        await audit({ action: 'prison settings saved', detail: describeChanges({ ...before, offenses: before.offenses.length }, { ...saved, offenses: saved.offenses.length }) || 'không đổi gì', ok: true });
        sendJson(res, 200, saved);
        return;
      }
      if (path === '/api/prison/jail') {
        const s = await ctx.prison.jail(await readJsonBody(req), who);
        await audit({ action: 'player jailed', detail: `${s.name} (${s.steamId}) · ${s.minutes} phút · ${s.offense}: ${s.reason}${s.prior ? ` · tiền án ${s.prior}` : ''}`, ok: true });
        sendJson(res, 200, s);
        return;
      }
      const [, id, act] = prisonAct as RegExpExecArray;
      if (act === 'release') {
        const s = await ctx.prison.release(id as string, who);
        await audit({ action: 'prisoner released early', detail: `${s.name} (${s.steamId})`, ok: true });
        sendJson(res, 200, s);
        return;
      }
      const body = (await readJsonBody(req)) as { minutes?: unknown };
      const s = await ctx.prison.extend(id as string, body.minutes, who);
      await audit({ action: 'prison sentence changed', detail: `${s.name} (${s.steamId}) · ${String(body.minutes)} phút`, ok: true });
      sendJson(res, 200, s);
      return;
    }

    if (path === '/api/bans') {
      const ban = validateBan(await readJsonBody(req));
      const online = store.online().some((p) => p.steamId === ban.steamId);
      try {
        await banPlayer(ctx.rcon, ban, online);
      } catch (error) {
        await audit({ action: 'player banned', detail: `${ban.name} (${ban.steamId}) · ${ban.hours} h · ${ban.reason}`, ok: false, error: (error as Error).message });
        throw error;
      }
      await audit({ action: 'player banned', detail: `${ban.name} (${ban.steamId}) · ${ban.hours >= PERMANENT_HOURS ? 'vĩnh viễn' : `${ban.hours} giờ`} · ${ban.reason}${online ? ' · đã kick' : ''}`, ok: true });
      sendJson(res, 200, { ok: true, kicked: online });
      return;
    }

    if (path === '/api/bans/unban' || path === '/api/bans/edit') {
      if (!ctx.bans) { sendJson(res, 503, { error: 'ban list is not watched' }); return; }
      const body = await readJsonBody(req);
      const unban = path === '/api/bans/unban';
      const e = unban ? validateBanEdit({ ...(body as object), reason: 'x' }) : validateBanEdit(body);
      const who = name ?? 'admin';
      const { before, after } = await ctx.bans.change(unban
        ? { steamId: e.steamId, bannedTime: e.bannedTime, action: 'unban', by: who }
        : {
          steamId: e.steamId, bannedTime: e.bannedTime, action: 'edit', by: who,
          ...(e.endsAt === undefined ? {} : { endBanTime: formatGameTime(e.endsAt === 'permanent' ? (parseGameTime(e.bannedTime) as number) + PERMANENT_HOURS * 3600 : e.endsAt) }),
          ...(e.reason === undefined ? {} : { banReason: e.reason }),
        });
      const bVars: Record<string, string> = { ...banVars(before), by: who };
      const aVars: Record<string, string> | null = after === null ? null : { ...banVars(after), by: who };
      ctx.discord?.post(banChangeLine(before, bVars, after, aVars, who));
      const text = renderMessage(after === null ? 'ban.unban' : 'ban.edit', aVars ?? bVars);
      if (text !== null && ctx.rcon.enabled) await ctx.rcon.run('announce', text).catch(() => undefined);
      await audit({
        action: after === null ? 'player unbanned' : 'ban changed',
        detail: after === null ? `${before.name} (${before.steamId}) · lý do cũ: ${before.reason}`
          : `${before.name} (${before.steamId}) · ${bVars['duration']} → ${aVars?.['duration']} (hết ${aVars?.['until']})${before.reason !== after.reason ? ` · lý do: ${after.reason}` : ''}`,
        ok: true,
      });
      sendJson(res, 200, { ok: true, ban: after });
      return;
    }

    if (path === '/api/ban-reasons') {
      const before = await readReasons();
      const saved = await saveReasons(((await readJsonBody(req)) as { reasons?: unknown }).reasons);
      await audit({ action: 'ban reasons saved', detail: describeChanges({ reasons: before }, { reasons: saved }) || 'không đổi gì', ok: true });
      sendJson(res, 200, { reasons: saved });
      return;
    }

    if (path.startsWith('/api/backup')) {
      const roots = defaultRoots();
      // After a wipe or a restore the bridge starts again: its memory (stats,
      // bans, settings) must be read afresh. systemd brings it back (Restart=on-failure).
      const restartBridge = (): void => { setTimeout(() => process.exit(75), 1500); };
      const gameStopped = async (): Promise<boolean> => (await ctx.power.status()).phase === 'stopped';
      if (path === '/api/backups') {
        const b = await createDataBackup(roots, 'manual');
        const pruned = await prune(roots, (await readBackupSettings()).keep);
        await audit({ action: 'backup made', detail: `${b.name} (${Math.round(b.size / 1024)} KB)${pruned ? ` · xoá ${pruned} bản cũ` : ''}`, ok: true });
        sendJson(res, 200, b);
        return;
      }
      if (path === '/api/backup-settings') {
        const saved = await saveBackupSettings(await readJsonBody(req));
        await audit({ action: 'backup settings saved', detail: `tự backup khi restart định kỳ: ${saved.atScheduledRestart ? 'bật' : 'tắt'} · giữ ${saved.keep} bản`, ok: true });
        sendJson(res, 200, saved);
        return;
      }
      if (path === '/api/backups/export-settings') {
        const b = await exportSettings(roots);
        await audit({ action: 'settings exported', detail: `${b.name}${b.skipped.length ? ` · không đọc được: ${b.skipped.join(', ')}` : ''}`, ok: true });
        sendJson(res, 200, b);
        return;
      }
      const del = /^\/api\/backups\/file\/([^/]+)$/.exec(path);
      if (del) {
        const name = decodeURIComponent(del[1] as string);
        await deleteBackup(roots, name);
        await audit({ action: 'backup deleted', detail: name, ok: true });
        sendJson(res, 200, { ok: true });
        return;
      }
      if (!(await gameStopped())) { sendJson(res, 409, { error: 'Tắt server trước (Server → Vận hành → Tắt server), rồi làm lại.' }); return; }
      if (path === '/api/backups/wipe') {
        const body = (await readJsonBody(req)) as { parts?: unknown; confirm?: unknown };
        if (body.confirm !== 'XOA DU LIEU') throw new ValidationError('gõ đúng "XOA DU LIEU" để xác nhận');
        const parts = Array.isArray(body.parts) ? body.parts.filter((p): p is DataPart => DATA_PARTS.some((d) => d.key === p)) : [];
        if (parts.length === 0) throw new ValidationError('chọn ít nhất một phần để xoá');
        const b = await createDataBackup(roots, 'before-wipe');
        const done = await wipe(roots, parts);
        await audit({ action: 'server data wiped', detail: `${done.join(', ')} · backup trước: ${b.name}`, ok: true });
        sendJson(res, 200, { ok: true, wiped: done, backup: b.name });
        restartBridge();
        return;
      }
      if (path === '/api/backups/restore') {
        // From a backup on the VPS (?name=…) or from a file sent in the body (moving VPS).
        const name = url.searchParams.get('name');
        let archive: string;
        let uploaded = false;
        if (name) {
          archive = backupPath(roots, name);
        } else {
          archive = `${roots.backups}/upload-${Date.now()}.tar.gz`;
          uploaded = true;
          await new Promise<void>((resolve, reject) => {
            let size = 0;
            const out = createWriteStream(archive, { mode: 0o600 });
            req.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > 1024 * 1024 * 1024) { req.destroy(); reject(new ValidationError('file quá lớn (tối đa 1 GB)')); }
            });
            req.pipe(out);
            out.on('finish', () => resolve());
            out.on('error', reject);
            req.on('error', reject);
          });
        }
        try {
          const before = await createDataBackup(roots, 'before-restore');
          const r = await restore(roots, archive);
          await audit({ action: 'backup restored', detail: `${name ?? 'file tải lên'} · ${r.kind} (${r.parts.join(', ')}, ${r.files} file) · backup trước: ${before.name}`, ok: true });
          sendJson(res, 200, { ok: true, ...r, backup: before.name });
        } finally {
          if (uploaded) await unlinkFile(archive).catch(() => undefined);
        }
        restartBridge();
        return;
      }
    }

    if (path === '/api/ddos') {
      if (!ctx.ddos) { sendJson(res, 503, { error: 'DDoS watch is not running' }); return; }
      const before = ctx.ddos.settings;
      const saved = await saveDdos(await readJsonBody(req));
      ctx.ddos.settings = saved;
      await audit({ action: 'DDoS alert settings saved', detail: describeChanges({ ...before }, { ...saved }) || 'không đổi gì', ok: true });
      sendJson(res, 200, saved);
      return;
    }

    if (path === '/api/discord/register-commands') {
      const body = (await readJsonBody(req)) as { appId?: unknown; botToken?: unknown };
      const done = await registerCommands(body.appId, body.botToken);
      // The token is used for this one call and never written anywhere.
      await audit({ action: 'Discord slash commands registered', detail: `app ${String(body.appId)} · ${done.join(', ')}`, ok: true });
      sendJson(res, 200, { ok: true, commands: done });
      return;
    }

    if (path === '/api/discord' || path === '/api/discord/test') {
      if (!ctx.discord) { sendJson(res, 503, { error: 'Discord log is not running' }); return; }
      if (path === '/api/discord/test') {
        const body = (await readJsonBody(req)) as { channel?: unknown };
        const error = await ctx.discord.test(String(body.channel ?? ''), name ?? 'admin');
        sendJson(res, error === null ? 200 : 502, error === null ? { ok: true } : { error });
        return;
      }
      const before = ctx.discord.settings;
      const saved = await ctx.discord.save(await readJsonBody(req));
      await ctx.discord.refreshInfo(true);
      // Never the URLs in the audit: names and routes only.
      const view = (s: typeof saved): Record<string, unknown> => ({ enabled: s.enabled, channels: s.channels.map((c) => c.name), routes: s.routes, mentions: s.mentions, relay: s.relay?.url ?? null });
      await audit({ action: 'Discord log saved', detail: describeChanges(view(before), view(saved)) || 'không đổi gì', ok: true });
      sendJson(res, 200, { ...(publicView(saved) as object), kinds: DISCORD_KINDS, status: ctx.discord.status() });
      return;
    }

    if (path === '/api/svip') {
      const before = await readSvip();
      const saved = await saveSvip(await readJsonBody(req), name ?? login.steamId ?? null);
      const ids = (s: typeof saved): string => s.players.map((p) => p.steamId).join(', ');
      await audit({ action: 'SVip saved', detail: describeChanges({ svip: ids(before), ...featureLevels(before) }, { svip: ids(saved), ...featureLevels(saved) }) || 'không đổi gì', ok: true });
      // Their garage tier at once (member-tier.ts; the minute's sweep does it too).
      await syncGarageMembers().catch((e: unknown) => console.error('[garage] members:', e));
      sendJson(res, 200, svipView(saved));
      return;
    }

    if (path === '/api/economy/settings') {
      const before = await readEconomySettings();
      const saved = await saveEconomySettings(await readJsonBody(req));
      await audit({ action: 'economy settings', detail: describeChanges({ ...before, checkinRewards: before.checkinRewards.join('/') },
        { ...saved, checkinRewards: saved.checkinRewards.join('/') }) || 'không đổi gì', ok: true });
      sendJson(res, 200, { settings: saved });
      return;
    }
    if (path === '/api/quests') {
      const before = await readQuestSettings();
      const saved = await saveQuestSettings(await readJsonBody(req));
      const sum = (q: typeof saved): Record<string, string> => ({ perDay: String(q.perDay),
        ...Object.fromEntries(q.defs.map((d) => [d.id, `${d.enabled ? '' : '(tắt) '}${d.label} ${d.target} → ${d.reward}`])) });
      await audit({ action: 'quests settings', detail: describeChanges(sum(before), sum(saved)) || 'không đổi gì', ok: true });
      sendJson(res, 200, { settings: saved });
      return;
    }
    if (path === '/api/shop') {
      const before = await readShop();
      const saved = await saveShop(await readJsonBody(req));
      const names = new Map((await listItems()).map((i) => [i.id, i.name]));
      const sum = (ls: typeof saved): Record<string, string> => Object.fromEntries(ls.map((l) =>
        [names.get(l.itemId) ?? l.itemId, `${l.enabled ? '' : '(tắt) '}${l.price} Hổ phách, ${l.dailyLimit || 'không giới hạn'}/ngày`]));
      await audit({ action: 'shop settings', detail: describeChanges(sum(before), sum(saved)) || 'không đổi gì', ok: true });
      sendJson(res, 200, { listings: saved });
      return;
    }
    if (path === '/api/economy/adjust') {
      const body = (await readJsonBody(req)) as { steamId?: unknown; delta?: unknown; reason?: unknown };
      const steamId = typeof body.steamId === 'string' ? body.steamId.trim() : '';
      const delta = typeof body.delta === 'number' ? body.delta : NaN;
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      const line = await credit(steamId, delta, reason, name ?? login.steamId ?? null);
      await audit({ action: 'Hổ phách', detail: `${delta > 0 ? '+' : ''}${delta} ${CURRENCY} cho ${ctx.store.player(steamId)?.player.name ?? steamId} (còn ${line.balance}): ${reason}`, ok: true });
      sendJson(res, 200, { line });
      return;
    }

    if (path === '/api/panel-access') {
      const body = (await readJsonBody(req)) as { ips?: unknown };
      const before = await readAccess();
      const saved = await saveAccess(body.ips, login.ip);
      await audit({ action: 'panel allowed IPs saved', detail: describeChanges({ ips: before.ips }, { ips: saved.ips }) || 'không đổi gì', ok: true });
      sendJson(res, 200, { ...saved, yourIp: login.ip, yourRule: login.ip ? ruleFor(login.ip) : null, webEnabled: config.panel.baseUrl !== null });
      return;
    }

    if (path === '/api/voice-settings') {
      const before = await readVoiceSettings();
      const saved = await saveVoiceSettings(await readJsonBody(req));
      await audit({ action: 'voice settings saved', detail: describeChanges({ ...before }, { ...saved }) || 'không đổi gì', ok: true });
      sendJson(res, 200, saved);
      return;
    }

    if (path === '/api/restore-life') {
      // A dino the player played, back in their garage as it was before it died (life-history.ts).
      const body = (await readJsonBody(req)) as { steamId?: unknown; spawnedAt?: unknown; slot?: unknown; overwrite?: unknown } | null;
      const steamId = String(body?.steamId ?? '');
      const spawnedAt = Number(body?.spawnedAt);
      if (!/^\d{17}$/.test(steamId) || !Number.isInteger(spawnedAt)) { sendJson(res, 400, { error: 'steamId and spawnedAt' }); return; }
      const slot = typeof body?.slot === 'string' && body.slot !== '' ? body.slot : `khoiphuc-${spawnedAt}`;
      const { life } = await restoreLife(steamId, spawnedAt, slot, body?.overwrite === true);
      await audit({ action: 'life restored to garage',
        detail: `${steamId}/${slot} · ${life.species} ${Math.round((life.growth ?? 0) * 100)}% · nhiệm vụ ${life.prime?.done ?? '?'}/10${life.prime?.prime ? ' · prime' : ''} · đời từ ${new Date(spawnedAt * 1000).toISOString()}`,
        ok: true });
      sendJson(res, 201, { slot, life });
      return;
    }

    if (path === '/api/light-test') {
      // Admin test: a light on one player's dino (garage/light.lua), or off it.
      const body = (await readJsonBody(req)) as { steamId?: unknown; on?: unknown } | null;
      const cmd = await queueLightTest(String(body?.steamId ?? ''), body?.on);
      await audit({ action: 'light test', detail: `${cmd.steamId} · ${body?.on ? 'gắn đèn' : 'gỡ đèn'}`, ok: true });
      sendJson(res, 202, { id: cmd.id });
      return;
    }

    if (path === '/api/prime-fixes') {
      const body = (await readJsonBody(req)) as { id?: unknown } | null;
      const fix = await addPrimeFix(body);
      const conds = Object.entries(fix.primeData).filter(([k, v]) => k.startsWith('cond') && v).map(([k]) => k.slice(4)).join(',');
      await audit({
        action: body?.id !== undefined ? 'prime fix updated' : 'prime fix added',
        detail: `${fix.id} · ${fix.steamId} · ${fix.species} ${Math.round(fix.minGrowth * 100)}–${Math.round(fix.maxGrowth * 100)}% · điều kiện ${conds || '-'}${fix.prime ? ' · prime' : ''}${fix.primeAt !== null ? ` · prime nếu ≥ ${Math.round(fix.primeAt * 100)}%` : ''}${fix.note ? ' · ' + fix.note : ''}`,
        ok: true,
      });
      sendJson(res, 200, fix);
      return;
    }

    if (path === '/api/garage-settings') {
      const before = await readGarageSettings();
      const saved = await saveGarageSettings(await readJsonBody(req));
      const flat = ({ tiers, ...rest }: typeof saved): Record<string, unknown> => ({ ...rest,
        vipMaxSlots: tiers.vip.maxSlots, vipCooldown: tiers.vip.cooldown, svipMaxSlots: tiers.svip.maxSlots, svipCooldown: tiers.svip.cooldown });
      await audit({ action: 'garage settings saved', detail: describeChanges(flat(before), flat(saved)) || 'không đổi gì', ok: true });
      sendJson(res, 200, saved);
      return;
    }

    if (path === '/api/game-config') {
      const body = (await readJsonBody(req)) as { settings?: unknown; restart?: { countdownSeconds?: unknown; reason?: unknown } };
      // "Before" is what the game really had: the panel's value, else the live Game.ini's.
      const live = await readLive();
      const settings = await saveSettings(body.settings ?? {});
      const keys = new Set([...Object.keys(live.settings), ...Object.keys(settings)]);
      const was: Record<string, unknown> = {};
      const is: Record<string, unknown> = {};
      for (const k of keys) {
        was[k] = k in live.settings ? live.settings[k] : live.effective[k];
        is[k] = settings[k];
      }
      await audit({ action: 'game config saved', detail: describeChanges(was, is) || 'không đổi gì', ok: true });
      // A VIP or an admin added / removed: their garage tier at once.
      await syncGarageMembers().catch((e: unknown) => console.error('[garage] members:', e));
      let operation = null;
      if (body.restart) {
        operation = power.request('restart', {
          countdownSeconds: Number(body.restart.countdownSeconds ?? 0),
          reason: typeof body.restart.reason === 'string' && body.restart.reason ? body.restart.reason : 'Áp dụng cấu hình mới',
          source: 'config',
        });
      }
      sendJson(res, 200, { settings, operation });
      return;
    }

    if (note !== null) {
      const name = decodeURIComponent(note[1] as string);
      const body = (await readJsonBody(req)) as { description?: unknown };
      const saved = await setNote(name, body.description ?? '');
      await audit({ action: `mutation note ${saved ? 'set' : 'cleared'}`, detail: name, ok: true });
      sendJson(res, 200, { name, note: saved });
      return;
    }

    if (adminAct !== null) {
      // The game's /adminpanel actions on a player's dino (commands.ts, mods/DinoGarage garage/admin.lua).
      const steamId = adminAct[1] as string;
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const who = store.player(steamId)?.player;
      if (!who?.online) { sendJson(res, 409, { error: 'người chơi không online' }); return; }
      let action: Record<string, unknown> = body;
      let where = '';
      if (body['action'] === 'teleport') {
        // To another player (next to them), or to a spot on the map: the ground
        // point nearest to it within 50 m (somewhere a dino really stood, no
        // height to guess, nothing under the landscape).
        const toPlayer = typeof body['toPlayer'] === 'string' ? store.player(body['toPlayer'])?.player : undefined;
        const to = body['to'] as { x?: unknown; y?: unknown } | undefined;
        if (toPlayer) {
          if (!toPlayer.loc || typeof toPlayer.loc.z !== 'number') { sendJson(res, 409, { error: 'chưa biết vị trí người chơi đích' }); return; }
          action = { action: 'teleport', x: toPlayer.loc.x + 400, y: toPlayer.loc.y, z: toPlayer.loc.z + TELEPORT_DROP_CM / 2 };
          where = `tới ${toPlayer.name ?? body['toPlayer']}`;
        } else if (to && typeof to.x === 'number' && typeof to.y === 'number') {
          const tx = to.x, ty = to.y;
          const near = store.groundPoints.within(tx, ty, 5000, 400)
            .sort((a, b) => ((a[0] - tx) ** 2 + (a[1] - ty) ** 2) - ((b[0] - tx) ** 2 + (b[1] - ty) ** 2))[0];
          if (!near) { sendJson(res, 409, { error: 'không có điểm mặt đất nào trong 50 m quanh chỗ chọn (chỗ chưa ai đi qua), chọn chỗ khác' }); return; }
          action = { action: 'teleport', x: near[0], y: near[1], z: near[2] + TELEPORT_DROP_CM };
          where = `tới ${near[0]}, ${near[1]} (cách chỗ chọn ${Math.round(Math.hypot(near[0] - tx, near[1] - ty) / 100)} m)`;
        } else {
          sendJson(res, 400, { error: 'teleport needs to: { x, y } or toPlayer' });
          return;
        }
      }
      const command = await queueAdminAction(steamId, action);
      const detail = command.type === 'admin'
        ? (command.action === 'vitals' ? Object.entries(command.values).map(([k, v]) => `${k} ${Math.round((v ?? 0) * 100)}%`).join(', ')
          : command.action === 'grow' ? `${Math.round(command.growth * 100)}%${command.prime ? ' + prime' : ''}` : where)
        : '';
      await audit({ action: `admin action ${command.type === 'admin' ? command.action : ''}`, detail: `${who.name ?? steamId} (${steamId})${detail ? ' · ' + detail : ''} · command ${command.id}`, ok: true });
      sendJson(res, 202, { command });
      return;
    }

    if (kill !== null) {
      const steamId = kill[1] as string;
      const body = (await readJsonBody(req)) as { reason?: unknown };
      const command = await queueKill(steamId, body.reason);
      await audit({ action: 'kill current dino queued', detail: `${steamId} · command ${command.id}${command.reason ? ' · ' + command.reason : ''}`, ok: true });
      sendJson(res, 202, { command });
      return;
    }

    const [, steamId, slot] = garage as unknown as [string, string, string];
    if (req.method === 'DELETE') {
      const { trashedAs } = await deleteSlot(steamId, slot);
      await audit({ action: 'garage slot deleted', detail: `${steamId}/${slot} → deleted/${trashedAs ?? '(index only)'}`, ok: true });
      sendJson(res, 200, { steamId, slot, trashedAs });
      return;
    }
    const body = (await readJsonBody(req)) as NewSlotSpec;
    await assertMutationsFor(store, body);
    const meta = await createSlot(steamId, slot, body);
    await audit({
      action: 'garage slot created',
      detail: `${steamId}/${slot} · ${meta.classPath.split('.').pop()} ${Math.round((meta.growth ?? 0) * 100)}%`
        + (meta.replaced ? ` · replaced (backup deleted/${meta.replaced})` : ''),
      ok: true,
    });
    sendJson(res, 201, { steamId, slot, meta });
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  // --- reads ----------------------------------------------------------
  const slotMatch = /^\/api\/garage\/([^/]+)\/([^/]+)$/.exec(path);
  if (slotMatch !== null) {
    const [, steamId, slot] = slotMatch as unknown as [string, string, string];
    const state = await readSlot(steamId, slot);
    if (state === null) {
      sendJson(res, 404, { error: 'slot not found' });
      return;
    }
    sendJson(res, 200, { steamId, slot, state });
    return;
  }

  // Every dino a player played, with its mutations, prime tasks and skin (life-history.ts).
  const livesMatch = /^\/api\/lives\/(\d{17})$/.exec(path);
  if (livesMatch !== null) {
    sendJson(res, 200, { lives: await lifeDetails(livesMatch[1] as string) });
    return;
  }

  const playerMatch = /^\/api\/garage\/([^/]+)$/.exec(path);
  if (playerMatch !== null) {
    const steamId = playerMatch[1] as string;
    sendJson(res, 200, { steamId, slots: await listPlayer(steamId) });
    return;
  }

  // The whole path of one life (spawnedAt from the lives list), for the map.
  const pathMatch = /^\/api\/player\/([^/]+)\/path\/(\d{1,12})$/.exec(path);
  if (pathMatch !== null) {
    const steamId = pathMatch[1] as string;
    const spawnedAt = Number(pathMatch[2]);
    const points = store.path(steamId, spawnedAt);
    if (points === null) {
      sendJson(res, 404, { error: 'no path for that life (only the last few lives are kept)' });
      return;
    }
    const life = store.player(steamId)?.lives.find((l) => l.spawnedAt === spawnedAt) ?? null;
    sendJson(res, 200, { steamId, spawnedAt, species: life?.species ?? null, endedAt: life?.endedAt ?? null, end: life?.end ?? null, points });
    return;
  }

  const detailMatch = /^\/api\/player\/([^/]+)$/.exec(path);
  if (detailMatch !== null) {
    const steamId = detailMatch[1] as string;
    const detail = store.player(steamId);
    // A player can have a garage without any event yet: an admin put a dino
    // there before they ever joined.
    const garage = isSteamId(steamId) ? await readPlayerGarage(steamId) : [];
    if (detail === null && garage.length === 0) {
      sendJson(res, 404, { error: 'player not seen' });
      return;
    }
    sendJson(res, 200, {
      steamId,
      player: detail?.player ?? null,
      timeline: (detail?.timeline ?? []).filter((e) => !isHiddenChat(e)),
      lives: detail?.lives ?? [],
      garage,
    });
    return;
  }

  switch (path) {
    case '/api/players': {
      // With each player's garage: how many dinos stored, of the slots allowed.
      const [index, gs, tiers] = await Promise.all([listAll(), readGarageSettings(), memberTiers()]);
      sendJson(res, 200, {
        players: store.players().map((p) => ({ ...p, garage: Object.keys(index.players[p.steamId] ?? {}).length,
          // Their garage by tier (garage.ts garageRuleFor): null = no limit.
          garageMax: garageRuleFor(gs, tiers[p.steamId] ?? 'normal').maxSlots, tier: tiers[p.steamId] ?? 'normal',
          // Serving a prison sentence: shown as [Tù] (prison.ts).
          ...(ctx.prison?.isInmate(p.steamId) ? { prison: ctx.prison.playerView(p.steamId) } : {}) })),
        garageMax: gs.maxSlots,
      });
      return;
    }
    case '/api/online':
      sendJson(res, 200, { players: store.online() });
      return;
    case '/api/feed':
      sendJson(res, 200, { events: store.feed(parseLimit(url, 100, 500), parseTypes(url)).filter((e) => !isHiddenChat(e)) });
      return;
    case '/api/kill-scene': {
      // The scene of one death (kill-scene.ts): ?steamId=<who died>&t=<the death's unix time>.
      const steamId = url.searchParams.get('steamId') ?? '';
      const t = Number(url.searchParams.get('t'));
      if (!/^\d{17}$/.test(steamId) || !Number.isInteger(t)) { sendJson(res, 400, { error: 'steamId and t are required' }); return; }
      const scene = ctx.killScenes?.get(steamId, t) ?? null;
      if (scene === null) { sendJson(res, 404, { error: 'no scene for this death' }); return; }
      sendJson(res, 200, scene);
      return;
    }
    case '/api/killfeed':
      sendJson(res, 200, { events: store.killfeed(parseLimit(url, 100, 500)) });
      return;
    case '/api/damage-reach':
      // Người chơi → Sát thương: each species' usual bite reach as learned, and the far bites (damage-reach.ts).
      sendJson(res, 200, { rules: REACH_RULES, groups: store.reach.groups(), far: store.farBites(parseLimit(url, 200, 500)) });
      return;
    case '/api/chat': {
      // Lines the super admin deleted are left out; they alone get each line's key (to delete).
      const sup = isSuper(login.steamId);
      sendJson(res, 200, { events: store.chat(parseLimit(url, 200, 1000)).filter((e) => !isHiddenChat(e))
        .map((e) => (sup && e.type === 'chat' ? { ...e, key: chatKey(e) } : e)) });
      return;
    }
      return;
    case '/api/traffic': {
      // The panel's "Truy cập": the last N days (7–120), the distinct counts over them, launchers by version.
      if (!ctx.traffic) { sendJson(res, 404, { error: 'traffic not counted here' }); return; }
      // ?from=YYYY-MM-DD&to=YYYY-MM-DD (one day: hour by hour); without them the last 30 days.
      const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
      const from = url.searchParams.get('from'); const to = url.searchParams.get('to');
      if (from !== null && to !== null) {
        if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) { sendJson(res, 400, { error: 'from / to: YYYY-MM-DD, from ≤ to' }); return; }
        sendJson(res, 200, ctx.traffic.range(from, to));
        return;
      }
      const days = Math.max(7, Math.min(KEEP_DAYS, Number(url.searchParams.get('days')) || 30));
      sendJson(res, 200, { ...ctx.traffic.view(days), versions: ctx.traffic.versions(7) });
      return;
    }
    case '/api/leaderboard':
      sendJson(res, 200, store.leaderboard());
      return;
    case '/api/server/status':
      sendJson(res, 200, await serverStatus(ctx));
      return;
    case '/api/server/growth-events': {
      // Each event with the daily restarts that start / end it (it is applied at a start only).
      const schedule = await readSchedule();
      const nowS = Math.floor(Date.now() / 1000);
      sendJson(res, 200, {
        events: readGrowthEvents(config.dataDir).filter((e) => e.end > nowS - 86400).map((e) => ({
          ...e, appliesAt: firstDailyAt(schedule.daily, Math.max(e.start, nowS)), endsAt: firstDailyAt(schedule.daily, e.end),
        })),
        applied: readGrowthApplied(config.dataDir),
        daily: schedule.daily,
        limits: { min: GROWTH_MIN, max: GROWTH_MAX },
      });
      return;
    }
    case '/api/server/readiness': {
      const status = await power.status();
      const join = store.feed(1, new Set(['session_start']))[0];
      sendJson(res, 200, await readReadiness({
        unit: status.unit ? { activeState: status.unit.activeState, since: status.unit.since } : null,
        phase: status.phase,
        modsLoadedAt: status.modsLoadedAt,
        lastJoin: join?.type === 'session_start'
          ? { t: join.t, ...(join.name !== undefined ? { name: join.name } : {}) } : null,
      }));
      return;
    }
    case '/api/server/audit': {
      // Paged, newest first; ?q= filters. Lines older than 7 days are gone.
      const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
      const data = await readAuditPage(page, parseLimit(url, 30, 200), url.searchParams.get('q') ?? '');
      sendJson(res, 200, isSuper(login.steamId) ? { ...data, entries: data.entries.map((e) => ({ ...e, key: auditKey(e) })) } : data);
      return;
    }
    case '/api/rcon/commands':
      sendJson(res, 200, {
        enabled: rcon.enabled,
        commands: Object.fromEntries(Object.entries(RCON_COMMANDS).map(([k, c]) =>
          [k, { label: c.label, args: c.args, read: c.read, toggle: c.toggle === true }])),
      });
      return;
    case '/api/game-config': {
      const live = await readLive();
      // Everything but the list item RegExp, which does not survive JSON.
      const schema = Object.fromEntries(Object.entries(MANAGED).map(([k, m]) => {
        const { item: _item, ...rest } = m as ManagedKey & { item?: RegExp };
        return [k, rest];
      }));
      const status = await power.status();
      sendJson(res, 200, {
        ...live,
        schema,
        knownPlayables: KNOWN_PLAYABLES,
        groups: GROUPS,
        // Saved after the server last started = waiting for a restart.
        pendingRestart: live.iniWrittenAt !== null && status.unit?.since != null && live.iniWrittenAt > status.unit.since,
      });
      return;
    }
    case '/api/mutations': {
      // Map every mutation the game has reported to its reference entry, so
      // the panel does not need its own copy of the matching rules.
      const catalog = store.catalog.merge(await readGarageCatalog());
      const matches: Record<string, string> = {};
      for (const entry of catalog.list()) {
        for (const name of Object.keys(entry.evidence)) {
          const ref = findReference(name);
          if (ref !== null) matches[name] = ref.name;
        }
      }
      sendJson(res, 200, {
        notes: await readNotes(),
        reference: MUTATION_REFERENCE,
        referenceChecked: REFERENCE_CHECKED,
        sources: SOURCES,
        matches,
      });
      return;
    }
    case '/api/ai-zones': {
      const zones = await readAiZones();
      sendJson(res, 200, {
        ...zones,
        species: AI_SPECIES.map(({ key, label, kind, cls }) => ({ key, label, kind, cls })),
        playables: KNOWN_PLAYABLES,
        status: await readAiZonesStatus(),
        // How many spawn spots each zone has (0 = nobody has stood there yet).
        points: Object.fromEntries(zones.zones.map((z) => [z.id, zonePoints(z, store.groundPoints).length])),
        groundPoints: store.groundPoints.size,
      });
      return;
    }
    case '/api/ai-reset': {
      sendJson(res, 200, ctx.aiReset ? ctx.aiReset.status() : { current: null, last: null });
      return;
    }
    case '/api/fish-settings': {
      sendJson(res, 200, { settings: await readFishSettings(), species: FISH_SPECIES, census: await readFishCensus(), disallowed: await currentDisallowed() });
      return;
    }
    case '/api/flora-settings': {
      const flora = await readFlora();
      sendJson(res, 200, { settings: await readFloraSettings(), control: flora?.control ?? null, t: flora?.t ?? null });
      return;
    }
    case '/api/map/flora': {
      // The island's real plants and plant areas (Flora mod), or null before its first export.
      sendJson(res, 200, { flora: await readFlora() });
      return;
    }
    case '/api/ai-ambient': {
      sendJson(res, 200, await readAmbient(ctx.rcon));
      return;
    }
    case '/api/ptera-carry': {
      sendJson(res, 200, await readPteraSettings());
      return;
    }
    case '/api/tele-settings': {
      sendJson(res, 200, await readTeleSettings());
      return;
    }
    case '/api/zone-guard': {
      sendJson(res, 200, { ...(await readZoneGuard()), knownSanctuaries: (await readSanctuaries()).map((c) => c.name), species: KNOWN_PLAYABLES });
      return;
    }
    case '/api/messages': {
      sendJson(res, 200, { ...currentMessages(), catalog: MESSAGES });
      return;
    }
    case '/api/news':
      // Tin cập nhật (news.ts): every note, shown or hidden, and the limits the form keeps.
      sendJson(res, 200, { ...(await readNews()), limits: NEWS_LIMITS });
      return;
    case '/api/ai-drop': {
      // The mod's outcome for a drop (null while it has not run it yet).
      const id = Number(url.searchParams.get('id'));
      if (!Number.isInteger(id) || id < 1) { sendJson(res, 400, { error: 'id required' }); return; }
      sendJson(res, 200, { id, result: await dropResult(id) });
      return;
    }
    case '/api/ai-zones/points': {
      // Spots within a circle being drawn (before it is saved), for the panel's preview.
      const x = Number(url.searchParams.get('x'));
      const y = Number(url.searchParams.get('y'));
      const r = Number(url.searchParams.get('r'));
      if (![x, y, r].every(Number.isFinite) || r <= 0 || r > 5000) { sendJson(res, 400, { error: 'x, y, r (metres) required' }); return; }
      sendJson(res, 200, { count: store.groundPoints.within(x, y, r * 100, 200).length });
      return;
    }
    case '/api/species-stats': {
      // Maxima read on this server, by species and growth (species-stats.ts).
      const stats = store.speciesStats.view();
      const species = url.searchParams.get('species');
      if (species === null) { sendJson(res, 200, { species: stats }); return; }
      const one = stats[species] ?? { points: [], prime: null };
      const g = Number(url.searchParams.get('growth'));
      // What the game gives a dino whose growth is set, as the garage does (species-lab.ts).
      const lab = labPoints(species);
      sendJson(res, 200, {
        species, ...one, at: Number.isFinite(g) ? maximaAt(one.points, g) : null,
        lab: lab === null ? null : { points: lab, at: Number.isFinite(g) ? maximaAt(lab, g) : null, measured: SPECIES_LAB_MEASURED },
      });
      return;
    }
    case '/api/catalog': {
      const catalog = store.catalog.merge(await readGarageCatalog());
      sendJson(res, 200, { species: catalog.list() });
      return;
    }
    case '/api/map': {
      // Positions from the live file (1 s) over the snapshot's (5 s).
      const live = await readLiveState();
      const players = store.map().map((p) => {
        const lp = livePlayer(live, p.steamId);
        const base = lp === null ? p : { ...p, loc: lp.loc, yaw: lp.yaw ?? p.yaw, health: lp.vitals.health ?? p.health };
        return ctx.prison?.isInmate(p.steamId) ? { ...base, prison: ctx.prison.playerView(p.steamId) } : base;
      });
      sendJson(res, 200, { players, ai: live?.ai ?? null });
      return;
    }
    case '/api/metrics': {
      const ranges: Record<string, number> = { '1h': 3600, '6h': 6 * 3600, '24h': 86400, '7d': 7 * 86400 };
      const range = ranges[url.searchParams.get('range') ?? '6h'] ?? ranges['6h'] as number;
      if (!ctx.metrics) { sendJson(res, 503, { error: 'metrics not running' }); return; }
      sendJson(res, 200, ctx.metrics.view(range));
      return;
    }
    case '/api/map/live': {
      // Small and cheap: the map polls this every second between full refreshes.
      const live = await readLiveState();
      sendJson(res, 200, live === null ? { t: null, players: [], ai: null } : {
        t: live.t, stale: live.stale,
        players: live.stale ? [] : live.players.map((p) => ({ steamId: p.steamId, loc: p.loc, yaw: p.yaw, health: p.vitals.health })),
        ai: live.ai,
      });
      return;
    }
    case '/api/commands-settings':
      sendJson(res, 200, await readCommandsSettings());
      return;
    case '/api/voice-settings':
      sendJson(res, 200, { ...await readVoiceSettings(), enabled: config.voice !== null, url: config.voice?.publicUrl ?? null });
      return;
    case '/api/garage-settings': {
      // With how many are in each tier (member-tier.ts), for the panel's tier table.
      const tiers = Object.values(await memberTiers());
      const memberCounts = { vip: tiers.filter((t) => t === 'vip').length, svip: tiers.filter((t) => t === 'svip').length, admin: tiers.filter((t) => t === 'admin').length };
      sendJson(res, 200, { ...await readGarageSettings(), memberCounts });
      return;
    }
    case '/api/prime-fixes':
      sendJson(res, 200, { fixes: await listPrimeFixes() });
      return;
    case '/api/prime-last': {
      // The player's last prime tasks for one species (prime-history.ts): the panel's
      // "create a dino" starts from them, so a dino given back keeps its tasks.
      const steamId = url.searchParams.get('steamId') ?? '';
      const species = url.searchParams.get('species') ?? '';
      if (!/^\d{17}$/.test(steamId) || !/^[\w/.]+$/.test(species)) { sendJson(res, 400, { error: 'steamId and species' }); return; }
      sendJson(res, 200, { last: await lastPrimeOf(steamId, species) });
      return;
    }
    case '/api/garage':
      sendJson(res, 200, await listAll());
      return;
    case '/api/health':
      sendJson(res, 200, { ...store.health(), writesEnabled: config.adminToken !== null });
      return;
    // The panel is the React one (web/apps/panel, built into public/next/ by deploy.sh); its pages
    // are #addresses, so this is its only page. /next/ (where it was tried first) still opens it.
    case '/':
    case '/next/':
      await sendFile(res, 'next/index.html');
      return;
    case '/next':
      res.writeHead(302, { location: '/next/' });
      res.end();
      return;
    // The panel before React was here until 2026-10-07 (removed; git tag old-sites-20261007): an old
    // bookmark goes to the panel, on the same page (a redirect without a #fragment keeps the browser's).
    case '/old':
    case '/old/':
      res.writeHead(302, { location: '/' });
      res.end();
      return;
    default:
      // The skin page's 3D: the portal's own viewer and models (config.portalPublicDir).
      // …and the skin colour editor, shared with the players' Skin Studio (skin-editor.js).
      // (/img/, the mutation icons too, comes from bridge public/img, before this: panel-gate.ts.)
      // The Hổ phách icon (amber.svg), one file for the portal and the panel.
      if (path === '/skin3d.js' || path === '/skin-editor.js' || path === '/ui-select.js' || path === '/ui-inputs.js' || path === '/mut-icons.js' || path === '/amber.svg'
        || path.startsWith('/dino3d/') || path.startsWith('/vendor/three-0.170.0/')) {
        await sendFile(res, path.slice(1), config.portalPublicDir);
        return;
      }
      await sendFile(res, path.slice(1));
      return;
  }
}

export function startServer(ctx: Ctx): void {
  svipNames = (id) => ctx.store.player(id)?.player.name ?? null;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res, ctx).catch((error: unknown) => {
      if (error instanceof ValidationError) {
        sendJson(res, 400, { error: error.message });
        return;
      }
      if (error instanceof ConflictError) {
        sendJson(res, 409, { error: error.message });
        return;
      }
      if (error instanceof NotFoundError) {
        sendJson(res, 404, { error: error.message });
        return;
      }
      console.error('[http] unhandled:', error);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    });
  });

  server.listen(config.http.port, config.http.host, () => {
    console.info(`[http] listening on http://${config.http.host}:${config.http.port}`);
  });
}
