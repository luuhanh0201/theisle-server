import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { config } from './config.js';
import { readLive } from './gameini.js';
import { ValidationError } from './garage.js';

/**
 * Who may open the admin panel. Two checks, both must pass:
 *
 *  1. The address. A request nginx forwards from the web carries the
 *     visitor's IP in X-Real-IP (nginx sets it, overwriting whatever the
 *     browser sent); it must be on the panel's allow list
 *     (DATA_DIR/panel-access.json, first seeded from PANEL_ALLOWED_IPS). A
 *     request with no X-Real-IP came straight to 127.0.0.1 — through the SSH
 *     tunnel, i.e. someone holding the server's SSH key — and passes.
 *  2. The person. A Steam login (OpenID, verified with Steam) whose SteamID is
 *     a game admin: the AdminsSteamIDs list the panel manages (Game.ini's when
 *     the panel has not saved one), plus ADMIN_STEAM_IDS from .env, who can
 *     never be locked out. Checked on every request: removing someone from
 *     the admin list ends their access at once.
 *
 * The login is a signed cookie ("<steamId>.<expires>.<hmac>", HttpOnly,
 * SameSite=Strict), nothing stored server-side. Writes also need a token in
 * x-admin-token: either ADMIN_TOKEN itself (scripts) or the login's own
 * token — an HMAC of the cookie, which the panel page is given and fills in
 * by itself. A page on another site cannot read it, so it cannot write.
 */

export const COOKIE = 'panel_session';

/** The key sessions are signed with: derived from ADMIN_TOKEN (new token = everyone logs in again). Null = no logins. */
export function sessionSecret(adminToken = config.adminToken): string | null {
  return adminToken ? createHmac('sha256', adminToken).update('panel-session-v1').digest('hex') : null;
}

const mac = (secret: string, payload: string): string => createHmac('sha256', secret).update(payload).digest('base64url');

export function signSession(secret: string, steamId: string, expiresAt: number): string {
  const payload = `${steamId}.${expiresAt}`;
  return `${payload}.${mac(secret, payload)}`;
}

const sameText = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The SteamID in a valid, unexpired cookie value, else null. */
export function readSession(secret: string, value: string | undefined, now = Math.floor(Date.now() / 1000)): string | null {
  if (!value) return null;
  const m = /^(\d{17})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (m === null) return null;
  const [, steamId, exp, sig] = m as unknown as [string, string, string, string];
  if (!sameText(mac(secret, `${steamId}.${exp}`), sig)) return null;
  if (Number(exp) <= now) return null;
  return steamId;
}

/** The write token of one login (bound to its cookie). */
export const writeToken = (secret: string, cookieValue: string): string => mac(secret, `write:${cookieValue}`);

/** Does `supplied` authorize a write: ADMIN_TOKEN, or the token of the login this request carries? */
export function writeAllowed(supplied: unknown, adminToken: string | null, secret: string | null, cookieValue: string | undefined): boolean {
  if (typeof supplied !== 'string' || supplied === '') return false;
  if (adminToken !== null && sameText(supplied, adminToken)) return true;
  return secret !== null && cookieValue !== undefined && sameText(supplied, writeToken(secret, cookieValue));
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* malformed: skip */ }
    }
  }
  return out;
}

export function sessionCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  return [`${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`, ...(secure ? ['Secure'] : [])].join('; ');
}

// --- addresses -----------------------------------------------------------------

/** An IPv6 address written out in full (8 groups of 4 hex digits), so "2405::1" and "2405:0::1" compare equal. */
function expandV6(ip: string): string {
  const [head = '', tail = ''] = ip.split('::');
  const h = head === '' ? [] : head.split(':');
  const t = ip.includes('::') ? (tail === '' ? [] : tail.split(':')) : [];
  const groups = ip.includes('::') ? [...h, ...new Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return groups.map((g) => g.padStart(4, '0')).join(':');
}

/** "::ffff:1.2.3.4" → "1.2.3.4", IPv6 written out in full; anything that is not an IP → null. */
export function normalizeIp(raw: string): string | null {
  const s = raw.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '').toLowerCase();
  const kind = isIP(s);
  if (kind === 4) return s;
  if (kind === 6 && !s.includes('.')) return expandV6(s);
  return kind === 6 ? s : null;
}

/** The visitor's IP when nginx forwarded the request (X-Real-IP), null when it came straight in (SSH tunnel). */
export function forwardedIp(req: IncomingMessage): string | null | 'bad' {
  const h = req.headers['x-real-ip'];
  if (h === undefined) return null;
  const ip = normalizeIp(Array.isArray(h) ? h[0] ?? '' : h);
  return ip ?? 'bad';
}

const v4 = (ip: string): number => ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
const v6 = (ip: string): bigint => BigInt(`0x${expandV6(ip).replaceAll(':', '')}`);

/** "base/bits" → its parts when it is a valid range: IPv4 /8../32, IPv6 /32../128. */
function parseRange(rule: string): { kind: 4 | 6; base: string; bits: number } | null {
  const m = /^([^/]+)\/(\d{1,3})$/.exec(rule.trim());
  if (!m) return null;
  const base = normalizeIp(m[1] as string);
  const bits = Number(m[2]);
  if (base === null) return null;
  const kind = isIP(base) as 4 | 6;
  if (kind === 4 && bits >= 8 && bits <= 32) return { kind, base, bits };
  if (kind === 6 && bits >= 32 && bits <= 128 && !base.includes('.')) return { kind, base, bits };
  return null;
}

