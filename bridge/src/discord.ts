import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { ValidationError } from './garage.js';
import type { FeedEntry } from './store.js';
import type { AuditEntry } from './audit.js';

/**
 * The server's log on Discord, through channel webhooks (panel → Quản trị →
 * Discord): the admin adds a webhook per Discord channel and picks, per kind
 * of log, the channel it goes to (or none).
 *
 *   DATA_DIR/discord.json        the settings, webhook URLs included (never
 *                                sent back to the panel whole)
 *   DATA_DIR/discord-queue.json  what is still to send: a Discord outage, a
 *                                cut network or a DDoS only delays the log,
 *                                it is sent (with its own time) once through
 *
 * Only outgoing HTTPS: nothing listens on the VPS for Discord. Several lines
 * go in one message (up to 10 embeds), a 429 waits what Discord says, other
 * failures back off. Player text never pings anyone (allowed_mentions) and
 * its markdown is escaped. On a start the event files are replayed: only
 * what happened after the bridge came up is sent.
 */

export type DiscordKind =
  | 'join' | 'leave' | 'chat' | 'kill' | 'death' | 'spawn' | 'growth' | 'mutation'
  | 'garage' | 'adminKill' | 'ban' | 'server' | 'ddos' | 'announce' | 'admin';

export const DISCORD_KINDS: ReadonlyArray<{ key: DiscordKind; group: string; label: string }> = [
  { key: 'join', group: 'Người chơi', label: 'Vào server' },
  { key: 'leave', group: 'Người chơi', label: 'Rời server' },
  { key: 'chat', group: 'Người chơi', label: 'Chat trong game' },
  { key: 'kill', group: 'Chiến đấu', label: 'Người chơi giết người chơi' },
  { key: 'death', group: 'Chiến đấu', label: 'Chết khác (AI, rơi, đói…)' },
  { key: 'spawn', group: 'Dino', label: 'Spawn dino' },
  { key: 'growth', group: 'Dino', label: 'Lên mốc tăng trưởng' },
  { key: 'mutation', group: 'Dino', label: 'Mutation mới' },
  { key: 'garage', group: 'Dino', label: 'Gara: cất / lấy dino' },
  { key: 'adminKill', group: 'Quản trị', label: 'Admin xoá dino' },
  { key: 'ban', group: 'Quản trị', label: 'Ban, gỡ ban, sửa ban (lý do, ngày, người làm)' },
  { key: 'admin', group: 'Quản trị', label: 'Nhật ký admin (mọi thao tác trên panel)' },
  { key: 'server', group: 'Server', label: 'Server bật / tắt / lỗi' },
  { key: 'ddos', group: 'Server', label: 'Nghi bị DDoS (lưu lượng vào bất thường) và lúc hết' },
  { key: 'announce', group: 'Server', label: 'Thông báo toàn server (RCON)' },
];
const KIND_KEYS: ReadonlySet<string> = new Set(DISCORD_KINDS.map((k) => k.key));

export interface DiscordChannel { id: string; name: string; url: string }
export interface DiscordSettings {
  enabled: boolean;
  channels: DiscordChannel[];
  routes: Partial<Record<DiscordKind, string>>;
  /** The relay off the VPS (relay/, a Cloudflare Worker): heartbeat, outage alerts, /status. */
  relay: { url: string; secret: string } | null;
}
export const DISCORD_DEFAULTS: DiscordSettings = { enabled: false, channels: [], routes: {}, relay: null };

const WEBHOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/(\d{15,22})\/([\w-]{20,100})$/;
const MAX_CHANNELS = 10;
const settingsPath = (): string => join(config.dataDir, 'discord.json');
const queuePath = (): string => join(config.dataDir, 'discord-queue.json');

/** "…/webhooks/1234…/abcd" → a hint that names the webhook without giving it away. */
export function maskUrl(url: string): string {
  const m = WEBHOOK_RE.exec(url);
  return m ? `webhook ${m[1]} · …${(m[2] as string).slice(-4)}` : '';
}

