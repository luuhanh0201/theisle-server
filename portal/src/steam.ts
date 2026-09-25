/**
 * "Sign in through Steam" — OpenID 2.0, as Steam implements it.
 *
 * 1. loginUrl(): send the player to Steam with our return URL.
 * 2. Steam sends them back with signed openid.* parameters.
 * 3. verify(): check the parts we can check locally (endpoint, return URL,
 *    claimed id format, nonce not seen before), then ask STEAM whether the
 *    signature is valid (mode=check_authentication). Only "is_valid:true"
 *    from Steam itself makes the SteamID trusted — the query string alone is
 *    attacker-controlled.
 */

import { steamPost, type SteamPost } from './steam-http.js';

export const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const NS = 'http://specs.openid.net/auth/2.0';
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

export function loginUrl(baseUrl: string): string {
  const params = new URLSearchParams({
    'openid.ns': NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${baseUrl}/auth/steam/return`,
    'openid.realm': baseUrl,
    'openid.identity': IDENTIFIER_SELECT,
    'openid.claimed_id': IDENTIFIER_SELECT,
  });
  return `${STEAM_OPENID}?${params.toString()}`;
}

/** Nonces already used, so a captured return URL cannot be replayed. */
export class NonceCache {
  readonly #seen = new Map<string, number>();
  constructor(readonly ttlMs = 15 * 60_000) {}
  /** false if seen before (a replay). */
  use(nonce: string, now = Date.now()): boolean {
    for (const [n, at] of this.#seen) if (now - at > this.ttlMs) this.#seen.delete(n);
    if (this.#seen.has(nonce)) return false;
    this.#seen.set(nonce, now);
    return true;
  }
}

/** `steam`: Steam could not be reached to confirm the login (retry later); the others are refusals. */
export type VerifyResult = { ok: true; steamId: string } | { ok: false; reason: string; steam?: true };

export async function verify(
  query: URLSearchParams,
  baseUrl: string,
  nonces: NonceCache,
  fetchImpl: SteamPost = steamPost,
): Promise<VerifyResult> {
  if (query.get('openid.mode') !== 'id_res') return { ok: false, reason: 'login cancelled or not a Steam response' };
  if (query.get('openid.op_endpoint') !== STEAM_OPENID) return { ok: false, reason: 'wrong OpenID endpoint' };
  if (query.get('openid.return_to') !== `${baseUrl}/auth/steam/return`) return { ok: false, reason: 'wrong return URL' };
  const claimed = query.get('openid.claimed_id') ?? '';
  const match = CLAIMED_ID.exec(claimed);
  if (match === null || query.get('openid.identity') !== claimed) return { ok: false, reason: 'not a Steam ID' };
  const nonce = query.get('openid.response_nonce');
  if (!nonce) return { ok: false, reason: 'no nonce' };

  // Ask Steam. Every openid.* field goes back exactly as received, mode changed.
  const body = new URLSearchParams();
  for (const [k, v] of query) if (k.startsWith('openid.')) body.set(k, v);
  body.set('openid.mode', 'check_authentication');
  let text: string;
  try {
    const res = await fetchImpl(STEAM_OPENID, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    text = await res.text();
  } catch (error) {
    console.error('[portal] Steam login check failed:', (error as Error).message);
    return { ok: false, reason: 'Steam did not answer', steam: true };
  }
  if (!/^is_valid\s*:\s*true\s*$/m.test(text)) return { ok: false, reason: 'Steam rejected the signature' };
  // Consumed only after Steam vouched for it: a failed attempt cannot burn a real nonce.
  if (!nonces.use(nonce)) return { ok: false, reason: 'this login link was already used' };
  return { ok: true, steamId: match[1] as string };
}
