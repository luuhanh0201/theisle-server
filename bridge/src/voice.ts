import { createHmac } from 'node:crypto';
import type { LivePlayer } from './live.js';

/**
 * Proximity voice (voice.html in the portal, later the launcher). The audio
 * goes through a self-hosted LiveKit server; the bridge only decides who can
 * hear whom, from the positions StatsLogger writes to live.json every second:
 *
 *   - a token for the room, with an opaque identity (never the SteamID: every
 *     client sees every participant's identity);
 *   - for each listener, the voice users near their dino right now, with a
 *     volume (distance) and a left/right pan (their heading). No coordinates.
 *   - each speaker picks how far their voice carries (VOICE_RANGES: whisper
 *     15 m … shout 90 m); you hear someone only inside THEIR range.
 *
 * Out of the game (menu, dead, offline) = nobody near = you hear no one and
 * no one hears you: the client also allows only the listed peers to
 * subscribe to its microphone, so a modified client cannot listen from afar.
 */

export interface VoiceConfig {
  /** LiveKit's HTTP API from the bridge (same machine), e.g. http://127.0.0.1:7880. */
  apiUrl: string;
  /** What the browser connects to, e.g. wss://voice.example.com. */
  publicUrl: string;
  apiKey: string;
  apiSecret: string;
  room: string;
}

/** How far a voice carries (m), as the speaker chooses it. */
export const VOICE_RANGES = [15, 30, 60, 90] as const;
export const DEFAULT_RANGE = 30;
export const isRange = (v: unknown): v is number => typeof v === 'number' && (VOICE_RANGES as readonly number[]).includes(v);

const b64url = (v: Buffer | string): string => Buffer.from(v).toString('base64url');

/** HS256 JWT, the format LiveKit's access tokens use. */
export function signJwt(claims: Record<string, unknown>, secret: string): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/** The identity a player has in the voice room: stable, not reversible without the secret. */
export function voiceIdentity(steamId: string, secret: string): string {
  return 'v' + createHmac('sha256', secret).update(`voice-identity:${steamId}`).digest('hex').slice(0, 16);
}

/** A join token: microphone only, no data messages, valid for `ttlS`. */
export function joinToken(cfg: VoiceConfig, steamId: string, name: string | null, nowS: number, ttlS = 6 * 3600): string {
  return signJwt({
    iss: cfg.apiKey,
    sub: voiceIdentity(steamId, cfg.apiSecret),
    name: (name ?? '').slice(0, 40),
    nbf: nowS - 10,
    exp: nowS + ttlS,
    video: {
      room: cfg.room, roomJoin: true,
      canPublish: true, canPublishSources: ['microphone'], canSubscribe: true, canPublishData: false,
    },
  }, cfg.apiSecret);
}

/** Short-lived token for the bridge's own calls to LiveKit's API. */
export function adminToken(cfg: VoiceConfig, nowS: number): string {
  return signJwt({
    iss: cfg.apiKey, sub: 'isle-bridge', nbf: nowS - 10, exp: nowS + 60,
    video: { room: cfg.room, roomAdmin: true, roomList: true },
  }, cfg.apiSecret);
}

export interface Peer {
  /** Their voice identity (as in the room). */
  id: string;
  name: string | null;
  /** 0..1, from distance. */
  gain: number;
  /** -1 (left) .. 1 (right), from the listener's heading. */
  pan: number;
}

const round = (v: number, step: number): number => Number((Math.round(v / step) * step).toFixed(2));

