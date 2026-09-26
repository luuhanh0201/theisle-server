import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
 * after it a KickPlayer (0x30). There is no unban over RCON.
 *
 * The times in the file are the VPS's local time ("2026.09.26-10.56.54").
 */

export interface Ban {
  steamId: string;
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
      name: typeof o['playerName'] === 'string' ? o['playerName'] : o['steamId'],
      reason: typeof o['banReason'] === 'string' ? o['banReason'] : '',
      bannedAt, endsAt,
      permanent: bannedAt !== null && endsAt !== null && endsAt - bannedAt >= PERMANENT_S,
      by: typeof o['bannerName'] === 'string' ? o['bannerName'] : '?',
    }];
  });
}

export async function readBans(path = config.game.bansPath): Promise<Ban[]> {
  try {
    return parseBans(await readFile(path, 'utf8'));
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
const untilText = (b: Ban): string => (b.permanent || b.endsAt === null ? 'không hết hạn'
  : new Date(b.endsAt * 1000).toLocaleString('vi-VN', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }));

export const banVars = (b: Ban): Record<string, string> => ({
  name: b.name, reason: b.reason || '(không ghi)', duration: durationText(b), until: untilText(b), by: b.by === 'Rcon' ? 'admin' : b.by,
});

const key = (b: Ban): string => `${b.steamId}|${b.bannedAt ?? ''}`;

/**
 * Watches the game's list: each new ban once (the first read is the baseline:
 * a restart does not announce the old ones again).
 */
export class BanWatcher {
  #known: Set<string> | null = null;
  readonly #read: () => Promise<Ban[]>;
  readonly #onBan: (b: Ban) => void;

  constructor(onBan: (b: Ban) => void, read: () => Promise<Ban[]> = () => readBans()) {
    this.#onBan = onBan;
    this.#read = read;
  }

  async tick(): Promise<void> {
    const bans = await this.#read();
    const now = new Set(bans.map(key));
    if (this.#known === null) { this.#known = now; return; }
    for (const b of bans) if (!this.#known.has(key(b))) this.#onBan(b);
    this.#known = now;
  }
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
      steamId: req.steamId, name: req.name, reason: req.reason, by: 'admin', bannedAt: nowS,
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