/**
 * A rule is one IP (v4 or v6) or a range: "a.b.c.d/n" or an IPv6 prefix
 * "2405:4802:1d32:eec0::/64" — a home connection's IPv6 changes its last half
 * every few hours, its /64 prefix stays.
 */
export function validRule(rule: string): boolean {
  if (rule.includes('/')) return parseRange(rule) !== null;
  return normalizeIp(rule) !== null;
}

/** The rule as stored: IPs normalized, ranges with a normalized base. */
export function normalizeRule(rule: string): string | null {
  if (rule.includes('/')) {
    const r = parseRange(rule);
    return r ? `${r.base}/${r.bits}` : null;
  }
  return normalizeIp(rule);
}

/** Does `ip` (normalized) fall under `rule`? */
export function ipMatches(ip: string, rule: string): boolean {
  if (rule.includes('/')) {
    const r = parseRange(rule);
    if (r === null || isIP(ip) !== r.kind) return false;
    if (r.kind === 4) {
      const mask = (0xffffffff << (32 - r.bits)) >>> 0;
      return (v4(ip) & mask) === (v4(r.base) & mask);
    }
    const shift = BigInt(128 - r.bits);
    return (v6(ip) >> shift) === (v6(r.base) >> shift);
  }
  return normalizeIp(rule) === ip;
}

/** What "add my address" adds: the IPv4 itself, or the /64 prefix of an IPv6. */
export function ruleFor(ip: string): string {
  if (isIP(ip) !== 6 || ip.includes('.')) return ip;
  const groups = expandV6(ip).split(':').slice(0, 4);
  return normalizeRule(`${groups.join(':')}::/64`) as string;
}

export interface Access { ips: string[]; saved: boolean }
const accessPath = (): string => join(config.dataDir, 'panel-access.json');
let accessCache: Access | null = null;

/** The allowed IPs: the panel's saved list, else PANEL_ALLOWED_IPS. */
export async function readAccess(): Promise<Access> {
  if (accessCache) return accessCache;
  try {
    const raw = JSON.parse(await readFile(accessPath(), 'utf8')) as { ips?: unknown };
    const ips = Array.isArray(raw.ips) ? raw.ips.filter((r): r is string => typeof r === 'string' && validRule(r)).map((r) => normalizeRule(r) as string) : [];
    accessCache = { ips, saved: true };
  } catch {
    accessCache = { ips: config.panel.seedIps.filter(validRule).map((r) => normalizeRule(r) as string), saved: false };
  }
  return accessCache;
}

/**
 * Save the allow list. `keep` is the IP of whoever saves through the web: it
 * may not be left out (that would lock them out mid-session).
 */
export async function saveAccess(raw: unknown, keep: string | null): Promise<Access> {
  if (!Array.isArray(raw)) throw new ValidationError('ips must be a list');
  if (raw.length > 50) throw new ValidationError('at most 50 addresses');
  const ips: string[] = [];
  for (const r of raw) {
    const rule = typeof r === 'string' ? r.trim() : '';
    const norm = normalizeRule(rule);
    if (norm === null) throw new ValidationError(`not an IP or a range (1.2.3.0/24, 2405:4802::/64): ${String(r)}`);
    if (!ips.includes(norm)) ips.push(norm);
  }
  if (keep !== null && !ips.some((rule) => ipMatches(keep, rule))) {
    throw new ValidationError(`the list must still include your own address (${keep}), or you would be locked out`);
  }
  await mkdir(config.dataDir, { recursive: true });
  const tmp = `${accessPath()}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ ips }, null, 2)}\n`, 'utf8');
  await rename(tmp, accessPath());
  accessCache = { ips, saved: true };
  return accessCache;
}

/** Test hook: forget the cached allow list. */
export function resetAccessCache(): void { accessCache = null; }

// --- admins --------------------------------------------------------------------

let adminCache: { at: number; ids: Set<string> } | null = null;

/** SteamIDs allowed in: the panel's AdminsSteamIDs (else Game.ini's) + ADMIN_STEAM_IDS. Re-read every few seconds. */
export async function adminIds(now = Date.now()): Promise<Set<string>> {
  if (adminCache && now - adminCache.at < 5_000) return adminCache.ids;
  const live = await readLive();
  const fromPanel = live.settings['AdminsSteamIDs'];
  const fromIni = live.effective['AdminsSteamIDs'];
  const list = Array.isArray(fromPanel) ? fromPanel : Array.isArray(fromIni) ? fromIni : [];
  const ids = new Set<string>([...list.filter((s) => /^\d{17}$/.test(s)), ...config.panel.ownerIds]);
  adminCache = { at: now, ids };
  return ids;
}

// --- where Steam sends the browser back ---------------------------------------------

/**
 * The panel's own address for the Steam login: PANEL_BASE_URL through the web;
 * through the tunnel, the loopback address the browser used. Null = cannot log in
 * this way (a forwarded request with no PANEL_BASE_URL, or an odd Host).
 */
export function panelBaseUrl(req: IncomingMessage, forwarded: boolean): string | null {
  if (forwarded) return config.panel.baseUrl;
  const host = req.headers.host ?? '';
  return /^(127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/.test(host) ? `http://${host}` : null;
}
