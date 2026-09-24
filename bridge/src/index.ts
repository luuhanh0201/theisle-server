import { config } from './config.js';
import { NdjsonTail } from './tail.js';
import { Store } from './store.js';
import { startServer } from './server.js';
import { Rcon } from './rcon.js';
import { Power, scheduleTick } from './power.js';
import { systemdService } from './service.js';
import { Notifier } from './notify.js';

const store = new Store();
const rcon = new Rcon(config.rcon);
const power = new Power({
  service: systemdService(),
  rcon,
  modsLoadedAt: () => store.modsLoadedAt(),
});
// Events first: on a replay at startup, sessions and deaths should be known
// before the snapshots that fill in the current state.
const notifier = new Notifier(rcon, Math.floor(Date.now() / 1000));
const tails = [config.eventsPath, config.snapshotsPath].map(
  (path) => new NdjsonTail(path, (event) => {
    store.apply(event);
    void notifier.handle(event);
  }),
);

startServer({ store, power, rcon });

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
