import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';
import { renderMessage } from './messages.js';

/**
 * Bans (panel → Người chơi → Ban).
 *
 * The game keeps its ban list in Saved/PlayerData/PlayerBans.json — every ban,
 * from RCON or from the game's own admin panel, with its reason, who banned
 * and until when (checked on this server, 2026-09-26). The bridge only READS
 * it: a new entry is announced to the server (text "ban.announce", tab Thông
 * báo) and logged on Discord, whoever banned.
 *
 * Banning from the panel is RCON BanPlayer (0x20, "Name,SteamID,Reason,Time"):
 * Time is in HOURS (90 → 90 h later, checked); 0 ends at once, so "permanent"
 * is PERMANENT_HOURS. Before it the player gets "ban.player" (DirectMessage),
 * after it a KickPlayer (0x30).
 *
 * Unban and edit (time, reason): RCON has neither, so the bridge edits the
 * game's file — a copy of it first (DATA_DIR/ban-backups), same format — and
 * REMEMBERS the edit (DATA_DIR/ban-edits.json). Whether the game re-reads the
 * file while running is not verified; if it writes its own list back over
 * the edit, the next read puts the edit back (and an unbanned entry coming
 * back is not a new ban). A restart makes the game load the edited file.
 *
 * The times in the file are the VPS's local time ("2026.09.26-10.56.54").
 * Its encoding is the game's choice: UTF-8, or UTF-16 LE with a BOM as soon
 * as a name is not plain ASCII ("T-Rex Nổi Loạn", 2026-09-26) — read either
 * way, written back in the one it was in.
 */

export interface Ban {
  steamId: string;
  /** The game's own text of the ban time: with the SteamID, what names this ban. */
  bannedTime: string;
  name: string;
  reason: string;
  /** Unix seconds. */
  bannedAt: number | null;
  endsAt: number | null;
  permanent: boolean;
  by: string;
}

export const PERMANENT_HOURS = 87_600;          // 10 years
const PERMANENT_S = 5 * 365 * 86_400;            // anything longer reads as permanent
export const DEFAULT_REASONS = [
  'Hack / cheat',
  'Lợi dụng lỗi game (exploit, xuyên map)',
  'Phá hoại, quấy rối người chơi khác (grief)',
  'Xúc phạm, chửi bới, phân biệt',
  'Giết người trong khu bảo tồn / chỗ spawn',
  'Spam chat, quảng cáo server khác',
  'Tên nhân vật phản cảm',
  'Thoát game để tránh chết (combat log)',
];

const reasonsPath = (): string => join(config.dataDir, 'ban-reasons.json');
const editsPath = (): string => join(config.dataDir, 'ban-edits.json');
const backupDir = (): string => join(config.dataDir, 'ban-backups');
const KEEP_BACKUPS = 30;
const KEEP_EDITS_S = 60 * 86_400;

const pad = (n: number): string => String(n).padStart(2, '0');
/** unix seconds → "2026.09.26-10.56.54" (VPS local time), as the game writes it. */
export function formatGameTime(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}-${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
}

/** "2026.09.26-10.56.54" (VPS local time) → unix seconds. */
export function parseGameTime(s: unknown): number | null {
  const m = typeof s === 'string' ? /^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})$/.exec(s) : null;
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number) as number[];
  return Math.floor(new Date(y as number, (mo as number) - 1, d, h, mi, se).getTime() / 1000);
}

export function parseBans(text: string): Ban[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  const list = (raw as { bannedPlayerData?: unknown } | null)?.bannedPlayerData;
  if (!Array.isArray(list)) return [];
  return list.flatMap((e): Ban[] => {
    if (typeof e !== 'object' || e === null) return [];
    const o = e as Record<string, unknown>;
    if (typeof o['steamId'] !== 'string') return [];
    const bannedAt = parseGameTime(o['bannedTime']);
    const endsAt = parseGameTime(o['endBanTime']);
    return [{
      steamId: o['steamId'],
      bannedTime: typeof o['bannedTime'] === 'string' ? o['bannedTime'] : '',
      name: typeof o['playerName'] === 'string' ? o['playerName'] : o['steamId'],
      reason: typeof o['banReason'] === 'string' ? o['banReason'] : '',
      bannedAt, endsAt,
      permanent: bannedAt !== null && endsAt !== null && endsAt - bannedAt >= PERMANENT_S,
      by: typeof o['bannerName'] === 'string' ? o['bannerName'] : '?',
    }];
  });
}

