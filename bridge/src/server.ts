import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { config } from './config.js';
import type { Store } from './store.js';
import { queueKill } from './commands.js';
import { readNotes, setNote } from './notes.js';
import { audit, readAudit } from './audit.js';
import type { Power } from './power.js';
import { readSchedule, writeSchedule, validateSchedule, occurrences } from './power.js';
import type { Rcon } from './rcon.js';
import { RCON_COMMANDS } from './rcon.js';
import { MANAGED, GROUPS, KNOWN_PLAYABLES, readLive, saveSettings, type ManagedKey } from './gameini.js';
import { readReadiness } from './readiness.js';
import { readLiveState, livePlayer } from './live.js';
import { handlePlayerApi } from './player-api.js';
import { readCommandsSettings, saveCommandsSettings } from './commands-settings.js';
import { speciesOfClassPath } from './catalog.js';
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
 * Write endpoints edit player data and this service has no user accounts, so
 * they fail closed: with ADMIN_TOKEN unset, nothing can write at all.
 */
function authorizeWrite(req: IncomingMessage): string | null {
  if (config.adminToken === null) {
    return 'writes are disabled — set ADMIN_TOKEN to enable them';
  }
  const supplied = req.headers['x-admin-token'];
  if (typeof supplied !== 'string' || supplied !== config.adminToken) {
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

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: Ctx,
): Promise<void> {
  const { store, power, rcon } = ctx;
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  // The player portal's read-only routes, behind their own token.
  if (await handlePlayerApi(req, res, path, { store, serverPhase: async () => (await power.status()).phase, live: readLiveState })) return;

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
      (path === '/api/commands-settings' && req.method === 'PUT');
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
        sendJson(res, 200, { command: name, response });
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        if (!spec.read) await audit({ action: `rcon ${name}`, ok: false, error: (error as Error).message });
        sendJson(res, 502, { error: (error as Error).message });
      }
      return;
    }

    if (path === '/api/commands-settings') {
      const saved = await saveCommandsSettings(await readJsonBody(req));
      await audit({ action: 'player command settings saved',
        detail: `slay ${saved.slayCooldown}s · unstuck ${saved.unstuckCooldown}s · off: ${Object.entries(saved.enabled).filter(([, on]) => !on).map(([n]) => n).join(', ') || '-'}`, ok: true });
      sendJson(res, 200, saved);
      return;
    }

    if (path === '/api/garage-settings') {
      const saved = await saveGarageSettings(await readJsonBody(req));
      await audit({ action: 'garage settings saved',
        detail: `redeemAt=${saved.redeemAt} · slots ${saved.maxSlots} · countdown ${saved.storeCountdown}s · cooldown ${saved.cooldown}s`, ok: true });
      sendJson(res, 200, saved);
      return;
    }

    if (path === '/api/game-config') {
      const body = (await readJsonBody(req)) as { settings?: unknown; restart?: { countdownSeconds?: unknown; reason?: unknown } };
      const settings = await saveSettings(body.settings ?? {});
      await audit({ action: 'game config saved', detail: Object.keys(settings).join(', ') || '(defaults)', ok: true });
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
    case '/api/server/audit':
      sendJson(res, 200, { entries: await readAudit(parseLimit(url, 50, 500)) });
      return;
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
