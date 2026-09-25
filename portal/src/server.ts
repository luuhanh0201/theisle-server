import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BridgeClient } from './bridge-client.js';
import { RateLimit } from './ratelimit.js';
import { COOKIE, cookieHeader, parseCookies, readSession, sign } from './session.js';
import { loginUrl, NonceCache, verify } from './steam.js';
import type { SteamPost } from './steam-http.js';
import { LauncherLogins, STATE_RE } from './launcher-login.js';

/**
 * Public routes. Every data route is scoped to the SteamID in the signed
 * session cookie — there is no way to ask for someone else's data.
 *
 *   GET  /                      the page (public/)
 *   GET  /auth/steam            → Steam login
 *   GET  /auth/steam/return     ← Steam; sets the session cookie
 *   POST /auth/logout
 *   GET  /api/me                your dino, stats, lives, garage   (login)
 *   GET  /api/leaderboard       top players by name
 *   GET  /api/server            online count, game up or not, name, slots, Discord
 *   GET  /api/ai                the AI alive on the server now          (login)
 *   POST /api/garage            { action: store|redeem, slot?, where? } (login)
 *        your own store / redeem, run in game like the chat command. The only
 *        write: same-origin only (Origin, or Sec-Fetch-Site), JSON only, a
 *        few per minute per player — and the SteamID is the session's.
 *   GET  /api/command/<id>      the outcome of one of your commands      (login)
 *   POST /api/voice/token       join the proximity voice room (voice.html) (login, same-origin)
 *   GET  /api/voice             who you can hear now: volume + pan per voice user (login)
 *   POST /api/voice/range       { range: 15|30|60|90 } how far your voice carries (login, same-origin)
 *   POST /auth/launcher/start   the desktop launcher's Steam login, in the browser (launcher-login.ts)
 *   POST /auth/launcher/claim   { state } → the session, once that browser login is done
 *   GET  /tai/<file>            the launcher's installers and update feed (PORTAL_DOWNLOADS_DIR)
 */

export interface PortalOptions {
  baseUrl: string;
  secureCookies: boolean;
  sessionSecret: string;
  sessionDays: number;
  trustProxy: boolean;
  bridge: BridgeClient;
  steamFetch?: SteamPost;
  /** The LiveKit server players' browsers connect to (wss://…), for the CSP. Empty = no voice. */
  voiceUrl?: string;
  /** Launcher installers + electron-updater feed, served as /tai/<file>. */
  downloadsDir?: string;
}

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.wasm': 'application/wasm',
};

/**
 * No inline scripts anywhere (app.js is a file); styles may be inline. The
 * voice page also talks to the LiveKit server (its own origin, wss:// + https://).
 */