export type GameEncoding = 'utf8' | 'utf8bom' | 'utf16le';

/** The game's file as text, and how it was encoded. */
export function decodeGameFile(buf: Buffer): { text: string; enc: GameEncoding } {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.subarray(2).toString('utf16le'), enc: 'utf16le' };
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString('utf8'), enc: 'utf8bom' };
  return { text: buf.toString('utf8'), enc: 'utf8' };
}

export function encodeGameFile(text: string, enc: GameEncoding): Buffer {
  if (enc === 'utf16le') return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  if (enc === 'utf8bom') return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
  return Buffer.from(text, 'utf8');
}

export async function readBans(path = config.game.bansPath): Promise<Ban[]> {
  try {
    return parseBans(decodeGameFile(await readFile(path)).text);
  } catch {
    return [];
  }
}

/** "3 ngày", "6 giờ", "vĩnh viễn". */
export function durationText(b: Pick<Ban, 'bannedAt' | 'endsAt' | 'permanent'>): string {
  if (b.permanent) return 'vĩnh viễn';
  if (b.bannedAt === null || b.endsAt === null) return '';
  const h = Math.round((b.endsAt - b.bannedAt) / 3600);
  if (h >= 24 && h % 24 === 0) return `${h / 24} ngày`;
  return `${h} giờ`;
}
/** "26/09/2026 10:56" (Vietnam time). */
export const dateText = (t: number | null): string => (t === null ? '?'
  : new Date(t * 1000).toLocaleString('vi-VN', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
const untilText = (b: Pick<Ban, 'permanent' | 'endsAt'>): string => (b.permanent || b.endsAt === null ? 'không hết hạn' : dateText(b.endsAt));

export const banVars = (b: Ban): Record<string, string> => ({
  name: b.name, reason: b.reason || '(không ghi)', duration: durationText(b), until: untilText(b), since: dateText(b.bannedAt),
  by: b.by === 'Rcon' ? 'admin' : b.by,
});

const key = (steamId: string, bannedTime: string): string => `${steamId}|${bannedTime}`;

// --- edits the bridge makes to the game's list ------------------------------------

export interface BanEdit {
  steamId: string;
  bannedTime: string;
  action: 'unban' | 'edit';
  /** edit: the new end, as the game writes times; and / or the new reason. */
  endBanTime?: string;
  banReason?: string;
  at: number;
  by: string;
}

type GameEntry = Record<string, unknown>;
interface GameDoc { bannedPlayerData: GameEntry[] }

/** Put the edits into the game's document; true when it changed. */
export function applyEdits(doc: GameDoc, edits: readonly BanEdit[]): boolean {
  let changed = false;
  const byKey = new Map(edits.map((e) => [key(e.steamId, e.bannedTime), e]));
  const kept: GameEntry[] = [];
  for (const entry of doc.bannedPlayerData) {
    const e = byKey.get(key(String(entry['steamId']), String(entry['bannedTime'])));
    if (e?.action === 'unban') { changed = true; continue; }
    if (e?.action === 'edit') {
      if (e.endBanTime !== undefined && entry['endBanTime'] !== e.endBanTime) { entry['endBanTime'] = e.endBanTime; changed = true; }
      if (e.banReason !== undefined && entry['banReason'] !== e.banReason) { entry['banReason'] = e.banReason; changed = true; }
    }
    kept.push(entry);
  }
  doc.bannedPlayerData = kept;
  return changed;
}

async function readEdits(): Promise<BanEdit[]> {
  try {
    const r = JSON.parse(await readFile(editsPath(), 'utf8')) as unknown;
    return Array.isArray(r) ? r as BanEdit[] : [];
  } catch {
    return [];
  }
}

async function writeAtomic(path: string, text: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, path);
}

/** A copy of the game's file as it was, then the new one in its place (tabs and encoding as the game wrote it). */
async function writeGameFile(path: string, before: Buffer, enc: GameEncoding, doc: GameDoc): Promise<void> {
  await mkdir(backupDir(), { recursive: true });
  await writeFile(join(backupDir(), `PlayerBans.${Date.now()}.json`), before);
  const old = (await readdir(backupDir())).filter((n) => n.startsWith('PlayerBans.')).sort();
  for (const n of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) await unlink(join(backupDir(), n)).catch(() => undefined);
  await writeAtomic(path, encodeGameFile(JSON.stringify(doc, null, '\t'), enc));
}

/**
 * The game's list, watched: each new ban told once (the first read is the
 * baseline: a restart does not announce the old ones again), the bridge's
 * edits kept applied.
 */
export class BanWatcher {
  #known: Set<string> | null = null;
  #list: Ban[] = [];
  #edits: BanEdit[] | null = null;
  #busy: Promise<void> = Promise.resolve();
  readonly #path: string;
  readonly #onBan: (b: Ban) => void;
  readonly #now: () => number;

  constructor(onBan: (b: Ban) => void, opts: { path?: string; now?: () => number } = {}) {
    this.#onBan = onBan;
    this.#path = opts.path ?? config.game.bansPath;
    this.#now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /** One at a time: a tick and an edit never write the file together. */
  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#busy.then(fn);
    this.#busy = run.then(() => undefined, () => undefined);
    return run;
  }

  async #load(): Promise<{ raw: Buffer; enc: GameEncoding; text: string; doc: GameDoc } | null> {
    let buf: Buffer;
    try { buf = await readFile(this.#path); } catch { return null; }
    const { text, enc } = decodeGameFile(buf);
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return null; }     // being written by the game: next time
    const list = (raw as { bannedPlayerData?: unknown } | null)?.bannedPlayerData;
    if (!Array.isArray(list)) return null;
    return { raw: buf, enc, text, doc: raw as GameDoc };
  }

  async #editsNow(): Promise<BanEdit[]> {
    if (this.#edits === null) this.#edits = await readEdits();
    const keep = this.#edits.filter((e) => this.#now() - e.at < KEEP_EDITS_S);
    if (keep.length !== this.#edits.length) { this.#edits = keep; await writeAtomic(editsPath(), JSON.stringify(keep, null, 2)); }
    return this.#edits;
  }

  tick(): Promise<void> {
    return this.#serial(async () => {
      const got = await this.#load();
      if (got === null) return;
      if (applyEdits(got.doc, await this.#editsNow())) await writeGameFile(this.#path, got.raw, got.enc, got.doc);
      const bans = parseBans(JSON.stringify(got.doc));
      this.#list = bans;
      const now = new Set(bans.map((b) => key(b.steamId, b.bannedTime)));
      if (this.#known !== null) for (const b of bans) if (!this.#known.has(key(b.steamId, b.bannedTime))) this.#onBan(b);
      this.#known = now;
    });
  }

  /** The bans in force now (from the last read), by SteamID. */
  active(nowS = this.#now()): Map<string, Ban> {
    const out = new Map<string, Ban>();
    for (const b of this.#list) if (b.permanent || (b.endsAt !== null && b.endsAt > nowS)) out.set(b.steamId, b);
    return out;
  }

  /** Unban, or change the end / reason, of one ban; the ban as it was, and as it is now (null when unbanned). */
  change(edit: Omit<BanEdit, 'at'>): Promise<{ before: Ban; after: Ban | null }> {
    return this.#serial(async () => {
      const got = await this.#load();
      if (got === null) throw new ValidationError('không đọc được danh sách ban của game');
      const before = parseBans(got.text).find((b) => b.steamId === edit.steamId && b.bannedTime === edit.bannedTime);
      if (!before) throw new ValidationError('không thấy lần ban này (đã hết / đã gỡ?)');
      const edits = (await this.#editsNow()).filter((e) => key(e.steamId, e.bannedTime) !== key(edit.steamId, edit.bannedTime));
      const merged: BanEdit = { ...edit, at: this.#now() };
      this.#edits = [...edits, merged];
      await writeAtomic(editsPath(), JSON.stringify(this.#edits, null, 2));
      applyEdits(got.doc, this.#edits);
      await writeGameFile(this.#path, got.raw, got.enc, got.doc);
      this.#list = parseBans(JSON.stringify(got.doc));
      const after = this.#list.find((b) => b.steamId === edit.steamId && b.bannedTime === edit.bannedTime) ?? null;
      if (after === null) this.#known?.delete(key(edit.steamId, edit.bannedTime));
      return { before, after };
    });
  }
}

/** What the panel sends to change a ban: the new end (unix, or permanent) and / or reason. */
export function validateBanEdit(raw: unknown): { steamId: string; bannedTime: string; endsAt?: number | 'permanent'; reason?: string } {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('body must be an object');
  const r = raw as Record<string, unknown>;
  const steamId = typeof r['steamId'] === 'string' ? r['steamId'] : '';
  const bannedTime = typeof r['bannedTime'] === 'string' ? r['bannedTime'] : '';
  if (steamId === '' || parseGameTime(bannedTime) === null) throw new ValidationError('which ban? steamId and bannedTime are needed');
  const out: { steamId: string; bannedTime: string; endsAt?: number | 'permanent'; reason?: string } = { steamId, bannedTime };
  if (r['endsAt'] === 'permanent') out.endsAt = 'permanent';
  else if (r['endsAt'] !== undefined) {
    const t = r['endsAt'];
    if (typeof t !== 'number' || !Number.isInteger(t) || t <= (parseGameTime(bannedTime) as number)) throw new ValidationError('the end must be after the ban');
    out.endsAt = t;
  }
  if (r['reason'] !== undefined) {
    const reason = field(String(r['reason'])).slice(0, 200);
    if (reason === '') throw new ValidationError('cần ghi lý do');
    out.reason = reason;
  }
  if (out.endsAt === undefined && out.reason === undefined) throw new ValidationError('nothing to change');
  return out;
}

// --- banning from the panel --------------------------------------------------

export interface BanRequest { steamId: string; name: string; reason: string; hours: number }
const STEAM_RE = /^7656119\d{10}$/;
/** RCON splits on commas: none in a name or a reason. */
const field = (s: string): string => s.replace(/[,\r\n]/g, ' ').replace(/\s+/g, ' ').trim();

export function validateBan(raw: unknown): BanRequest {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('body must be an object');
  const r = raw as Record<string, unknown>;
  const steamId = typeof r['steamId'] === 'string' ? r['steamId'].trim() : '';
  if (!STEAM_RE.test(steamId)) throw new ValidationError('SteamID64 không hợp lệ');
  const name = field(typeof r['name'] === 'string' ? r['name'] : '').slice(0, 60) || steamId;
  const reason = field(typeof r['reason'] === 'string' ? r['reason'] : '').slice(0, 200);
  if (reason === '') throw new ValidationError('cần ghi lý do ban');
  const hours = r['hours'];
  if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > PERMANENT_HOURS) {
    throw new ValidationError(`hours must be a whole number 1–${PERMANENT_HOURS}`);
  }
  return { steamId, name, reason, hours };
}

interface RconBan { readonly enabled: boolean; exec(opcode: number, args?: string): Promise<string>; directMessage(steamId: string, message: string): Promise<string> }

/** DM the player (if online), ban, kick. The announcement comes from the watcher, as for any ban. */
export async function banPlayer(rcon: RconBan, req: BanRequest, online: boolean, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<void> {
  if (!rcon.enabled) throw new ValidationError('RCON chưa được cấu hình');
  if (online) {
    const nowS = Math.floor(Date.now() / 1000);
    const vars = banVars({
      steamId: req.steamId, bannedTime: '', name: req.name, reason: req.reason, by: 'admin', bannedAt: nowS,
      endsAt: nowS + req.hours * 3600, permanent: req.hours >= PERMANENT_HOURS,
    });
    const text = renderMessage('ban.player', vars);
    if (text !== null) {
      await rcon.directMessage(req.steamId, text).catch(() => undefined);
      await sleep(2500);    // time to read it before the kick
    }
  }
  await rcon.exec(0x20, `${req.name},${req.steamId},${req.reason},${req.hours}`);
  if (online) await rcon.exec(0x30, req.steamId).catch(() => undefined);
}

// --- the reasons offered on the panel ------------------------------------------

export async function readReasons(): Promise<string[]> {
  try {
    const r = JSON.parse(await readFile(reasonsPath(), 'utf8')) as unknown;
    if (Array.isArray(r) && r.every((x) => typeof x === 'string')) return r as string[];
  } catch { /* the defaults */ }
  return [...DEFAULT_REASONS];
}

export async function saveReasons(raw: unknown): Promise<string[]> {
  if (!Array.isArray(raw) || raw.length > 40) throw new ValidationError('reasons: a list of at most 40');
  const list = [...new Set(raw.map((x, i) => {
    if (typeof x !== 'string') throw new ValidationError(`reason ${i + 1} is not text`);
    return field(x).slice(0, 200);
  }).filter((x) => x !== ''))];
  await mkdir(config.dataDir, { recursive: true });
  const tmp = `${reasonsPath()}.tmp`;
  await writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
  await rename(tmp, reasonsPath());
  return list;
}
