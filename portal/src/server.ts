import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BridgeClient } from './bridge-client.js';
import { RateLimit } from './ratelimit.js';
import { COOKIE, cookieHeader, parseCookies, readSession, sign } from './session.js';
import { loginUrl, NonceCache, verify } from './steam.js';

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
 *   GET  /api/server            online count, game up or not
 */

export interface PortalOptions {
  baseUrl: string;
  secureCookies: boolean;
  sessionSecret: string;
  sessionDays: number;
  trustProxy: boolean;
  bridge: BridgeClient;
  steamFetch?: typeof fetch;
}

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp',
};

// No inline scripts anywhere (app.js is a file); styles may be inline.
const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, to: string, extra: Record<string, string> = {}): void {
  res.writeHead(302, { ...SECURITY_HEADERS, location: to, 'cache-control': 'no-store', ...extra });
  res.end();
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
    const cache = rel.startsWith('map/') ? 'public, max-age=604800' : 'no-cache';
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': TYPES[extname(file)] as string, 'cache-control': cache });
    res.end(body);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

export function createPortal(opts: PortalOptions): Server {
  const nonces = new NonceCache();
  // Per IP per minute. The page polls /api/me every second (+2 slow calls per
  // 15 s), and players behind one IP (a net café, a household) share it.
  const apiLimit = new RateLimit(600, 60_000);
  const authLimit = new RateLimit(20, 60_000);

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', opts.baseUrl);
    const path = url.pathname;
    const ip = clientIp(req, opts.trustProxy);
    const me = readSession(opts.sessionSecret, parseCookies(req.headers.cookie)[COOKIE]);

    if (path.startsWith('/auth/')) {
      if (!authLimit.allow(ip)) { send(res, 429, { error: 'too many requests' }); return; }
      if (path === '/auth/steam' && req.method === 'GET') { redirect(res, loginUrl(opts.baseUrl)); return; }
      if (path === '/auth/steam/return' && req.method === 'GET') {
        const result = await verify(url.searchParams, opts.baseUrl, nonces, opts.steamFetch);
        if (!result.ok) { redirect(res, `/?login_error=${encodeURIComponent(result.reason)}`); return; }
        const maxAge = opts.sessionDays * 86400;
        const value = sign(opts.sessionSecret, result.steamId, Math.floor(Date.now() / 1000) + maxAge);
        redirect(res, '/', { 'set-cookie': cookieHeader(value, maxAge, opts.secureCookies) });
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
      if (req.method !== 'GET') { send(res, 405, { error: 'method not allowed' }); return; }
      if (path === '/api/me') {
        if (me === null) { send(res, 401, { error: 'not logged in' }); return; }
        const r = await opts.bridge.me(me);
        send(res, r.status, r.body);
        return;
      }
      if (path === '/api/leaderboard') { const r = await opts.bridge.leaderboard(); send(res, r.status, r.body); return; }
      if (path === '/api/server') { const r = await opts.bridge.server(); send(res, r.status, r.body); return; }
      send(res, 404, { error: 'not found' });
      return;
    }

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
