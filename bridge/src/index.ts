import { config } from './config.js';
import { NdjsonTail } from './tail.js';
import { Store } from './store.js';
import { startServer } from './server.js';

const store = new Store();
// Events first: on a replay at startup, sessions and deaths should be known
// before the snapshots that fill in the current state.
const tails = [config.eventsPath, config.snapshotsPath].map(
  (path) => new NdjsonTail(path, (event) => store.apply(event)),
);

startServer(store);

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