/** Distance between two dinos in metres (positions are game units, cm). */
function metres(a: LivePlayer, b: LivePlayer): number {
  const dx = b.loc.x - a.loc.x;
  const dy = b.loc.y - a.loc.y;
  const dz = (b.loc.z ?? 0) - (a.loc.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / 100;
}

/**
 * Volume and pan of `other` as `me` hears them, or null when too far.
 * `rangeM` is how far `other`'s voice carries: full volume in the first
 * quarter, fading to nothing at the edge. Yaw in degrees, the game's (X forward, Y right).
 */
export function hear(me: LivePlayer, other: LivePlayer, rangeM: number): { gain: number; pan: number } | null {
  const dx = other.loc.x - me.loc.x;
  const dy = other.loc.y - me.loc.y;
  const d = metres(me, other);
  const nearM = rangeM / 4;
  const farM = rangeM;
  if (d >= farM) return null;
  const lin = d <= nearM ? 1 : 1 - (d - nearM) / (farM - nearM);
  // Falls off faster than linear, like a voice does; rounded so the numbers
  // do not give away more than the ear hears anyway.
  const gain = round(Math.pow(lin, 1.5), 0.02);
  if (gain <= 0) return null;
  let pan = 0;
  if (me.yaw !== null && (dx !== 0 || dy !== 0)) {
    const rel = Math.atan2(dy, dx) - (me.yaw * Math.PI) / 180;
    pan = round(Math.sin(rel), 0.1);
  }
  return { gain, pan: Object.is(pan, -0) ? 0 : pan };
}

/**
 * For `steamId` now: who they hear (inside each speaker's own range, loudest
 * first) and who may hear them (inside their range) — the client lets only
 * the latter subscribe to its microphone.
 */
export function peersOf(
  steamId: string, players: readonly LivePlayer[], inRoom: ReadonlySet<string>, cfg: VoiceConfig,
  nameOf: (steamId: string) => string | null, rangeOf: (steamId: string) => number,
): { inGame: boolean; range: number; peers: Peer[]; audience: string[] } {
  const range = rangeOf(steamId);
  const me = players.find((p) => p.steamId === steamId);
  if (me === undefined) return { inGame: false, range, peers: [], audience: [] };
  const peers: Peer[] = [];
  const audience: string[] = [];
  for (const other of players) {
    if (other.steamId === steamId) continue;
    const id = voiceIdentity(other.steamId, cfg.apiSecret);
    if (!inRoom.has(id)) continue;
    const h = hear(me, other, rangeOf(other.steamId));
    if (h !== null) peers.push({ id, name: nameOf(other.steamId), ...h });
    if (metres(me, other) < range) audience.push(id);
  }
  peers.sort((a, b) => b.gain - a.gain);
  return { inGame: true, range, peers, audience };
}

/** Identities in the room, from LiveKit's ListParticipants (JSON, either field-name style). */
export function parseParticipants(raw: unknown): Set<string> {
  const out = new Set<string>();
  const list = (raw as { participants?: unknown } | null)?.participants;
  if (!Array.isArray(list)) return out;
  for (const p of list) {
    const id = (p as { identity?: unknown } | null)?.identity;
    if (typeof id === 'string' && /^v[0-9a-f]{16}$/.test(id)) out.add(id);
  }
  return out;
}

/**
 * Who is in the voice room. Asked of LiveKit only while someone is using
 * voice (each /voice poll), at most every `maxAgeMs`: nobody in voice = no
 * calls. A failed call keeps the last list (LiveKit restarting), not forever.
 */
export class VoiceRoom {
  #members: Set<string> = new Set();
  #at = 0;
  #inflight: Promise<void> | null = null;
  #warned = false;

  /** Each player's chosen range; in memory — the page sends it again when it joins. */
  #ranges = new Map<string, number>();

  constructor(readonly cfg: VoiceConfig, readonly fetchImpl: typeof fetch = fetch, readonly maxAgeMs = 2_000) {}

  rangeOf(steamId: string): number {
    return this.#ranges.get(steamId) ?? DEFAULT_RANGE;
  }

  setRange(steamId: string, range: number): void {
    if (!isRange(range)) throw new RangeError(`range must be one of ${VOICE_RANGES.join(', ')}`);
    this.#ranges.set(steamId, range);
  }

  async refresh(nowS = Math.floor(Date.now() / 1000)): Promise<void> {
    const res = await this.fetchImpl(`${this.cfg.apiUrl}/twirp/livekit.RoomService/ListParticipants`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken(this.cfg, nowS)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ room: this.cfg.room }),
      signal: AbortSignal.timeout(3_000),
    });
    const body = await res.json() as unknown;
    if (res.ok) {
      this.#members = parseParticipants(body);
    } else if ((body as { code?: unknown } | null)?.code === 'not_found') {
      this.#members = new Set();   // nobody has joined yet: the room does not exist
    } else {
      throw new Error(`ListParticipants: HTTP ${res.status}`);
    }
    this.#at = Date.now();
  }

  /** The members, refreshed first if older than maxAgeMs. */
  async members(): Promise<ReadonlySet<string>> {
    if (Date.now() - this.#at > this.maxAgeMs) {
      this.#inflight ??= this.refresh().then(
        () => { this.#warned = false; },
        (error: unknown) => {
          if (!this.#warned) console.error('[voice] LiveKit unreachable:', error instanceof Error ? error.message : error);
          this.#warned = true;
        },
      ).finally(() => { this.#inflight = null; });
      await this.#inflight;
    }
    return Date.now() - this.#at > 30_000 ? new Set() : this.#members;
  }
}
