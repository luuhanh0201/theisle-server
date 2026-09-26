import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { config } from './config.js';
import type { Store } from './store.js';
import { queueKill } from './commands.js';
import { readNotes, setNote } from './notes.js';
import { actingAs, audit, describeChanges, readAuditPage } from './audit.js';
import { currentLogin, panelGate } from './panel-gate.js';
import { readAccess, ruleFor, saveAccess, sessionSecret, writeAllowed, writeToken } from './panel-auth.js';
import type { Power } from './power.js';
import { readSchedule, writeSchedule, validateSchedule, occurrences } from './power.js';
import type { Rcon } from './rcon.js';
import { RCON_COMMANDS } from './rcon.js';
import { MANAGED, GROUPS, KNOWN_PLAYABLES, readLive, saveSettings, type ManagedKey } from './gameini.js';
import { readReadiness } from './readiness.js';
import { readLiveState, livePlayer } from './live.js';
import type { Metrics } from './metrics.js';
import type { VoiceRoom } from './voice.js';
import { handlePlayerApi, publicServerInfo } from './player-api.js';
import { readCommandsSettings, saveCommandsSettings } from './commands-settings.js';
import { readVoiceSettings, saveVoiceSettings } from './voice-settings.js';
import { speciesOfClassPath } from './catalog.js';
import { maximaAt } from './species-stats.js';
import { AI_SPECIES } from './ai-species.js';
import { readAiZones, readAiZonesStatus, saveAiZones, zonePoints, type AiZonesSettings } from './ai-zones.js';
import { dropResult, queueDrop, validateDrop } from './ai-drop.js';
import { validateReset, type AiReset } from './ai-reset.js';
import { readPteraSettings, savePteraSettings } from './ptera-settings.js';
import { readSanctuaries, readZoneGuard, saveZoneGuard, syncZoneGuard } from './zone-guard.js';
import { DISCORD_KINDS, banChangeLine, publicView, type DiscordLog } from './discord.js';
import {
  PERMANENT_HOURS, banPlayer, banVars, durationText, formatGameTime, parseGameTime, readBans, readReasons, saveReasons, validateBan, validateBanEdit,
  type BanWatcher,
} from './bans.js';
import { readAmbient, setAmbient } from './ai-ambient.js';
import { readFlora } from './flora.js';
import { readFloraSettings, saveFloraSettings } from './flora-settings.js';
import { FISH_SPECIES, currentDisallowed, readFishCensus, readFishSettings, saveFish } from './fish-settings.js';
import { MESSAGES, currentMessages, renderMessage, saveMessages, type MessagesSettings } from './messages.js';
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
  saveGarageSettings,
} from './garage.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function sendFile(res: ServerResponse, name: string): Promise<void> {
  // Only ever serve out of publicDir, whatever the request path looked like.
  const resolved = join(publicDir, normalize(name).replace(/^(\.\.[/\\])+/, ''));
  if (!resolved.startsWith(publicDir)) {
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
      'cache-control': name.startsWith('map/') ? 'public, max-age=604800' : 'no-cache',
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

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
    return 'writes are disabled — set ADMIN_TOKEN to enable them';
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
      `mutation not confirmed on ${species}: ${unconfirmed.join(', ')} — ` +
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
    ...(ctx.voice ? { voice: ctx.voice } : {}) })) return;

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
    });
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
  if (path === '/api/discord/url' && req.method === 'GET') {
    // One saved webhook URL, shown to an admin who asked (the eye on the panel); logged.
    const c = ctx.discord?.settings.channels.find((x) => x.id === url.searchParams.get('channel'));
    if (!c) { sendJson(res, 404, { error: 'no such channel' }); return; }
    await audit({ action: 'Discord webhook URL viewed', detail: c.name, ok: true });
    sendJson(res, 200, { url: c.url });
    return;
  }
  if (path === '/api/discord' && req.method === 'GET') {
    if (!ctx.discord) { sendJson(res, 503, { error: 'Discord log is not running' }); return; }
    await ctx.discord.refreshInfo();
    sendJson(res, 200, { ...(publicView(ctx.discord.settings) as object), kinds: DISCORD_KINDS, status: ctx.discord.status() });
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
  // PUT    /api/mutations/<name>          { description } — "" clears it
  // POST   /api/server/<start|stop|restart|cancel>   { countdownSeconds, reason }
  // PUT    /api/server/schedule           { daily: ["04:00"], countdownMinutes }
  // POST   /api/rcon/<command>            { args }
  // PUT    /api/game-config               { settings, restart?: { countdownSeconds, reason } }
  if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT') {
    const garage = /^\/api\/garage\/([^/]+)\/([^/]+)$/.exec(path);
    const kill = /^\/api\/player\/([^/]+)\/kill$/.exec(path);
    const note = /^\/api\/mutations\/([^/]+)$/.exec(path);
    const power_ = /^\/api\/server\/(start|stop|restart|cancel)$/.exec(path);
    const rconCmd = /^\/api\/rcon\/([A-Za-z]+)$/.exec(path);
    const allowed =
      (garage !== null && req.method !== 'PUT') ||
      (kill !== null && req.method === 'POST') ||
      (note !== null && req.method === 'PUT') ||
      (power_ !== null && req.method === 'POST') ||
      (rconCmd !== null && req.method === 'POST') ||
      (path === '/api/server/schedule' && req.method === 'PUT') ||
      (path === '/api/game-config' && req.method === 'PUT') ||
      (path === '/api/garage-settings' && req.method === 'PUT') ||
      (path === '/api/commands-settings' && req.method === 'PUT') ||
      (path === '/api/voice-settings' && req.method === 'PUT') ||
      (path === '/api/panel-access' && req.method === 'PUT') ||
      (path === '/api/ai-zones' && req.method === 'PUT') ||
      (path === '/api/ai-drop' && req.method === 'POST') ||
      (path === '/api/messages' && req.method === 'PUT') ||
      (path === '/api/ptera-carry' && req.method === 'PUT') ||
      (path === '/api/zone-guard' && req.method === 'PUT') ||
      (path === '/api/discord' && req.method === 'PUT') ||
      (path === '/api/bans' && req.method === 'POST') ||
      ((path === '/api/bans/unban' || path === '/api/bans/edit') && req.method === 'POST') ||
      (path === '/api/ban-reasons' && req.method === 'PUT') ||
      (path === '/api/discord/test' && req.method === 'POST') ||
      (path === '/api/flora-settings' && req.method === 'PUT') ||
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
      const view = (s: typeof saved): Record<string, unknown> => ({ enabled: s.enabled, channels: s.channels.map((c) => c.name), routes: s.routes });
      await audit({ action: 'Discord log saved', detail: describeChanges(view(before), view(saved)) || 'không đổi gì', ok: true });
      sendJson(res, 200, { ...(publicView(saved) as object), kinds: DISCORD_KINDS, status: ctx.discord.status() });
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

    if (path === '/api/garage-settings') {
      const before = await readGarageSettings();
      const saved = await saveGarageSettings(await readJsonBody(req));
      await audit({ action: 'garage settings saved', detail: describeChanges({ ...before }, { ...saved }) || 'không đổi gì', ok: true });
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
      timeline: detail?.timeline ?? [],
      lives: detail?.lives ?? [],
      garage,
    });
    return;
  }

  switch (path) {
    case '/api/players':
      sendJson(res, 200, { players: store.players() });
      return;
    case '/api/online':
      sendJson(res, 200, { players: store.online() });
      return;
    case '/api/feed':
      sendJson(res, 200, { events: store.feed(parseLimit(url, 100, 500), parseTypes(url)) });
      return;
    case '/api/killfeed':
      sendJson(res, 200, { events: store.killfeed(parseLimit(url, 100, 500)) });
      return;
    case '/api/chat':
      sendJson(res, 200, { events: store.chat(parseLimit(url, 200, 1000)) });
      return;
    case '/api/leaderboard':
      sendJson(res, 200, store.leaderboard());
      return;
    case '/api/server/status':
      sendJson(res, 200, await serverStatus(ctx));
      return;
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
      sendJson(res, 200, await readAuditPage(page, parseLimit(url, 30, 200), url.searchParams.get('q') ?? ''));
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
    case '/api/zone-guard': {
      sendJson(res, 200, { ...(await readZoneGuard()), knownSanctuaries: (await readSanctuaries()).map((c) => c.name), species: KNOWN_PLAYABLES });
      return;
    }
    case '/api/messages': {
      sendJson(res, 200, { ...currentMessages(), catalog: MESSAGES });
      return;
    }
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
      sendJson(res, 200, { species, ...one, at: Number.isFinite(g) ? maximaAt(one.points, g) : null });
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
        return lp === null ? p : { ...p, loc: lp.loc, yaw: lp.yaw ?? p.yaw, health: lp.vitals.health ?? p.health };
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
    case '/api/garage-settings':
      sendJson(res, 200, await readGarageSettings());
      return;
    case '/api/garage':
      sendJson(res, 200, await listAll());
      return;
    case '/api/health':
      sendJson(res, 200, { ...store.health(), writesEnabled: config.adminToken !== null });
      return;
    case '/':
      await sendFile(res, 'index.html');
      return;
    default:
      await sendFile(res, path.slice(1));
      return;
  }
}

export function startServer(ctx: Ctx): void {
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