function securityHeaders(voiceUrl: string): Record<string, string> {
  let voice = '';
  if (voiceUrl !== '') {
    const u = new URL(voiceUrl);
    voice = ` ${u.protocol}//${u.host} ${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}`;
  }
  return {
    // 'wasm-unsafe-eval': the voice noise filter (RNNoise) is WebAssembly; it allows compiling
    // wasm only — still no eval() and no scripts from anywhere else.
    'content-security-policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; " +
      `connect-src 'self'${voice}; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'x-frame-options': 'DENY',
    // The microphone for our own pages only (voice.html); nothing else.
    'permissions-policy': 'microphone=(self), camera=(), geolocation=()',
  };
}
let SECURITY_HEADERS = securityHeaders('');

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, to: string, extra: Record<string, string | string[]> = {}): void {
  res.writeHead(302, { ...SECURITY_HEADERS, location: to, 'cache-control': 'no-store', ...extra });
  res.end();
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

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

async function sendStatic(res: ServerResponse, urlPath: string): Promise<void> {
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = normalize(join(publicDir, rel));
  if (!file.startsWith(publicDir + '/') || !TYPES[extname(file)]) { send(res, 404, { error: 'not found' }); return; }
  try {
    const body = await readFile(file);
    // The map (2.5 MB image) is asked for with ?v=<map version>: cache it.
    // vendor/ files carry their version in the name (livekit-client-2.22.3…),
    // so a new version is a new URL: cache them for good.
    const cache = rel.startsWith('map/') ? 'public, max-age=604800'
      : rel.startsWith('vendor/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': TYPES[extname(file)] as string, 'cache-control': cache });
    res.end(body);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

/**
 * Where to land after the Steam login: only these pages (never a URL from the
 * query), remembered for the round trip in a short cookie on /auth.
 */
const AFTER_LOGIN: Record<string, string> = { voice: '/#voice' };
const NEXT_COOKIE = 'isle_next';
const nextCookie = (value: string, maxAge: number, secure: boolean): string =>
  [`${NEXT_COOKIE}=${value}`, 'Path=/auth', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`, ...(secure ? ['Secure'] : [])].join('; ');

const DOWNLOAD_TYPES: Record<string, string> = {
  '.exe': 'application/vnd.microsoft.portable-executable', '.AppImage': 'application/octet-stream',
  '.blockmap': 'application/octet-stream', '.yml': 'text/yaml; charset=utf-8', '.json': 'application/json; charset=utf-8',
};

/** A file from the downloads directory, streamed (installers are ~100 MB). */
async function sendDownload(res: ServerResponse, dir: string, name: string): Promise<void> {
  const type = DOWNLOAD_TYPES[extname(name)];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(name) || type === undefined) { send(res, 404, { error: 'not found' }); return; }
  const file = join(dir, name);
  let size: number;
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    size = st.size;
  } catch {
    send(res, 404, { error: 'not found' });
    return;
  }
  // The update feed and the stable "latest" names change with each release; versioned files never do.
  const changing = /\.(yml|json)$/.test(name) || !/\d+\.\d+\.\d+/.test(name);
  res.writeHead(200, {
    ...SECURITY_HEADERS, 'content-type': type, 'content-length': String(size),
    'cache-control': changing ? 'no-cache' : 'public, max-age=31536000, immutable',
    ...(type.startsWith('application/') && !name.endsWith('.json') ? { 'content-disposition': `attachment; filename="${name}"` } : {}),
  });
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

