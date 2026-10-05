import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';

/**
 * The server's status board on Discord (owner's request, 2026-10-03, after
 * another server's): ONE message in the channel the panel picks (Discord →
 * "Bảng trạng thái"), edited in place every minute, not a new post each time:
 *
 *   **<ServerName from Game.ini>**
 *   🟢 Online
 *   Người chơi        3 / 100
 *   Khởi động lại tới  22:00 · in 3 hours
 *   Khởi động lại trước  at 11:00 3 Oct · 8 hours ago (đã lên lịch)
 *
 * Times go out as Discord timestamps (<t:…:R>): every reader's client shows
 * them in its own language and zone, "3 giờ tới" in Vietnamese.
 *
 * The message id is kept in DATA_DIR/discord-board.json with the webhook it
 * belongs to (a hash): another channel, or the message deleted in Discord
 * (404), and a new one is posted.
 */

export interface BoardInfo {
  name: string | null;
  /** power.ts phase: running, starting, stopping, stopped, failed, unknown. */
  phase: string;
  online: number;
  maxPlayers: number | null;
  /** Unix seconds of the next scheduled restart, or null (none scheduled). */
  next: number | null;
  /** The last start: when the game came up, and whether a scheduled restart made it. */
  last: { t: number; scheduled: boolean } | null;
  now: number;
}

const PHASE: Record<string, [string, number]> = {
  running: ['🟢  **Online**', 0x22c55e],
  starting: ['🔄  **Đang khởi động**', 0xf59e0b],
  stopping: ['⏳  **Đang tắt**', 0xf59e0b],
  stopped: ['🔴  **Offline**', 0xef4444],
  failed: ['🔴  **Offline** (gặp lỗi)', 0xef4444],
};

/** Server text as plain text in Discord (its markdown escaped). */
const plain = (s: string): string => s.replace(/[\\`*_~|>#[\]()<:-]/g, (c) => `\\${c}`);
const hhmm = (t: number): string => {
  const d = new Date(t * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** The board as a Discord embed. */
export function boardEmbed(b: BoardInfo): Record<string, unknown> {
  const [state, color] = PHASE[b.phase] ?? ['❔  **Không rõ**', 0x64748b];
  const lines = [
    state,
    `**Người chơi**  ${b.online}${b.maxPlayers !== null ? ` / ${b.maxPlayers}` : ''}`,
    b.next !== null
      ? `**Lần khởi động lại tới**  ${hhmm(b.next)}  ·  <t:${b.next}:R>`
      : '**Lần khởi động lại tới**  chưa có lịch',
    ...(b.last !== null
      ? [`**Lần khởi động lại trước**  lúc <t:${b.last.t}:f>  ·  <t:${b.last.t}:R>  (${b.last.scheduled ? 'đã lên lịch' : 'ngoài lịch'})`]
      : []),
  ];
  return {
    title: plain(b.name ?? 'Server'),
    description: lines.join('\n'),
    color,
    footer: { text: 'Tự cập nhật mỗi phút' },
    timestamp: new Date(b.now * 1000).toISOString(),
  };
}

/** "YYYY-MM-DD HH:MM" (power.ts Schedule.lastFired, server local time) → unix seconds, or null. */
export function firedAt(key: string | null): number | null {
  const m = key === null ? null : /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(key);
  if (m === null) return null;
  return Math.floor(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime() / 1000);
}

/** A start this soon after a scheduled restart's time is that restart (the game takes a few minutes to come up). */
export const SCHEDULED_START_WINDOW = 20 * 60;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ status: number; text(): Promise<string> }>;

const boardPath = (): string => join(config.dataDir, 'discord-board.json');
const hookKey = (url: string): string => createHash('sha256').update(url).digest('hex').slice(0, 16);

export class StatusBoard {
  #message: { hook: string; id: string } | null = null;
  #loaded = false;
  #lastBody = '';
  #lastAt = 0;
  lastError: string | null = null;
  readonly #fetch: FetchLike;
  readonly #save: (v: unknown) => Promise<void>;

  constructor(opts: { fetch?: FetchLike; save: (v: unknown) => Promise<void> }) {
    this.#fetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.#save = opts.save;
  }

  async #load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const d = JSON.parse(await readFile(boardPath(), 'utf8')) as { hook?: unknown; id?: unknown };
      if (typeof d.hook === 'string' && typeof d.id === 'string' && /^\d{15,22}$/.test(d.id)) this.#message = { hook: d.hook, id: d.id };
    } catch { /* none yet */ }
  }

  /**
   * The board brought up to date on the webhook `url`: the message edited, or
   * posted (first time, another channel, deleted in Discord). Unchanged content
   * is sent again at most every 5 minutes (the "updated" time moves).
   */
  async update(url: string, embed: Record<string, unknown>, nowMs = Date.now()): Promise<void> {
    await this.#load();
    const { timestamp: _t, ...content } = embed;
    const body = JSON.stringify(content);
    const hook = hookKey(url);
    const mine = this.#message !== null && this.#message.hook === hook ? this.#message : null;
    if (mine !== null && body === this.#lastBody && nowMs - this.#lastAt < 5 * 60_000) return;
    const payload = JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } });
    if (mine !== null) {
      const res = await this.#fetch(`${url}/messages/${mine.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: payload, signal: AbortSignal.timeout(10_000),
      });
      if (res.status >= 200 && res.status < 300) { this.#done(body, nowMs); return; }
      if (res.status !== 404) { this.lastError = `Discord trả ${res.status} khi sửa bảng`; return; }
      // Deleted in Discord: a new one below.
    }
    const res = await this.#fetch(`${url}?wait=true`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, signal: AbortSignal.timeout(10_000),
    });
    if (res.status < 200 || res.status >= 300) { this.lastError = `Discord trả ${res.status} khi đăng bảng`; return; }
    const id = (JSON.parse(await res.text()) as { id?: unknown }).id;
    if (typeof id !== 'string') { this.lastError = 'Discord không trả id tin'; return; }
    this.#message = { hook, id };
    await this.#save(this.#message);
    this.#done(body, nowMs);
  }

  #done(body: string, nowMs: number): void {
    this.#lastBody = body;
    this.#lastAt = nowMs;
    this.lastError = null;
  }
}

export { boardPath };
