import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { isSteamId, ValidationError } from './garage.js';
import type { Live } from './live.js';

/**
 * Kết bạn (owner, 2026-10-06): a player finds another by name or SteamID on the Map page and
 * asks; once the other accepts, each sees the other on the map, the big map and the launcher's
 * mini map (a direction arrow when off its edge). Either may end it. Nobody's SteamID leaves the
 * bridge (player-api.ts): a player is named to the browser by `ref`, a keyed hash of the SteamID.
 *
 *   DATA_DIR/friends.json  { pairs: [{ a, b, since }], requests: [{ from, to, at }] }
 */
export const MAX_FRIENDS = 50;
export const MAX_OUTGOING = 20;
/** A request not answered in this many days is dropped. */
export const REQUEST_DAYS = 14;
export const SEARCH_MAX = 10;

export interface FriendPair { a: string; b: string; since: number }
export interface FriendRequest { from: string; to: string; at: number }
export interface FriendsState { pairs: FriendPair[]; requests: FriendRequest[] }

/** What a player is known by: their SteamID, their in-game name, online now. */
export interface KnownPlayer { steamId: string; name: string | null; online: boolean }

const secret = config.portalToken ?? randomBytes(32).toString('hex');
/** The browser's name for a player: never their SteamID. */
export const friendRef = (steamId: string): string =>
  createHmac('sha256', `friends:${secret}`).update(steamId).digest('base64url').slice(0, 16);
export const isRef = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{16}$/.test(v);

/** Lower case, no Vietnamese marks: "Đạt" finds "dat". */
export const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

function clean(raw: unknown, nowS: number): FriendsState {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: FriendsState = { pairs: [], requests: [] };
  const seen = new Set<string>();
  for (const p of Array.isArray(r['pairs']) ? r['pairs'] : []) {
    const o = (p ?? {}) as Record<string, unknown>;
    const a = o['a']; const b = o['b'];
    if (typeof a !== 'string' || typeof b !== 'string' || !isSteamId(a) || !isSteamId(b) || a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.pairs.push({ a, b, since: typeof o['since'] === 'number' ? o['since'] : 0 });
  }
  for (const q of Array.isArray(r['requests']) ? r['requests'] : []) {
    const o = (q ?? {}) as Record<string, unknown>;
    const from = o['from']; const to = o['to']; const at = typeof o['at'] === 'number' ? o['at'] : 0;
    if (typeof from !== 'string' || typeof to !== 'string' || !isSteamId(from) || !isSteamId(to) || from === to) continue;
    if (nowS - at > REQUEST_DAYS * 86400) continue;
    if (out.requests.some((x) => x.from === from && x.to === to)) continue;
    out.requests.push({ from, to, at });
  }
  return out;
}

const isPair = (p: FriendPair, x: string, y: string): boolean => (p.a === x && p.b === y) || (p.a === y && p.b === x);

/** The friends list and its requests, kept in DATA_DIR/friends.json. */
export class Friends {
  #state: FriendsState | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #file: string;

  constructor(file = join(config.dataDir, 'friends.json')) { this.#file = file; }

  async #load(nowS: number): Promise<FriendsState> {
    if (this.#state !== null) return this.#state;
    try {
      this.#state = clean(JSON.parse(await readFile(this.#file, 'utf8')), nowS);
    } catch {
      this.#state = { pairs: [], requests: [] };
    }
    return this.#state;
  }

  async #save(s: FriendsState): Promise<void> {
    await mkdir(join(this.#file, '..'), { recursive: true });
    const tmp = `${this.#file}.tmp`;
    await writeFile(tmp, JSON.stringify(s, null, 2), 'utf8');
    await rename(tmp, this.#file);
  }

  /** One change at a time: two clicks never write over each other. */
  #change<T>(fn: (s: FriendsState) => T, nowS: number): Promise<T> {
    const run = this.#queue.then(async () => {
      const s = await this.#load(nowS);
      s.requests = s.requests.filter((r) => nowS - r.at <= REQUEST_DAYS * 86400);
      const out = fn(s);
      await this.#save(s);
      return out;
    });
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async view(me: string, nowS = Math.floor(Date.now() / 1000)): Promise<{ friends: Array<{ id: string; since: number }>; incoming: FriendRequest[]; outgoing: FriendRequest[] }> {
    const s = await this.#load(nowS);
    const live = (r: FriendRequest): boolean => nowS - r.at <= REQUEST_DAYS * 86400;
    return {
      friends: s.pairs.filter((p) => p.a === me || p.b === me).map((p) => ({ id: p.a === me ? p.b : p.a, since: p.since })),
      incoming: s.requests.filter((r) => r.to === me && live(r)),
      outgoing: s.requests.filter((r) => r.from === me && live(r)),
    };
  }

  async areFriends(x: string, y: string): Promise<boolean> {
    return (await this.#load(Math.floor(Date.now() / 1000))).pairs.some((p) => isPair(p, x, y));
  }

  /** Ask `to`; when `to` already asked `from`, that is an accept. */
  request(from: string, to: string, nowS = Math.floor(Date.now() / 1000)): Promise<'sent' | 'accepted'> {
    return this.#change((s) => {
      if (from === to) throw new ValidationError('Không thể kết bạn với chính mình.');
      if (s.pairs.some((p) => isPair(p, from, to))) throw new ValidationError('Hai bạn đã là bạn bè.');
      if (s.requests.some((r) => r.from === from && r.to === to)) throw new ValidationError('Bạn đã gửi lời mời, chờ người kia chấp nhận.');
      const count = (id: string): number => s.pairs.filter((p) => p.a === id || p.b === id).length;
      if (count(from) >= MAX_FRIENDS) throw new ValidationError(`Bạn đã có ${MAX_FRIENDS} bạn, huỷ bớt trước.`);
      const back = s.requests.findIndex((r) => r.from === to && r.to === from);
      if (back >= 0) {
        if (count(to) >= MAX_FRIENDS) throw new ValidationError('Người kia đã đủ bạn bè.');
        s.requests.splice(back, 1);
        s.pairs.push({ a: from, b: to, since: nowS });
        return 'accepted';
      }
      if (s.requests.filter((r) => r.from === from).length >= MAX_OUTGOING) {
        throw new ValidationError(`Bạn đang chờ ${MAX_OUTGOING} lời mời, huỷ bớt trước.`);
      }
      s.requests.push({ from, to, at: nowS });
      return 'sent';
    }, nowS);
  }

  /** `me` accepts `from`'s request. */
  accept(me: string, from: string, nowS = Math.floor(Date.now() / 1000)): Promise<void> {
    return this.#change((s) => {
      const i = s.requests.findIndex((r) => r.from === from && r.to === me);
      if (i < 0) throw new ValidationError('Lời mời không còn.');
      const count = (id: string): number => s.pairs.filter((p) => p.a === id || p.b === id).length;
      if (count(me) >= MAX_FRIENDS) throw new ValidationError(`Bạn đã có ${MAX_FRIENDS} bạn, huỷ bớt trước.`);
      if (count(from) >= MAX_FRIENDS) throw new ValidationError('Người kia đã đủ bạn bè.');
      s.requests.splice(i, 1);
      // Each may have asked the other: one pair, both requests gone.
      s.requests = s.requests.filter((r) => !(r.from === me && r.to === from));
      if (!s.pairs.some((p) => isPair(p, me, from))) s.pairs.push({ a: from, b: me, since: nowS });
    }, nowS);
  }

  /** `me` declines `from`'s request. */
  decline(me: string, from: string, nowS = Math.floor(Date.now() / 1000)): Promise<void> {
    return this.#change((s) => { s.requests = s.requests.filter((r) => !(r.from === from && r.to === me)); }, nowS);
  }

  /** `me` takes back their request to `to`. */
  cancel(me: string, to: string, nowS = Math.floor(Date.now() / 1000)): Promise<void> {
    return this.#change((s) => { s.requests = s.requests.filter((r) => !(r.from === me && r.to === to)); }, nowS);
  }

  /** No longer friends (either side). */
  remove(me: string, other: string, nowS = Math.floor(Date.now() / 1000)): Promise<void> {
    return this.#change((s) => { s.pairs = s.pairs.filter((p) => !isPair(p, me, other)); }, nowS);
  }
}

