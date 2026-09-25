/** Everything tunable, read once at startup. See .env.example (PORTAL_*). */

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`${key} must be an integer, got "${raw}"`);
  return n;
}

const baseUrl = env('PORTAL_BASE_URL', 'http://127.0.0.1:8090').replace(/\/+$/, '');

export const config = {
  /** Where players reach the portal, e.g. https://play.example.com. Steam sends them back here. */
  baseUrl,
  /** Cookies get the Secure flag whenever the portal is served over HTTPS. */
  secureCookies: baseUrl.startsWith('https://'),

  http: {
    host: env('PORTAL_HOST', '127.0.0.1'),
    port: envInt('PORTAL_PORT', 8090),
  },

  /** The bridge, on the same machine. Only its /player-api routes are used. */
  bridgeUrl: env('BRIDGE_URL', 'http://127.0.0.1:8080').replace(/\/+$/, ''),
  /** x-portal-token for /player-api — the same value as PORTAL_TOKEN in the bridge's env. */
  portalToken: env('PORTAL_TOKEN', ''),

  /** The proximity voice server players' browsers connect to (wss://…); empty = no voice. Same value as the bridge's VOICE_URL. */
  voiceUrl: env('VOICE_URL', ''),

  /** Xóm Gáy Launcher installers and its update feed, served at /tai/ (scripts/release-launcher.sh fills it). */
  downloadsDir: env('PORTAL_DOWNLOADS_DIR', '/opt/isle-portal/downloads'),

  /** Signs the login cookie. At least 32 characters; changing it logs everyone out. */
  sessionSecret: env('PORTAL_SESSION_SECRET', ''),
  sessionDays: envInt('PORTAL_SESSION_DAYS', 7),

  /**
   * Behind Caddy the client address is in X-Forwarded-For; trust it only when
   * the portal really sits behind a proxy (it listens on 127.0.0.1 by default).
   */
  trustProxy: env('PORTAL_TRUST_PROXY', '1') === '1',
} as const;

/** Refuse to start half-configured: a missing secret must not mean "no auth". */
export function assertConfig(): void {
  if (config.sessionSecret.length < 32) {
    throw new Error('PORTAL_SESSION_SECRET must be at least 32 characters (openssl rand -hex 32)');
  }
  if (config.portalToken.length < 16) {
    throw new Error('PORTAL_TOKEN must be set (at least 16 characters) and match the bridge');
  }
}
