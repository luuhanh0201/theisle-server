import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The login cookie: "<steamId>.<expiresUnix>.<hmac>". Stateless — the HMAC
 * (SHA-256, PORTAL_SESSION_SECRET) is what makes it unforgeable; nothing is
 * stored server-side. Compared in constant time.
 */
export const COOKIE = 'isle_session';

function mac(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function sign(secret: string, steamId: string, expiresAt: number): string {
  const payload = `${steamId}.${expiresAt}`;
  return `${payload}.${mac(secret, payload)}`;
}

/** The SteamID in a valid, unexpired cookie value, else null. */
export function readSession(secret: string, value: string | undefined, now = Math.floor(Date.now() / 1000)): string | null {
  if (!value) return null;
  const m = /^(\d{17})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (m === null) return null;
  const [, steamId, exp, sig] = m as unknown as [string, string, string, string];
  const want = Buffer.from(mac(secret, `${steamId}.${exp}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (Number(exp) <= now) return null;
  return steamId;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieHeader(value: string, maxAgeSeconds: number, secure: boolean): string {
  return [`${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`, ...(secure ? ['Secure'] : [])].join('; ');
}