/** The players a search finds: by exact SteamID, or a name containing the text (marks ignored), never `me`. */
export function searchPlayers(players: readonly KnownPlayer[], q: unknown, me: string): KnownPlayer[] {
  if (typeof q !== 'string') throw new ValidationError('Nhập tên hoặc SteamID.');
  const text = q.trim();
  if (/^\d{17}$/.test(text)) return players.filter((p) => p.steamId === text && p.steamId !== me);
  if (text.length < 2 || text.length > 32) throw new ValidationError('Nhập ít nhất 2 ký tự của tên (hoặc SteamID 17 số).');
  const want = fold(text);
  return players
    .filter((p) => p.steamId !== me && p.name !== null && fold(p.name).includes(want))
    .sort((x, y) => Number(y.online) - Number(x.online) || (x.name ?? '').length - (y.name ?? '').length)
    .slice(0, SEARCH_MAX);
}

/** The SteamID behind a ref, among `ids`, or null. */
export function idOfRef(ref: unknown, ids: Iterable<string>): string | null {
  if (!isRef(ref)) return null;
  for (const id of ids) if (friendRef(id) === ref) return id;
  return null;
}

/** A friend's spot for the maps: where they are now (live.json), or null when not in game. */
export function friendSpot(live: Live | null, steamId: string): { x: number; y: number; yaw: number | null } | null {
  if (live === null || live.stale) return null;
  const p = live.players.find((x) => x.steamId === steamId);
  return p === undefined ? null : { x: Math.round(p.loc.x), y: Math.round(p.loc.y), yaw: p.yaw };
}

/** The bridge's friends list (one process). */
export const friends = new Friends();
