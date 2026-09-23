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
  '/home/isle/server/TheIsle/Binaries/Win64/ue4ss/Mods/DinoGarage/Saved',
);

const eventsPath = env(
  'EVENTS_PATH',
  '/home/isle/server/TheIsle/Binaries/Win64/ue4ss/Mods/StatsLogger/Saved/events.ndjson',
);

export const config = {
  /** Where StatsLogger writes. Must match E.STREAMS in mods/_shared/events.lua. */
  eventsPath,

  /** The vitals + position stream. Lives next to events.ndjson by default. */
  snapshotsPath: env('SNAPSHOTS_PATH', join(dirname(eventsPath), 'snapshots.ndjson')),

  /** DinoGarage's Saved/ directory on the server. */
  garageRoot,

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

  /** How often we check the file for new bytes. */
  pollMs: envInt('POLL_MS', 1000),

  /** How many recent events the feed keeps in memory. */
  feedSize: envInt('FEED_SIZE', 500),

  /** How many kills and chat lines are kept for their own views. */
  killfeedSize: envInt('KILLFEED_SIZE', 500),
  chatSize: envInt('CHAT_SIZE', 1000),

  /** Per-player history kept for the player detail view. */
  timelineSize: envInt('TIMELINE_SIZE', 300),

  /** Position trail length per player on the live map (one point per snapshot). */
  trailSize: envInt('TRAIL_SIZE', 24),

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
     * three via sudoers (install.sh). "none" runs systemctl directly (demo).
     */
    sudo: env('SUDO', 'sudo'),
    /** Where the live Game.ini is — the panel's config edits land here. */
    configDir: env(
      'GAME_CONFIG_DIR',
      '/home/isle/server/TheIsle/Saved/Config/WindowsServer',
    ),
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

  http: {
    host: env('HTTP_HOST', '127.0.0.1'),
    port: envInt('HTTP_PORT', 8080),
  },
} as const;