export function createPortal(opts: PortalOptions): Server {
  SECURITY_HEADERS = securityHeaders(opts.voiceUrl ?? '');
  const nonces = new NonceCache();
  const launcherLogins = new LauncherLogins();
  // Per IP per minute. The page polls /api/me every second (+2 slow calls per
  // 15 s), and players behind one IP (a net café, a household) share it.
  const apiLimit = new RateLimit(600, 60_000);
  const authLimit = new RateLimit(20, 60_000);
  const writeLimit = new RateLimit(12, 60_000);   // per player per minute
  const siteOrigin = new URL(opts.baseUrl).origin;

  /** A write must come from our own page: cookies alone would let another site post. */
  function sameOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (typeof origin === 'string') return origin === siteOrigin;
    return req.headers['sec-fetch-site'] === 'same-origin';
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', opts.baseUrl);
    const path = url.pathname;
    const ip = clientIp(req, opts.trustProxy);
    const me = readSession(opts.sessionSecret, parseCookies(req.headers.cookie)[COOKIE]);

    if (path === '/auth/launcher/claim') {
      if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return; }
      if (!apiLimit.allow(ip)) { send(res, 429, { error: 'too many requests' }); return; }
      const body = await readSmallJson(req);
      const state = body?.['state'];
      if (typeof state !== 'string' || !STATE_RE.test(state)) { send(res, 400, { error: 'bad state' }); return; }
      const r = launcherLogins.claim(state, ip);
      if (r.status !== 'done') { send(res, r.status === 'pending' ? 200 : 410, { status: r.status }); return; }
      const maxAge = opts.sessionDays * 86400;
      send(res, 200, {
        status: 'done',
        cookie: { name: COOKIE, value: sign(opts.sessionSecret, r.steamId, Math.floor(Date.now() / 1000) + maxAge), maxAge },
      });
      return;
    }
    if (path.startsWith('/auth/')) {
      if (!authLimit.allow(ip)) { send(res, 429, { error: 'too many requests' }); return; }
      if (path === '/auth/steam' && req.method === 'GET') {
        const launcher = url.searchParams.get('launcher');
        if (launcher !== null) {
          // Opened by the launcher in this browser: remember which login it waits for.
          if (!STATE_RE.test(launcher) || !launcherLogins.isPending(launcher)) { redirect(res, '/launcher-done.html?error=expired'); return; }
          redirect(res, loginUrl(opts.baseUrl), { 'set-cookie': nextCookie(`launcher.${launcher}`, 600, opts.secureCookies) });
          return;
        }
        const next = url.searchParams.get('next') ?? '';
        redirect(res, loginUrl(opts.baseUrl), AFTER_LOGIN[next] !== undefined
          ? { 'set-cookie': nextCookie(next, 600, opts.secureCookies) } : {});
        return;
      }
      if (path === '/auth/launcher/start' && req.method === 'POST') {
        const state = launcherLogins.start(ip);
        if (state === null) { send(res, 503, { error: 'too many logins in progress, try again shortly' }); return; }
        send(res, 200, { state, url: `${opts.baseUrl}/auth/steam?launcher=${state}` });
        return;
      }
      if (path === '/auth/steam/return' && req.method === 'GET') {
        const result = await verify(url.searchParams, opts.baseUrl, nonces, opts.steamFetch);
        if (!result.ok) {
          const asked = parseCookies(req.headers.cookie)[NEXT_COOKIE] ?? '';
          const launcher = /^launcher\.([0-9a-f]{64})$/.exec(asked);
          const clear = { 'set-cookie': nextCookie('', 0, opts.secureCookies) };
          if (launcher !== null) {
            // A launcher login: back to its page (never the web home), and the launcher is told.
            if (result.steam) launcherLogins.fail(launcher[1] as string);
            redirect(res, `/launcher-done.html?error=${result.steam ? 'steam' : 'refused'}`, clear);
            return;
          }
          const why = result.steam ? 'Steam không phản hồi — thử đăng nhập lại sau ít phút.' : `Steam từ chối đăng nhập (${result.reason}).`;
          const [page, hash] = (AFTER_LOGIN[asked] ?? '/').split('#');
          redirect(res, `${page}?login_error=${encodeURIComponent(why)}${hash ? `#${hash}` : ''}`, asked ? clear : {});
          return;
        }
        const maxAge = opts.sessionDays * 86400;
        const value = sign(opts.sessionSecret, result.steamId, Math.floor(Date.now() / 1000) + maxAge);
        const asked = parseCookies(req.headers.cookie)[NEXT_COOKIE];
        const session = cookieHeader(value, maxAge, opts.secureCookies);
        let to = AFTER_LOGIN[asked ?? ''] ?? '/';
        const launcher = /^launcher\.([0-9a-f]{64})$/.exec(asked ?? '');
        if (launcher !== null) {
          const r = launcherLogins.complete(launcher[1] as string, result.steamId, ip);
          to = r === 'ok' ? '/launcher-done.html' : `/launcher-done.html?error=${r}`;
        }
        redirect(res, to, {
          'set-cookie': asked === undefined ? session : [session, nextCookie('', 0, opts.secureCookies)],
        });
        return;
      }
      if (path === '/auth/logout' && req.method === 'POST') {
        send(res, 200, { ok: true }, { 'set-cookie': cookieHeader('', 0, opts.secureCookies) });
        return;
      }
      send(res, 404, { error: 'not found' });
      return;
    }

    if (path.startsWith('/api/')) {
      if (!apiLimit.allow(ip)) { send(res, 429, { error: 'too many requests' }); return; }
      if (path === '/api/garage') {
        if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return; }
        if (me === null) { send(res, 401, { error: 'not logged in' }); return; }
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-site request refused' }); return; }
        if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) { send(res, 415, { error: 'JSON only' }); return; }
        if (!writeLimit.allow(me)) { send(res, 429, { error: 'too many requests' }); return; }
        const body = await readSmallJson(req);
        if (body === null) { send(res, 400, { error: 'expected a small JSON object' }); return; }
        // Only these three fields, and never a SteamID from the browser.
        const r = await opts.bridge.garage(me, { action: body['action'], slot: body['slot'], where: body['where'] });
        send(res, r.status, r.body);
        return;
      }
      if (path === '/api/voice/token') {
        if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return; }
        if (me === null) { send(res, 401, { error: 'not logged in' }); return; }
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-site request refused' }); return; }
        if (!writeLimit.allow(me)) { send(res, 429, { error: 'too many requests' }); return; }
        const r = await opts.bridge.voiceToken(me);
        send(res, r.status, r.body);
        return;
      }
      if (path === '/api/voice/range') {
        if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return; }
        if (me === null) { send(res, 401, { error: 'not logged in' }); return; }
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-site request refused' }); return; }
        if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) { send(res, 415, { error: 'JSON only' }); return; }
        if (!writeLimit.allow(me)) { send(res, 429, { error: 'too many requests' }); return; }
        const body = await readSmallJson(req);
        if (body === null) { send(res, 400, { error: 'expected a small JSON object' }); return; }
        const r = await opts.bridge.voiceRange(me, body['range']);
        send(res, r.status, r.body);
        return;
      }
      if (req.method !== 'GET') { send(res, 405, { error: 'method not allowed' }); return; }
      if (path === '/api/voice') {
        if (me === null) { send(res, 401, { error: 'not logged in' }); return; }
        const r = await opts.bridge.voice(me);
        send(res, r.status, r.body);
        return;
      }
      const cmd = /^\/api\/command\/(\d{1,12})$/.exec(path);
      if (cmd !== null) {
        if (me === null) { send(res, 401, { error: 'not logged in' }); return; }
        const r = await opts.bridge.command(me, Number(cmd[1]));
        send(res, r.status, r.body);
        return;
      }
      if (path === '/api/me') {
        if (me === null) { send(res, 401, { error: 'not logged in' }); return; }
        const r = await opts.bridge.me(me);
        send(res, r.status, r.body);
        return;
      }
      if (path === '/api/ai') {
        // The live AI on the map: for logged-in players only.
        if (me === null) { send(res, 401, { error: 'not logged in' }); return; }
        const r = await opts.bridge.ai();
        send(res, r.status, r.body);
        return;
      }
      if (path === '/api/ai-zones') {
        // The AI zones on the map: public, like the map itself.
        const r = await opts.bridge.aiZones();
        send(res, r.status, r.body);
        return;
      }
      if (path === '/api/leaderboard') { const r = await opts.bridge.leaderboard(); send(res, r.status, r.body); return; }
      if (path === '/api/server') { const r = await opts.bridge.server(); send(res, r.status, r.body); return; }
      send(res, 404, { error: 'not found' });
      return;
    }

    const dl = /^\/tai\/([^/]+)$/.exec(path);
    if (dl !== null && req.method === 'GET' && opts.downloadsDir) { await sendDownload(res, opts.downloadsDir, dl[1] as string); return; }
    if (req.method === 'GET') { await sendStatic(res, path); return; }
    send(res, 405, { error: 'method not allowed' });
  }

  return createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      console.error('[portal] unhandled:', error);
      // The bridge being down is the usual cause: say so without details.
      if (!res.headersSent) send(res, 502, { error: 'server data unavailable, try again shortly' });
    });
  });
}
