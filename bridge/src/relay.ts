import type { DiscordSettings } from './discord.js';
import { ValidationError } from './garage.js';

/**
 * The bridge's side of the relay (relay/, a Cloudflare Worker off the VPS):
 * every 2 minutes a heartbeat — the server's state now, and the Discord
 * webhook to post "unreachable" / "back" on — so that when the VPS goes quiet
 * (down, cut off, DDoS) the relay notices and says so, and /status, /online
 * in Discord still answer. Outgoing HTTPS only.
 *
 * The slash commands are registered with the Discord application's bot token,
 * sent once from the panel and not kept.
 */

export interface Heartbeat {
  serverName: string;
  phase: string;
  online: number;
  maxPlayers: number | null;
  players: string[];
  fps: number | null;
  ai: number | null;
  alertWebhook: string | null;
}

export interface RelayState { lastOkAt: number | null; lastError: string | null }

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ status: number; text(): Promise<string> }>;

/** The webhook the relay posts outages on: the one the "server" log goes to, else the first. */
export function alertWebhookOf(s: DiscordSettings): string | null {
  const id = s.routes.server ?? s.channels[0]?.id;
  return s.channels.find((c) => c.id === id)?.url ?? null;
}

export async function sendHeartbeat(relay: { url: string; secret: string }, hb: Heartbeat, state: RelayState,
  fetchFn: FetchLike = (u, i) => fetch(u, i), now = () => Math.floor(Date.now() / 1000)): Promise<void> {
  try {
    const res = await fetchFn(`${relay.url}/heartbeat`, {
      method: 'POST', headers: { authorization: `Bearer ${relay.secret}`, 'content-type': 'application/json' },
      body: JSON.stringify(hb), signal: AbortSignal.timeout(10_000),
    });
    if (res.status >= 200 && res.status < 300) { state.lastOkAt = now(); state.lastError = null; return; }
    state.lastError = res.status === 401 ? 'trạm từ chối mã bí mật (khác với mã đã đặt trên Cloudflare?)' : `trạm trả ${res.status}`;
  } catch (error) {
    state.lastError = `không gửi được: ${(error as Error).message}`;
  }
}

export const COMMANDS = [
  { name: 'status', description: 'Tình trạng server: đang chạy, số người, FPS — kể cả khi VPS mất kết nối', type: 1 },
  { name: 'online', description: 'Ai đang online trên server', type: 1 },
];

/** Put the slash commands on the Discord application (global). The token is used once, never kept. */
export async function registerCommands(appId: unknown, botToken: unknown, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<string[]> {
  if (typeof appId !== 'string' || !/^\d{15,22}$/.test(appId)) throw new ValidationError('Application ID là một dãy số (Developer Portal → General Information)');
  if (typeof botToken !== 'string' || !/^[\w.-]{50,120}$/.test(botToken.trim())) throw new ValidationError('Bot token không đúng dạng (Developer Portal → Bot → Reset Token)');
  const res = await fetchFn(`https://discord.com/api/v10/applications/${appId}/commands`, {
    method: 'PUT', headers: { authorization: `Bot ${botToken.trim()}`, 'content-type': 'application/json' },
    body: JSON.stringify(COMMANDS), signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text().catch(() => '');
  if (res.status < 200 || res.status >= 300) {
    throw new ValidationError(res.status === 401 ? 'Discord từ chối bot token' : `Discord trả ${res.status}: ${text.slice(0, 200)}`);
  }
  return COMMANDS.map((c) => `/${c.name}`);
}