export function validateDiscord(raw: unknown, before: DiscordSettings = DISCORD_DEFAULTS, opts: { unique?: boolean } = {}): DiscordSettings {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('body must be an object');
  const r = raw as Record<string, unknown>;
  if (typeof r['enabled'] !== 'boolean') throw new ValidationError('enabled must be true or false');
  const list = r['channels'] ?? [];
  if (!Array.isArray(list) || list.length > MAX_CHANNELS) throw new ValidationError(`channels: at most ${MAX_CHANNELS}`);
  const old = new Map(before.channels.map((c) => [c.id, c]));
  const channels = list.map((c, i): DiscordChannel => {
    if (typeof c !== 'object' || c === null) throw new ValidationError(`channel ${i + 1} is not an object`);
    const o = c as Record<string, unknown>;
    const id = typeof o['id'] === 'string' && /^[a-z0-9]{1,16}$/.test(o['id']) ? o['id'] : randomBytes(4).toString('hex');
    const name = typeof o['name'] === 'string' ? o['name'].trim().slice(0, 40) : '';
    if (name === '') throw new ValidationError(`channel ${i + 1}: a name is required`);
    // No URL sent: the one saved stays (the panel never gets it back whole).
    const sent = typeof o['url'] === 'string' ? o['url'].trim() : '';
    const url = sent !== '' ? sent : old.get(id)?.url ?? '';
    if (!WEBHOOK_RE.test(url)) throw new ValidationError(`channel "${name}": paste the webhook URL (https://discord.com/api/webhooks/…)`);
    return { id, name, url };
  });
  if (new Set(channels.map((c) => c.id)).size !== channels.length) throw new ValidationError('two channels have the same id');
  // One webhook posts into one Discord channel: the same URL twice would send both lists to the same place.
  const seen = new Map<string, string>();
  // Checked on a save; a file saved before this check still loads (and says so on the panel).
  for (const c of opts.unique === false ? [] : channels) {
    const other = seen.get(c.url);
    if (other !== undefined) {
      throw new ValidationError(`"${c.name}" và "${other}" đang dùng cùng một webhook — mỗi kênh Discord cần một webhook riêng (tạo trong chính kênh đó)`);
    }
    seen.set(c.url, c.name);
  }
  const ids = new Set(channels.map((c) => c.id));
  const routesRaw = r['routes'] ?? {};
  if (typeof routesRaw !== 'object' || routesRaw === null || Array.isArray(routesRaw)) throw new ValidationError('routes must be an object');
  const routes: DiscordSettings['routes'] = {};
  for (const [k, v] of Object.entries(routesRaw)) {
    if (!KIND_KEYS.has(k)) throw new ValidationError(`unknown log kind "${k}"`);
    if (v === null || v === '') continue;
    if (typeof v !== 'string' || !ids.has(v)) throw new ValidationError(`${k}: unknown channel`);
    routes[k as DiscordKind] = v;
  }
  // The relay: its URL, and the secret shared with it (kept when not sent again).
  let relay: DiscordSettings['relay'] = null;
  const rr = r['relay'];
  if (rr !== undefined && rr !== null) {
    if (typeof rr !== 'object') throw new ValidationError('relay must be an object');
    const o = rr as Record<string, unknown>;
    const url = typeof o['url'] === 'string' ? o['url'].trim().replace(/\/+$/, '') : '';
    if (url !== '') {
      if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[\w.-]*)*$/i.test(url)) throw new ValidationError('trạm: URL phải là https://…');
      const sent = typeof o['secret'] === 'string' ? o['secret'].trim() : '';
      const secret = sent !== '' ? sent : before.relay?.secret ?? '';
      if (!/^[\w-]{24,200}$/.test(secret)) throw new ValidationError('trạm: mã bí mật cần 24–200 ký tự chữ/số');
      relay = { url, secret };
    }
  }
  return { enabled: r['enabled'], channels, routes, relay };
}

export async function readDiscord(): Promise<DiscordSettings> {
  try {
    return validateDiscord(JSON.parse(await readFile(settingsPath(), 'utf8')), DISCORD_DEFAULTS, { unique: false });
  } catch {
    return structuredClone(DISCORD_DEFAULTS);
  }
}

/** What the panel sees: the URLs only as hints. */
export function publicView(s: DiscordSettings): unknown {
  return {
    enabled: s.enabled, routes: s.routes, channels: s.channels.map((c) => ({ id: c.id, name: c.name, hint: maskUrl(c.url) })),
    relay: s.relay ? { url: s.relay.url, hasSecret: true } : null,
  };
}

