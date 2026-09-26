/**
 * The Discord relay — a Cloudflare Worker, off the VPS (relay/README.md).
 *
 *   POST /heartbeat     the bridge, every 2 minutes (Bearer BRIDGE_SECRET):
 *                       the server's state now, kept in KV
 *   cron, every minute  no heartbeat for STALE_S: "server unreachable" on
 *                       Discord (once), through the webhook the bridge named;
 *                       the next heartbeat says it is back
 *   POST /interactions  Discord's slash commands (signed, Ed25519): /status,
 *                       /online — answered from the last heartbeat, so they
 *                       work while the VPS is down, DDoSed or cut off
 *
 * Nothing on the VPS listens for this: the bridge only sends out. KV writes
 * stay under the free plan's 1 000 a day (a heartbeat every 2 min = 720).
 * Only type annotations beyond plain JS, so Node runs the tests on the source.
 */

export interface Env {
  STATE: KVNamespace;
  BRIDGE_SECRET: string;
  DISCORD_PUBLIC_KEY: string;
}

/** What the bridge sends, and what is kept. */
export interface ServerState {
  /** Unix seconds of the heartbeat. */
  t: number;
  serverName: string;
  phase: string;
  online: number;
  maxPlayers: number | null;
  players: string[];
  fps: number | null;
  ai: number | null;
  /** Where to post "unreachable" / "back": the Discord webhook of the server-status log. */
  alertWebhook: string | null;
  /** A DDoS the bridge sees going on (bridge/src/ddos.ts), or null. */
  attack: { since: number; peakPps: number; peakMbps: number } | null;
  /** Set once the outage was told, cleared by the next heartbeat. */
  alertedAt?: number;
}

export const STALE_S = 300;
const KEY = 'state';
const WEBHOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{15,22}\/[\w-]{20,100}$/;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Constant-time string compare. */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The heartbeat as sent, kept to what it may hold. */
export function cleanHeartbeat(raw: unknown, now: number): ServerState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const hook = str(r['alertWebhook'], 300);
  return {
    t: now,
    serverName: str(r['serverName'], 100) || 'Server',
    phase: str(r['phase'], 20) || 'unknown',
    online: Math.max(0, Math.floor(num(r['online']) ?? 0)),
    maxPlayers: num(r['maxPlayers']),
    players: Array.isArray(r['players']) ? r['players'].filter((p): p is string => typeof p === 'string').slice(0, 100).map((p) => p.slice(0, 40)) : [],
    fps: num(r['fps']),
    ai: num(r['ai']),
    alertWebhook: WEBHOOK_RE.test(hook) ? hook : null,
    attack: attackOf(r['attack']),
  };
}

function attackOf(v: unknown): ServerState['attack'] {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const since = num(o['since']);
  return since === null ? null : { since, peakPps: num(o['peakPps']) ?? 0, peakMbps: num(o['peakMbps']) ?? 0 };
}

/** Player text as plain text in Discord. */
export const plain = (s: string): string => s.replace(/[\\`*_~|>#[\]()<:-]/g, (c) => `\\${c}`);

const PHASE: Record<string, string> = {
  running: '🟢 Đang chạy', starting: '🔄 Đang khởi động', stopping: '⏳ Đang tắt', stopped: '⏹️ Đã tắt', failed: '⚠️ Gặp lỗi', unknown: '❔ Không rõ',
};

/** The /status answer. */
export function statusEmbed(s: ServerState | null, now: number): Record<string, unknown> {
  if (s === null) return { title: 'Server', description: 'Chưa nhận được tín hiệu nào từ server.', color: 0x64748b };
  const stale = now - s.t > STALE_S;
  const fields = [
    { name: 'Người chơi', value: `${s.online}${s.maxPlayers ? ` / ${s.maxPlayers}` : ''}`, inline: true },
    ...(s.fps !== null && !stale ? [{ name: 'FPS server', value: String(Math.round(s.fps)), inline: true }] : []),
    ...(s.ai !== null && !stale ? [{ name: 'AI', value: String(s.ai), inline: true }] : []),
  ];
  return {
    title: plain(s.serverName),
    description: (stale
      ? `🔴 **Mất kết nối** — tín hiệu cuối <t:${s.t}:R> (<t:${s.t}:f>). VPS có thể đang sập, mất mạng hoặc bị DDoS.`
      : `${PHASE[s.phase] ?? plain(s.phase)} · cập nhật <t:${s.t}:R>`)
      + (s.attack ? `\n🚨 **Đang bị DDoS** từ <t:${s.attack.since}:R> — đỉnh ${Math.round(s.attack.peakPps).toLocaleString('vi-VN')} gói/s · ${s.attack.peakMbps} Mbit/s` : ''),
    color: stale || s.attack ? 0xef4444 : s.phase === 'running' ? 0x22c55e : 0xf59e0b,
    fields: stale ? [{ name: 'Lần cuối', value: `${s.online} người online`, inline: true }] : fields,
  };
}

/** The /online answer. */
export function onlineText(s: ServerState | null, now: number): string {
  if (s === null) return 'Chưa nhận được tín hiệu nào từ server.';
  if (now - s.t > STALE_S) return `🔴 Mất kết nối với server từ <t:${s.t}:R> — không biết ai đang online.`;
  if (s.players.length === 0) return `Không có ai online (cập nhật <t:${s.t}:R>).`;
  const names = s.players.map(plain);
  return `**${s.online} người online** (cập nhật <t:${s.t}:R>):\n${names.join(', ')}`.slice(0, 1900);
}

const hexToBytes = (hex: string): Uint8Array => new Uint8Array((hex.match(/../g) ?? []).map((b) => parseInt(b, 16)));

/** Discord's signature on an interaction (Ed25519 over timestamp + body). */
export async function verifyDiscord(publicKeyHex: string, signatureHex: string, timestamp: string, body: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex) || !/^[0-9a-f]{128}$/i.test(signatureHex) || timestamp === '') return false;
  try {
    const key = await crypto.subtle.importKey('raw', hexToBytes(publicKeyHex), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, hexToBytes(signatureHex), new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

async function readState(env: Env): Promise<ServerState | null> {
  return (await env.STATE.get<ServerState>(KEY, 'json')) ?? null;
}

async function postWebhook(url: string, text: string, color: number): Promise<boolean> {
  const res = await fetch(`${url}?wait=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, embeds: [{ description: text, color, timestamp: new Date().toISOString() }] }),
  }).catch(() => null);
  return res !== null && res.ok;
}

