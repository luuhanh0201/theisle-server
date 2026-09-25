import { mkdir } from 'node:fs/promises';
import { config } from './config.js';
import { NdjsonTail } from './tail.js';
import { Store } from './store.js';
import { startServer } from './server.js';
import { Rcon } from './rcon.js';
import { Power, scheduleTick } from './power.js';
import { systemdService } from './service.js';
import { Notifier } from './notify.js';
import { Metrics } from './metrics.js';
import { readLiveState } from './live.js';
import { VoiceRoom } from './voice.js';
import { groundPointsPath, refreshModFile } from './ai-zones.js';
import { pruneAudit } from './audit.js';

const store = new Store();
const rcon = new Rcon(config.rcon);
const power = new Power({
  service: systemdService(),
  rcon,
  modsLoadedAt: () => store.modsLoadedAt(),
});
// The admin log keeps 7 days: drop what is older now (then hourly, on write).
await pruneAudit().catch((error: unknown) => console.error('[audit] prune failed:', error));

// The AIZones mod writes its status next to zones.json; Lua cannot create
// the directory, so it has to exist before the first zones are saved.
await mkdir(config.aiZonesRoot, { recursive: true }).catch((error: unknown) => console.error('[ai-zones] cannot create', config.aiZonesRoot, error));

// Ground points gathered before (AI positions are only ever seen live).
await store.groundPoints.load(groundPointsPath());

// Events first: on a replay at startup, sessions and deaths should be known
// before the snapshots that fill in the current state.
const notifier = new Notifier(rcon, Math.floor(Date.now() / 1000));
const tails = [config.eventsPath, config.snapshotsPath].map(
  (path) => new NdjsonTail(path, (event) => {
    store.apply(event);
    void notifier.handle(event);
  }),
);

// Performance history (panel → Server → Hiệu năng): ServerFPS and players
// from the live file, CPU / RAM from /proc, every 10 s.
const metrics = new Metrics(config.dataDir, async () => {
  const live = await readLiveState();
  const fresh = live !== null && !live.stale;
  // Where the AI stands now is ground the AI zones may spawn on.
  if (fresh && live.ai && !live.ai.stale) for (const a of live.ai.list) store.groundPoints.add(a.x, a.y, a.z, a.c);
  return {
    online: store.online().length,
    fps: fresh ? live.fps : null,
    ai: fresh && live.ai && !live.ai.stale ? live.ai.count : null,
  };
});
metrics.start();

// Proximity voice: who is in the LiveKit room (voice.ts). Off without LIVEKIT_* keys.
const voice = config.voice === null ? null : new VoiceRoom(config.voice);

startServer({ store, power, rcon, metrics, ...(voice ? { voice } : {}) });

// AI zones: keep the ground points on disk and hand the mod the points found
// since (a zone drawn where nobody had been yet gets spots as people go there).
setInterval(() => {
  store.groundPoints.save(groundPointsPath())
    .then(() => refreshModFile(store.groundPoints))
    .catch((error: unknown) => console.error('[ai-zones] refresh failed:', error));
}, 10 * 60_000);

// Daily restart schedule: check often enough that the countdown starts on time.
setInterval(() => {
  scheduleTick(power).catch((error: unknown) => console.error('[power] schedule tick failed:', error));
}, 15_000);

console.info(
  `[bridge] tailing ${config.eventsPath} and ${config.snapshotsPath} every ${config.pollMs}ms`,
);

let stopping = false;

async function loop(): Promise<void> {
  while (!stopping) {
    for (const tail of tails) {
      try {
        await tail.poll();
      } catch (error) {
        // A read failure must never end the loop — the game may be mid-rotation.
        console.error('[bridge] poll failed:', error);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollMs));
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.info(`[bridge] ${signal} — shutting down`);
    stopping = true;
    process.exit(0);
  });
}

void loop();