async function writePrivate(path: string, value: unknown): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, path);
}

// --- what a log line says ----------------------------------------------------

/** Player text as plain text in Discord: no markdown, no masked links. */
export const plain = (s: string): string => s.replace(/[\\`*_~|>#[\]()<:-]/g, (c) => `\\${c}`).slice(0, 500);
const species = (cls: string | undefined): string => String(cls ?? '?').split('.').pop()?.replace(/^BP_/, '').replace(/_C$/, '') ?? '?';
const pct = (g: number | null | undefined): string => (typeof g === 'number' ? ` ${Math.round(g * 100)}%` : '');
const who = (name: string | undefined, steamId: string): string => `**${plain(name ?? steamId)}**`;
const idOf = (steamId: string): string => ` \`${steamId}\``;
function duration(s: number | undefined): string {
  if (typeof s !== 'number' || s <= 0) return '';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h} giờ ${m} phút` : `${m} phút`;
}

export const COLORS: Record<DiscordKind, number> = {
  join: 0x22c55e, leave: 0x64748b, chat: 0x60a5fa, kill: 0xef4444, death: 0x94a3b8, spawn: 0x10b981,
  growth: 0x84cc16, mutation: 0xa855f7, garage: 0xf59e0b, adminKill: 0xf97316, ban: 0xdc2626, ddos: 0xb91c1c, server: 0x0ea5e9, announce: 0xeab308, admin: 0x6366f1,
};

export interface LogLine { kind: DiscordKind; text: string; t: number }

/** A feed entry as a log line, or null when it is not one (damage, prime…). */
export function lineOf(e: FeedEntry): LogLine | null {
  const t = e.t;
  switch (e.type) {
    case 'session_start':
      return { kind: 'join', t, text: `🟢 ${who(e.name, e.steamId)} vào server${idOf(e.steamId)}` };
    case 'session_end': {
      const d = duration(e.duration);
      return { kind: 'leave', t, text: `🔴 ${who(e.name, e.steamId)} rời server${d ? ` (chơi ${d})` : ''}${idOf(e.steamId)}` };
    }
    case 'chat':
      return { kind: 'chat', t, text: `💬 ${who(e.name, e.steamId)}: ${plain(e.message)}` };
    case 'death': {
      if (e.cause !== undefined) return null;          // stored in the garage / removed by an admin: not a death
      const victim = `${who(e.name, e.steamId)} (${species(e.species)}${pct(e.growth)})`;
      const life = duration(e.lifeSeconds);
      if (e.killer !== undefined && e.killer !== 'ai') {
        const killer = `${who(e.killerName, e.killer)} (${species(e.killerSpecies)}${pct(e.killerGrowth)})`;
        return { kind: 'kill', t, text: `⚔️ ${killer} đã giết ${victim}${life ? ` — sống được ${life}` : ''}` };
      }
      return { kind: 'death', t, text: `💀 ${victim} đã chết${life ? ` sau ${life}` : ''}` };
    }
    case 'spawn':
      return { kind: 'spawn', t, text: `🦖 ${who(e.name, e.steamId)} spawn ${species(e.species)}${pct(e.growth)}` };
    case 'growth':
      return { kind: 'growth', t, text: `📈 ${who(e.name, e.steamId)} — ${species(e.species)} lên ${Math.round(e.milestone * 100)}%` };
    case 'mutation':
      return e.to ? { kind: 'mutation', t, text: `🧬 ${who(e.name, e.steamId)} — ${species(e.species)} có mutation **${plain(e.to)}**` } : null;
    case 'garage_store':
      return { kind: 'garage', t, text: `📦 ${who(e.name, e.steamId)} cất ${species(e.species)}${pct(e.growth)} vào gara (${plain(e.slot)})` };
    case 'garage_redeem':
      return e.ok ? { kind: 'garage', t, text: `📤 ${who(e.name, e.steamId)} lấy ${species(e.species)}${pct(e.growth)} từ gara (${plain(e.slot)})` } : null;
    case 'admin_kill':
      return { kind: 'adminKill', t, text: `🗡️ Admin xoá dino của ${who(e.name, e.steamId)}${e.species ? ` (${species(e.species)}${pct(e.growth)})` : ''}${e.ok ? '' : ` — không được: ${plain(e.error ?? '?')}`}` };
    default:
      return null;
  }
}

/** A ban from the game's list (bans.ts): who, how long, why, by whom. */
export function banLine(b: { steamId: string; name: string; reason: string; bannedAt: number | null }, vars: Record<string, string>): LogLine {
  return {
    kind: 'ban', t: b.bannedAt ?? Math.floor(Date.now() / 1000),
    text: `⛔ **${plain(b.name)}**${idOf(b.steamId)} bị ban **${plain(vars['duration'] ?? '')}** — bởi ${plain(vars['by'] ?? '?')}`
      + `\n**Lý do:** ${plain(b.reason || '(không ghi)')}`
      + `\n**Ban lúc:** ${plain(vars['since'] ?? '?')} · **Hết hạn:** ${plain(vars['until'] ?? '?')}`,
  };
}

/** A ban unbanned (after = null) or changed from the panel: what it was, what it is, who did it. */
export function banChangeLine(before: { steamId: string; name: string; reason: string }, beforeVars: Record<string, string>,
  after: { reason: string } | null, afterVars: Record<string, string> | null, by: string): LogLine {
  const t = Math.floor(Date.now() / 1000);
  if (after === null || afterVars === null) {
    return { kind: 'ban', t, text: `✅ Gỡ ban **${plain(before.name)}**${idOf(before.steamId)} — bởi ${plain(by)}`
      + `\n**Lý do ban cũ:** ${plain(before.reason || '(không ghi)')}\n**Ban lúc:** ${plain(beforeVars['since'] ?? '?')} · **Hết hạn cũ:** ${plain(beforeVars['until'] ?? '?')}` };
  }
  const lines = [`✏️ Sửa ban **${plain(before.name)}**${idOf(before.steamId)} — bởi ${plain(by)}`];
  if (beforeVars['until'] !== afterVars['until']) {
    lines.push(`**Thời hạn:** ${plain(beforeVars['duration'] ?? '')} (hết ${plain(beforeVars['until'] ?? '')}) → **${plain(afterVars['duration'] ?? '')}** (hết ${plain(afterVars['until'] ?? '')})`);
  }
  if (before.reason !== after.reason) lines.push(`**Lý do:** ${plain(before.reason || '(không ghi)')} → **${plain(after.reason || '(không ghi)')}**`);
  lines.push(`**Ban lúc:** ${plain(afterVars['since'] ?? '?')}`);
  return { kind: 'ban', t, text: lines.join('\n') };
}

export function auditLine(a: AuditEntry): LogLine {
  return {
    kind: 'admin', t: a.t,
    text: `🛠️ ${a.byName ? `**${plain(a.byName)}**` : a.by ? plain(a.by) : 'hệ thống'}: ${plain(a.action)}`
      + `${a.detail ? ` — ${plain(a.detail).slice(0, 300)}` : ''}${a.ok ? '' : ` ❌ ${plain(a.error ?? 'lỗi')}`}`,
  };
}

const PHASE_TEXT: Record<string, string> = {
  running: '✅ Server đã chạy — vào được', starting: '🔄 Server đang khởi động…', stopping: '⏳ Server đang tắt…',
  stopped: '⏹️ Server đã tắt', failed: '⚠️ Server gặp lỗi và dừng (crash?)',
};
/** A change of the game server's state (null when it says nothing new). */
export function phaseLine(from: string | null, to: string, t: number, planned: boolean): LogLine | null {
  if (from === to || to === 'unknown' || !PHASE_TEXT[to]) return null;
  const text = from === 'running' && !planned && (to === 'stopped' || to === 'starting' || to === 'failed')
    ? '⚠️ Server dừng bất ngờ (crash?) — đang chờ nó chạy lại'
    : PHASE_TEXT[to] as string;
  return { kind: 'server', t, text };
}

// --- the sender ---------------------------------------------------------------

interface Queued { ch: string; kind: DiscordKind; text: string; t: number }
export interface ChannelState { queued: number; lastOkAt: number | null; lastError: string | null; waitUntil: number }
/** What Discord says about a webhook (GET on its URL): its name and the channel it posts in. */
export interface WebhookInfo { name: string | null; channelId: string | null; error: string | null; at: number }
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ status: number; text(): Promise<string> }>;

const MAX_QUEUE = 3000;
const PER_MESSAGE = 10;
const MESSAGE_CHARS = 5500;

export class DiscordLog {
  #settings: DiscordSettings = structuredClone(DISCORD_DEFAULTS);
  #queue: Queued[] = [];
  #state = new Map<string, ChannelState>();
  #dropped = 0;
  readonly #info = new Map<string, WebhookInfo>();
  /** The relay's heartbeat: last sent, last error (relay.ts). */
  readonly relayState: { lastOkAt: number | null; lastError: string | null } = { lastOkAt: null, lastError: null };
  #saveTimer: NodeJS.Timeout | null = null;
  #sending = false;
  readonly #since: number;
  readonly #fetch: FetchLike;
  readonly #now: () => number;

  constructor(opts: { startedAt: number; fetch?: FetchLike; now?: () => number }) {
    this.#since = opts.startedAt - 10;
    this.#fetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.#now = opts.now ?? Date.now;
  }

  async load(): Promise<void> {
    this.#settings = await readDiscord();
    try {
      const q = JSON.parse(await readFile(queuePath(), 'utf8')) as Queued[];
      if (Array.isArray(q)) this.#queue = q.filter((x) => x && typeof x.text === 'string' && typeof x.ch === 'string');
    } catch { /* nothing waiting */ }
  }

  get settings(): DiscordSettings { return this.#settings; }

  async save(raw: unknown): Promise<DiscordSettings> {
    const s = validateDiscord(raw, this.#settings);
    await writePrivate(settingsPath(), s);
    this.#settings = s;
    // Lines for a channel that is gone are dropped.
    const ids = new Set(s.channels.map((c) => c.id));
    this.#queue = this.#queue.filter((q) => ids.has(q.ch));
    this.#persistSoon();
    return s;
  }

  /** A line to log, if its kind goes to a channel. Lines from before this start (a replay) are not. */
  post(line: LogLine | null): void {
    if (line === null || !this.#settings.enabled || line.t < this.#since) return;
    const ch = this.#settings.routes[line.kind];
    if (!ch) return;
    this.#queue.push({ ch, kind: line.kind, text: line.text.slice(0, 1500), t: line.t });
    if (this.#queue.length > MAX_QUEUE) {
      this.#dropped += this.#queue.length - MAX_QUEUE;
      this.#queue.splice(0, this.#queue.length - MAX_QUEUE);
    }
    this.#persistSoon();
  }

  status(): { queued: number; dropped: number; relay: { lastOkAt: number | null; lastError: string | null }; channels: Record<string, ChannelState & { webhook: WebhookInfo | null }> } {
    const channels: Record<string, ChannelState & { webhook: WebhookInfo | null }> = {};
    for (const c of this.#settings.channels) {
      const st = this.#state.get(c.id);
      channels[c.id] = {
        queued: this.#queue.filter((q) => q.ch === c.id).length,
        lastOkAt: st?.lastOkAt ?? null, lastError: st?.lastError ?? null, waitUntil: st?.waitUntil ?? 0,
        webhook: this.#info.get(c.url) ?? null,
      };
    }
    return { queued: this.#queue.length, dropped: this.#dropped, relay: { ...this.relayState }, channels };
  }

  /** Ask Discord for each webhook's name and channel (at most every 10 minutes each). */
  async refreshInfo(force = false): Promise<void> {
    const now = this.#now();
    for (const c of this.#settings.channels) {
      const known = this.#info.get(c.url);
      if (!force && known && now - known.at < 600_000) continue;
      try {
        const res = await this.#fetch(c.url, { method: 'GET', headers: {}, signal: AbortSignal.timeout(8000) });
        const text = await res.text().catch(() => '');
        if (res.status >= 200 && res.status < 300) {
          const j = JSON.parse(text) as { name?: unknown; channel_id?: unknown };
          this.#info.set(c.url, { name: typeof j.name === 'string' ? j.name : null, channelId: typeof j.channel_id === 'string' ? j.channel_id : null, error: null, at: now });
        } else {
          this.#info.set(c.url, { name: null, channelId: null, error: res.status === 404 || res.status === 401 ? 'webhook không còn' : `Discord trả ${res.status}`, at: now });
        }
      } catch (error) {
        this.#info.set(c.url, { name: null, channelId: null, error: (error as Error).message, at: now });
      }
    }
  }

  /** Send what is due: one message per channel per call (called every couple of seconds). */
  async tick(): Promise<void> {
    if (this.#sending || this.#queue.length === 0) return;
    this.#sending = true;
    try {
      const now = this.#now();
      for (const c of this.#settings.channels) {
        const st = this.#stateOf(c.id);
        if (st.waitUntil > now) continue;
        const batch: Queued[] = [];
        let chars = 0;
        for (const q of this.#queue) {
          if (q.ch !== c.id) continue;
          if (batch.length >= PER_MESSAGE || chars + q.text.length > MESSAGE_CHARS) break;
          batch.push(q);
          chars += q.text.length;
        }
        if (batch.length === 0) continue;
        const result = await this.#send(c.url, batch);
        if (result === 'sent' || result === 'rejected') {
          const gone = new Set(batch);
          this.#queue = this.#queue.filter((q) => !gone.has(q));
          this.#persistSoon();
        }
      }
    } finally {
      this.#sending = false;
    }
  }

  /** A test message straight to one channel (panel button); the error as text, or null. */
  async test(channelId: string, who: string): Promise<string | null> {
    const c = this.#settings.channels.find((x) => x.id === channelId);
    if (!c) return 'kênh không tồn tại (lưu trước đã)';
    const r = await this.#send(c.url, [{ ch: c.id, kind: 'admin', t: Math.floor(this.#now() / 1000), text: `✅ Thử kết nối từ panel — ${plain(who)}` }]);
    return r === 'sent' ? null : this.#stateOf(c.id).lastError ?? 'không gửi được';
  }

  async #send(url: string, batch: Queued[]): Promise<'sent' | 'retry' | 'rejected'> {
    const ch = batch[0]?.ch ?? '';
    const st = this.#stateOf(ch);
    const now = this.#now();
    const body = JSON.stringify({
      // No username / avatar: the webhook's own, as set in Discord, are shown.
      allowed_mentions: { parse: [] },
      embeds: batch.map((q) => ({ description: q.text, color: COLORS[q.kind], timestamp: new Date(q.t * 1000).toISOString() })),
    });
    try {
      const res = await this.#fetch(`${url}?wait=true`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(10_000),
      });
      if (res.status >= 200 && res.status < 300) {
        st.lastOkAt = Math.floor(now / 1000);
        st.lastError = null;
        st.fails = 0;
        return 'sent';
      }
      const text = await res.text().catch(() => '');
      if (res.status === 429) {
        let wait = 5;
        try { wait = Number((JSON.parse(text) as { retry_after?: number }).retry_after) || 5; } catch { /* default */ }
        st.waitUntil = now + Math.ceil(wait * 1000);
        st.lastError = `Discord bảo chờ ${wait} s (quá nhiều tin)`;
        return 'retry';
      }
      if (res.status >= 500) return this.#backoff(st, now, `Discord lỗi ${res.status}`);
      // 4xx: the webhook is gone or the message is refused — waiting will not help.
      st.lastError = res.status === 404 || res.status === 401 ? 'webhook không còn (bị xoá?) — dán lại URL' : `Discord từ chối (${res.status}) ${text.slice(0, 120)}`;
      return 'rejected';
    } catch (error) {
      return this.#backoff(st, now, `không gửi được: ${(error as Error).message}`);
    }
  }

  #backoff(st: ChannelState & { fails?: number }, now: number, why: string): 'retry' {
    st.fails = (st.fails ?? 0) + 1;
    st.waitUntil = now + Math.min(60_000, 2000 * 2 ** Math.min(st.fails, 5));
    st.lastError = why;
    return 'retry';
  }

  #stateOf(id: string): ChannelState & { fails?: number } {
    let st = this.#state.get(id);
    if (!st) { st = { queued: 0, lastOkAt: null, lastError: null, waitUntil: 0 }; this.#state.set(id, st); }
    return st;
  }

  #persistSoon(): void {
    if (this.#saveTimer) return;
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      writePrivate(queuePath(), this.#queue).catch((error: unknown) => console.error('[discord] cannot save the queue:', error));
    }, 1000);
    this.#saveTimer.unref?.();
  }
}