const nowS = (): number => Math.floor(Date.now() / 1000);
const minutes = (s: number): string => (s >= 3600 ? `${Math.floor(s / 3600)} giờ ${Math.round((s % 3600) / 60)} phút` : `${Math.max(1, Math.round(s / 60))} phút`);

export async function handleHeartbeat(req: Request, env: Env, now = nowS()): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  if (!env.BRIDGE_SECRET || !sameSecret(auth, `Bearer ${env.BRIDGE_SECRET}`)) return json({ error: 'unauthorized' }, 401);
  const state = cleanHeartbeat(await req.json().catch(() => null), now);
  if (state === null) return json({ error: 'bad heartbeat' }, 400);
  const before = await readState(env);
  // Back after an outage that was told: say so.
  if (before?.alertedAt && state.alertWebhook) {
    await postWebhook(state.alertWebhook, `✅ **Kết nối lại với server** sau ${minutes(now - before.t)} mất tín hiệu (từ <t:${before.t}:t>).`, 0x22c55e);
  }
  await env.STATE.put(KEY, JSON.stringify(state));
  return json({ ok: true });
}

/** The cron: an outage told once. */
export async function checkOutage(env: Env, now = nowS()): Promise<'none' | 'ok' | 'told' | 'already'> {
  const s = await readState(env);
  if (s === null) return 'none';
  if (now - s.t <= STALE_S) return 'ok';
  if (s.alertedAt) return 'already';
  if (s.alertWebhook) {
    const sent = await postWebhook(s.alertWebhook,
      `⚠️ **Mất kết nối với server** — không có tín hiệu từ <t:${s.t}:t> (<t:${s.t}:R>). VPS có thể đang sập, mất mạng hoặc bị DDoS.\nLần cuối: ${s.online} người online.`,
      0xef4444);
    if (!sent) return 'none';          // try again next minute
  }
  await env.STATE.put(KEY, JSON.stringify({ ...s, alertedAt: now }));
  return 'told';
}

export async function handleInteraction(req: Request, env: Env, now = nowS()): Promise<Response> {
  const body = await req.text();
  const ok = await verifyDiscord(env.DISCORD_PUBLIC_KEY, req.headers.get('x-signature-ed25519') ?? '', req.headers.get('x-signature-timestamp') ?? '', body);
  if (!ok) return new Response('bad signature', { status: 401 });
  const i = JSON.parse(body) as { type: number; data?: { name?: string } };
  if (i.type === 1) return json({ type: 1 });                    // PING
  if (i.type !== 2) return json({ type: 4, data: { content: 'Không hỗ trợ.', flags: 64 } });
  const s = await readState(env);
  switch (i.data?.name) {
    case 'status':
      return json({ type: 4, data: { embeds: [statusEmbed(s, now)], allowed_mentions: { parse: [] } } });
    case 'online':
      return json({ type: 4, data: { content: onlineText(s, now), allowed_mentions: { parse: [] } } });
    default:
      return json({ type: 4, data: { content: 'Lệnh không có.', flags: 64 } });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === 'POST' && pathname === '/heartbeat') return handleHeartbeat(req, env);
    if (req.method === 'POST' && pathname === '/interactions') return handleInteraction(req, env);
    if (req.method === 'GET' && pathname === '/') return new Response('theisle discord relay: ok');
    return new Response('not found', { status: 404 });
  },
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await checkOutage(env);
  },
};
