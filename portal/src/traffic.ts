import { createHmac } from 'node:crypto';

/**
 * What the portal counts for the panel's "Truy cập" page (bridge traffic.ts):
 * page loads, download clicks, installers served, launchers running, Steam
 * logins, logged-in players using the site. Sent to the bridge, never stored here.
 *
 * A visitor is an HMAC of the day, the address and the browser with the
 * portal's own secret: the same person counts once a day, and neither the
 * address nor anything that leads back to it leaves this process.
 */

/** The launcher's user agent carries "XomGayLauncher/<version>" (launcher main.js). */
export const isLauncherUa = (ua: string | undefined): boolean => /\bXomGayLauncher\//.test(ua ?? '');

const pad = (n: number): string => String(n).padStart(2, '0');
export const dayOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function visitorId(secret: string, ip: string, ua: string | undefined, nowMs = Date.now()): string {
  return createHmac('sha256', secret).update(`${dayOf(nowMs)}|${ip}|${ua ?? ''}`).digest('hex').slice(0, 24);
}

/** Once a day per key (a player active on the web / in the launcher): the first time true. */
export class OncePerDay {
  #day = '';
  #seen = new Set<string>();
  first(key: string, nowMs = Date.now()): boolean {
    const day = dayOf(nowMs);
    if (day !== this.#day) { this.#day = day; this.#seen = new Set(); }
    if (this.#seen.has(key)) return false;
    this.#seen.add(key);
    return true;
  }
}

/** An installer by its file name: which OS, or null (the update feed, a blockmap). */
export function installerOs(name: string): 'win' | 'linux' | null {
  if (/\.exe$/i.test(name)) return 'win';
  if (/\.AppImage$/i.test(name)) return 'linux';
  return null;
}
