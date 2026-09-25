import { AsyncLocalStorage } from 'node:async_hooks';
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.js';
import {
  COOKIE, adminIds, forwardedIp, ipMatches, panelBaseUrl, parseCookies, readAccess, readSession,
  sessionCookie, sessionSecret, signSession,
} from './panel-auth.js';
import { NonceCache, loginUrl, verify } from './steam.js';
import { audit } from './audit.js';

/**
 * The door of the admin panel (see panel-auth.ts for the rules): the address
 * check, the Steam login pages, then the admin check. Everything of the panel
 * — the page and every /api route — is behind it; /player-api has its own
 * token and is not.
 */

/** The request's login, for the routes behind the door. */
export interface Login {
  /** Null when a script came in with ADMIN_TOKEN through the tunnel. */
  steamId: string | null;
  /** The raw cookie value (its write token is derived from it). */
  cookie: string | undefined;
  /** The visitor's IP when it came through the web, null through the tunnel. */
  ip: string | null;
}
export const currentLogin = new AsyncLocalStorage<Login>();

const nonces = new NonceCache();

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function page(res: ServerResponse, status: number, title: string, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { ...PAGE_HEADERS, ...headers });
  res.end(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="icon" href="/img/favicon-64.png">
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(ellipse at 30% 20%, #16243d, #0a0f19 55%, #05070b); color: #e2e8f0; font: 15px/1.55 system-ui, 'Segoe UI', sans-serif; }
  .card { width: min(420px, calc(100vw - 32px)); background: rgba(13,18,28,.94); border: 1px solid rgba(255,255,255,.09); border-radius: 16px; padding: 28px; box-shadow: 0 16px 50px rgba(0,0,0,.45); text-align: center; }
  img { width: 72px; height: 72px; border-radius: 50%; }
  h1 { font-size: 20px; margin: 12px 0 4px; }
  p { color: #94a3b8; margin: 8px 0; font-size: 13.5px; }
  .err { color: #fca5a5; background: rgba(248,113,113,.1); border: 1px solid rgba(248,113,113,.3); border-radius: 10px; padding: 8px 12px; }
  a.steam { display: flex; gap: 10px; align-items: center; justify-content: center; margin-top: 18px; padding: 12px; border-radius: 11px; font-weight: 800; color: #e5f3ff; text-decoration: none; background: linear-gradient(180deg, #21354d, #152436); border: 1px solid #38648b; }
  a.steam:hover { border-color: #66c0f4; }
  .steps { text-align: left; font-size: 12.5px; color: #64748b; margin-top: 18px; }
  .ok { color: #34d399; }
  code { color: #cbd5e1; }
</style></head><body><main class="card"><img src="/img/logo-96.webp" alt="">${body}</main></body></html>`);
}

const ERRORS: Record<string, string> = {
  setup: 'Đăng nhập chưa được bật trên máy chủ (thiếu ADMIN_TOKEN, hoặc PANEL_BASE_URL khi vào qua web).',
  steam: 'Steam không phản hồi để xác nhận đăng nhập — thử lại sau ít phút.',
  refused: 'Đăng nhập Steam không hợp lệ hoặc đã bị huỷ.',
  'not-admin': 'Tài khoản Steam này không có quyền admin.',
  expired: 'Phiên đăng nhập đã hết hạn — đăng nhập lại.',
};

function loginPage(res: ServerResponse, error: string | null, steamId: string | null, ip: string | null): void {
  const msg = error && ERRORS[error] ? `<p class="err">${esc(ERRORS[error])}${error === 'not-admin' && steamId ? `<br><code>${esc(steamId)}</code>` : ''}</p>` : '';
  page(res, 200, 'Đăng nhập — Admin panel', `
    <h1>Admin panel</h1>
    <p>Chỉ tài khoản Steam có quyền admin trên server mới vào được.</p>
    ${msg}
    <a class="steam" href="/auth/steam">Đăng nhập bằng Steam</a>
    <div class="steps">
      <div class="ok">✓ Lượt 1: ${ip ? `địa chỉ <code>${esc(ip)}</code> được phép` : 'vào qua SSH tunnel'}</div>
      <div>○ Lượt 2: đăng nhập Steam — SteamID phải nằm trong danh sách admin</div>
    </div>`);
}

function redirect(res: ServerResponse, to: string, headers: Record<string, string> = {}): void {
  res.writeHead(303, { location: to, 'cache-control': 'no-store', ...headers });
  res.end();
}

const sameText = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Run the door for one request. Returns the login when the request may go on
 * to the panel; null when the door answered it (a refusal, a login page, a
 * redirect). `serveImg` serves the login page's images.
 */
export async function panelGate(
  req: IncomingMessage, res: ServerResponse, url: URL, serveImg: (name: string) => Promise<void>,
  nameOf: (steamId: string) => string | null = () => null,
): Promise<Login | null> {
  const path = url.pathname;
  const api = path.startsWith('/api/');

  // --- check 1: the address ---------------------------------------------------
  const fwd = forwardedIp(req);
  if (fwd === 'bad') { page(res, 400, 'Bad request', '<h1>Bad request</h1>'); return null; }
  if (fwd !== null) {
    const { ips } = await readAccess();
    if (!ips.some((rule) => ipMatches(fwd, rule))) {
      console.warn(`[panel] refused ${fwd} (not on the allow list): ${req.method} ${path}`);
      if (api) {
        res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: 'address not allowed' }));
      } else {
        page(res, 403, 'Không được phép', `<h1>Không được phép</h1>
          <p>Địa chỉ <code>${esc(fwd)}</code> không nằm trong danh sách được vào admin panel.</p>
          <p>Admin thêm địa chỉ này ở Server → Truy cập panel (qua SSH tunnel nếu cần).</p>`);
      }
      return null;
    }
  }
  const ip = fwd;
  const secret = sessionSecret();
  const base = panelBaseUrl(req, ip !== null);
  const secure = base?.startsWith('https://') ?? false;

  // --- the login pages (need only check 1) ---------------------------------------
  if (req.method === 'GET' && path.startsWith('/img/')) { await serveImg(path.slice(1)); return null; }
  if (req.method === 'GET' && path === '/login') {
    loginPage(res, url.searchParams.get('e'), url.searchParams.get('id'), ip);
    return null;
  }
  if (req.method === 'GET' && path === '/auth/steam') {
    if (secret === null || base === null) { redirect(res, '/login?e=setup'); return null; }
    redirect(res, loginUrl(base));
    return null;
  }
  if (req.method === 'GET' && path === '/auth/steam/return') {
    if (secret === null || base === null) { redirect(res, '/login?e=setup'); return null; }
    const result = await verify(url.searchParams, base, nonces);
    if (!result.ok) {
      console.warn(`[panel] Steam login failed from ${ip ?? 'tunnel'}: ${result.reason}`);
      redirect(res, `/login?e=${result.steam ? 'steam' : 'refused'}`);
      return null;
    }
    const who = { steamId: result.steamId, name: nameOf(result.steamId) };
    if (!(await adminIds()).has(result.steamId)) {
      console.warn(`[panel] ${result.steamId} logged in from ${ip ?? 'tunnel'} but is not an admin`);
      await audit({ action: 'panel login refused', detail: `không phải admin · từ ${ip ?? 'SSH tunnel'}`, ok: false, error: 'not an admin' }, who);
      redirect(res, `/login?e=not-admin&id=${result.steamId}`);
      return null;
    }
    const maxAge = config.panel.sessionHours * 3600;
    const value = signSession(secret, result.steamId, Math.floor(Date.now() / 1000) + maxAge);
    console.info(`[panel] ${result.steamId} logged in from ${ip ?? 'tunnel'}`);
    await audit({ action: 'panel login', detail: `từ ${ip ?? 'SSH tunnel'}`, ok: true }, who);
    // Not a redirect: this request came in a chain started by Steam's page, and
    // a browser keeps a SameSite=Strict cookie out of every hop of such a
    // chain — "/" would arrive without it and send the admin back to the login
    // page. A page of our own that moves on by itself starts a fresh, same-site
    // navigation, which carries the cookie.
    page(res, 200, 'Đang vào panel…', `<meta http-equiv="refresh" content="0;url=/"><h1>Đăng nhập thành công</h1>
      <p>Đang vào panel… <a href="/" style="color:#66c0f4">bấm vào đây</a> nếu trang không tự chuyển.</p>`,
    { 'set-cookie': sessionCookie(value, maxAge, secure), refresh: '0;url=/' });
    return null;
  }
  if (req.method === 'POST' && path === '/auth/logout') {
    const leaving = secret !== null ? readSession(secret, parseCookies(req.headers.cookie)[COOKIE]) : null;
    if (leaving !== null) await audit({ action: 'panel logout', detail: `từ ${ip ?? 'SSH tunnel'}`, ok: true }, { steamId: leaving, name: nameOf(leaving) });
    res.writeHead(204, { 'set-cookie': sessionCookie('', 0, secure), 'cache-control': 'no-store' });
    res.end();
    return null;
  }

  // --- check 2: the person -----------------------------------------------------------
  const cookie = parseCookies(req.headers.cookie)[COOKIE];
  let steamId = secret !== null ? readSession(secret, cookie) : null;
  if (steamId !== null && !(await adminIds()).has(steamId)) steamId = null;
  // A script on the server itself (through 127.0.0.1, never the web) may use ADMIN_TOKEN instead.
  const supplied = req.headers['x-admin-token'];
  const script = steamId === null && ip === null && config.adminToken !== null && typeof supplied === 'string' && sameText(supplied, config.adminToken);
  if (steamId === null && !script) {
    if (api) {
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: 'login required' }));
    } else {
      redirect(res, cookie ? '/login?e=expired' : '/login');
    }
    return null;
  }
  return { steamId, cookie, ip };
}
