import { randomBytes } from 'node:crypto';

/**
 * Steam login for the desktop launcher, done in the player's own browser (they
 * never type their Steam password into our app):
 *
 *   1. launcher  POST /auth/launcher/start            → { state, url }
 *   2. launcher  opens `url` in the default browser  (= /auth/steam?launcher=<state>)
 *   3. browser   logs in with Steam as usual; on the way back the portal ties
 *                the SteamID to `state` and shows "done, go back to the launcher"
 *   4. launcher  POST /auth/launcher/claim { state }  (polling) → the session
 *
 * `state` is 256 random bits only the launcher and that browser know, lives
 * 10 minutes, is claimed once, and the browser that finishes the login must
 * come from the same address as the launcher that started it: a link sent to
 * someone else to log in with cannot hand their session to the sender.
 */

interface Pending { ip: string; created: number; steamId: string | null; failed?: boolean }

export const STATE_RE = /^[0-9a-f]{64}$/;

export class LauncherLogins {
  #pending = new Map<string, Pending>();

  constructor(readonly ttlMs = 10 * 60_000, readonly max = 2_000) {}

  #sweep(now: number): void {
    for (const [k, v] of this.#pending) if (now - v.created > this.ttlMs) this.#pending.delete(k);
  }

  start(ip: string, now = Date.now()): string | null {
    this.#sweep(now);
    if (this.#pending.size >= this.max) return null;
    const state = randomBytes(32).toString('hex');
    this.#pending.set(state, { ip, created: now, steamId: null });
    return state;
  }

  /** Still waiting for its browser login? */
  isPending(state: string, now = Date.now()): boolean {
    const p = this.#pending.get(state);
    return p !== undefined && now - p.created <= this.ttlMs && p.steamId === null;
  }

  /** The browser came back from Steam as `steamId`. */
  complete(state: string, steamId: string, ip: string, now = Date.now()): 'ok' | 'expired' | 'other-address' {
    const p = this.#pending.get(state);
    if (p === undefined || now - p.created > this.ttlMs || p.steamId !== null) return 'expired';
    if (p.ip !== ip) { this.#pending.delete(state); return 'other-address'; }
    p.steamId = steamId;
    return 'ok';
  }

  /** The browser came back but the login could not be confirmed (Steam unreachable): tell the launcher. */
  fail(state: string, now = Date.now()): void {
    const p = this.#pending.get(state);
    if (p !== undefined && now - p.created <= this.ttlMs && p.steamId === null) p.failed = true;
  }

  /** The launcher asks: the SteamID once the login is done (then forgotten), or why not. */
  claim(state: string, ip: string, now = Date.now()): { status: 'done'; steamId: string } | { status: 'pending' | 'expired' | 'other-address' | 'steam' } {
    const p = this.#pending.get(state);
    if (p === undefined || now - p.created > this.ttlMs) return { status: 'expired' };
    if (p.ip !== ip) return { status: 'other-address' };
    if (p.failed) { this.#pending.delete(state); return { status: 'steam' }; }
    if (p.steamId === null) return { status: 'pending' };
    this.#pending.delete(state);
    return { status: 'done', steamId: p.steamId };
  }
}
