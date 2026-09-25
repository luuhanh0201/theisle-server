import { dirname, join } from 'node:path';

/** Everything tunable, read once at startup. */

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

const garageRoot = env(
  'GARAGE_ROOT',
  '/home/isle/server/TheIsle/Binaries/Win64/Mods/DinoGarage/Saved',
);

const eventsPath = env(
  'EVENTS_PATH',
  '/home/isle/server/TheIsle/Binaries/Win64/Mods/StatsLogger/Saved/events.ndjson',
);

export const config = {
  /** Where StatsLogger writes. Must match E.STREAMS in mods/_shared/events.lua. */
  eventsPath,

  /** The vitals + position stream. Lives next to events.ndjson by default. */
  snapshotsPath: env('SNAPSHOTS_PATH', join(dirname(eventsPath), 'snapshots.ndjson')),

  /** The live state StatsLogger replaces every second: players' position/vitals + AI (live.ts). */
  livePath: env('LIVE_PATH', join(dirname(eventsPath), 'live.json')),

  /** DinoGarage's Saved/ directory on the server. */
  garageRoot,

  /** PlayerCommands' Saved/ directory: the panel writes its settings.json there. */
  commandsRoot: env('PLAYER_COMMANDS_ROOT', join(garageRoot, '..', '..', 'PlayerCommands', 'Saved')),

  /** AIZones' Saved/ directory: the bridge writes zones.json there, the mod writes status.json. */
  aiZonesRoot: env('AI_ZONES_ROOT', join(garageRoot, '..', '..', 'AIZones', 'Saved')),

  /** PteraCarry's Saved/ directory: the panel writes its settings.json there. */
  pteraRoot: env('PTERA_ROOT', join(garageRoot, '..', '..', 'PteraCarry', 'Saved')),

  /** The players' texts as edited on the panel, read by every mod (mods/_shared/messages.lua). */
  messagesModPath: env('MESSAGES_MOD_PATH', join(garageRoot, '..', '..', 'shared', 'isle-messages.json')),

  /**
   * Admin-written mutation descriptions (bridge-owned). Next to the garage by
   * default because that directory is never deployed over.
   */
  mutationNotesPath: env('MUTATION_NOTES_PATH', join(garageRoot, 'mutation-notes.json')),

  /**
   * Shared secret for the write endpoints, sent as x-admin-token.
   * Unset means writes are REFUSED, not open: this service has no other auth
   * and it edits player data.
   */
  adminToken: process.env['ADMIN_TOKEN'] ?? null,

  /**
   * Shared secret of the player portal (portal/), sent as x-portal-token to
   * the read-only /player-api routes. Unset = those routes do not exist.
   * Deliberately NOT the admin token: the portal faces the internet.
   */
  portalToken: process.env['PORTAL_TOKEN'] || null,

  /** How often we check the file for new bytes. */
  pollMs: envInt('POLL_MS', 1000),

  /** How many recent events the feed keeps in memory. */
  feedSize: envInt('FEED_SIZE', 500),

  /** How many kills and chat lines are kept for their own views. */
  killfeedSize: envInt('KILLFEED_SIZE', 500),
  chatSize: envInt('CHAT_SIZE', 1000),

  /** Per-player history kept for the player detail view. */
  timelineSize: envInt('TIMELINE_SIZE', 300),

  /**
   * Position trail per player on the live map: a point per snapshot (5 s) in
   * which the dino moved at least TRAIL_MIN_MOVE cm, so 180 = about 15 minutes
   * of actual movement.
   */
  trailSize: envInt('TRAIL_SIZE', 180),
  trailMinMove: envInt('TRAIL_MIN_MOVE', 200),

  /** Whole-life paths ("xem đường đi" on the player page): lives kept per player, points per life. */
  pathLives: envInt('PATH_LIVES', 5),
  pathMaxPoints: envInt('PATH_MAX_POINTS', 4000),

  /** A player with no snapshot for this long is considered offline. */
  offlineAfterSeconds: envInt('OFFLINE_AFTER_SECONDS', 30),

  /**
   * Bridge-owned state that must survive deploys: panel-managed game settings,
   * the restart schedule, the admin audit log. deploy.sh never touches it.
   */
  dataDir: env('DATA_DIR', join(process.cwd(), 'data')),

  /** The game server as systemd sees it. */
  game: {
    unit: env('GAME_UNIT', 'theisle.service'),
    systemctl: env('SYSTEMCTL', 'systemctl'),
    /**
     * Prefix for start/stop/restart. The bridge user may run exactly those
     * three via sudoers (install.sh). "none" runs systemctl directly, for a
     * bridge that runs as a user with its own right to manage the unit.
     */
    sudo: env('SUDO', 'sudo'),
    /** Where the live Game.ini is — the panel's config edits land here. */
    configDir: env(
      'GAME_CONFIG_DIR',
      '/home/isle/server/TheIsle/Saved/Config/WindowsServer',
    ),
    /** The game's own log (Saved/Logs next to Saved/Config) — read for the readiness checklist. */
    logPath: env(
      'GAME_LOG_PATH',
      join(env('GAME_CONFIG_DIR', '/home/isle/server/TheIsle/Saved/Config/WindowsServer'), '..', '..', 'Logs', 'TheIsle.log'),
    ),
    /** UDP game port (start.sh GAME_PORT). */
    port: envInt('GAME_PORT', 7777),
  },

  /**
   * RCON, spoken only by the bridge. The password comes from the VPS .env and
   * is never sent to a browser. Empty password = RCON features disabled.
   */
  rcon: {
    host: env('RCON_HOST', '127.0.0.1'),
    port: envInt('RCON_PORT', 8888),
    password: process.env['RCON_PASSWORD'] ?? '',
  },

  /**
   * Proximity voice (voice.ts): the LiveKit server on this machine. Unset
   * key or secret = no voice routes. VOICE_URL is what players' browsers
   * connect to (wss://…); LIVEKIT_URL is how the bridge reaches its API.
   */
  voice: process.env['LIVEKIT_API_KEY'] && process.env['LIVEKIT_API_SECRET'] ? {
    apiUrl: env('LIVEKIT_URL', 'http://127.0.0.1:7880').replace(/\/+$/, ''),
    publicUrl: env('VOICE_URL', ''),
    apiKey: process.env['LIVEKIT_API_KEY'],
    apiSecret: process.env['LIVEKIT_API_SECRET'],
    room: env('VOICE_ROOM', 'isle'),
  } : null,

  http: {
    host: env('HTTP_HOST', '127.0.0.1'),
    port: envInt('HTTP_PORT', 8080),
  },

  /**
   * Who may open the admin panel (panel-auth.ts): a Steam login whose SteamID
   * is a game admin, from an allowed IP when it comes through the web.
   */
  panel: {
    /** https://admin.example.com when nginx publishes the panel; unset = SSH tunnel only. */
    baseUrl: (process.env['PANEL_BASE_URL'] || '').replace(/\/+$/, '') || null,
    /** Always admins of the panel, whatever the game's admin list says (the owner can never be locked out). */
    ownerIds: (process.env['ADMIN_STEAM_IDS'] ?? '').split(/[\s,]+/).filter((s) => /^\d{17}$/.test(s)),
    /** First allowed IPs, until the panel saves its own list (DATA_DIR/panel-access.json). */
    seedIps: (process.env['PANEL_ALLOWED_IPS'] ?? '').split(/[\s,]+/).filter((s) => s !== ''),
    /** How long a login lasts. */
    sessionHours: envInt('PANEL_SESSION_HOURS', 12),
  },
} as const;
