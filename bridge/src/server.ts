import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { config } from './config.js';
import type { Store } from './store.js';
import { queueKill } from './commands.js';
import { readNotes, setNote } from './notes.js';
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
} from './garage.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
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
      // after a deploy until someone thinks to hard-reload.
      'cache-control': 'no-cache',
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

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  store: Store,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  // --- writes ---------------------------------------------------------
  // POST   /api/garage/<steamId>/<slot>   put a dino straight into a garage
  // DELETE /api/garage/<steamId>/<slot>   remove one (soft: moved to deleted/)
  // POST   /api/player/<steamId>/kill     remove the dino they are playing now
  // PUT    /api/mutations/<name>          { description } — "" clears it
  if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT') {
    const garage = /^\/api\/garage\/([^/]+)\/([^/]+)$/.exec(path);
    const kill = /^\/api\/player\/([^/]+)\/kill$/.exec(path);
    const note = /^\/api\/mutations\/([^/]+)$/.exec(path);
    const allowed =
      (garage !== null && req.method !== 'PUT') ||
      (kill !== null && req.method === 'POST') ||
      (note !== null && req.method === 'PUT');
    if (!allowed) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    const denied = authorizeWrite(req);
    if (denied !== null) {
      sendJson(res, 403, { error: denied });
      return;
    }

    if (note !== null) {
      const name = decodeURIComponent(note[1] as string);
      const body = (await readJsonBody(req)) as { description?: unknown };
      const saved = await setNote(name, body.description ?? '');
      console.info(`[admin] mutation note ${saved ? 'set' : 'cleared'} for ${name}`);
      sendJson(res, 200, { name, note: saved });
      return;
    }

    if (kill !== null) {
      const steamId = kill[1] as string;
      const body = (await readJsonBody(req)) as { reason?: unknown };
      const command = await queueKill(steamId, body.reason);
      console.info(`[admin] kill queued for ${steamId} (command ${command.id}) reason="${command.reason}"`);
      sendJson(res, 202, { command });
      return;
    }

    const [, steamId, slot] = garage as unknown as [string, string, string];
    if (req.method === 'DELETE') {
      const { trashedAs } = await deleteSlot(steamId, slot);
      console.info(`[garage] admin deleted ${steamId}/${slot} -> deleted/${trashedAs ?? '(index only)'}`);
      sendJson(res, 200, { steamId, slot, trashedAs });
      return;
    }
    const body = (await readJsonBody(req)) as NewSlotSpec;
    await assertMutationsFor(store, body);
    const meta = await createSlot(steamId, slot, body);
    console.info(
      `[garage] admin wrote ${steamId}/${slot} (${meta.classPath})` +
        (meta.replaced ? `, previous dino kept as deleted/${meta.replaced}` : ''),
    );
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
    case '/api/map':
      sendJson(res, 200, { players: store.map() });
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

export function startServer(store: Store): void {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res, store).catch((error: unknown) => {
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
