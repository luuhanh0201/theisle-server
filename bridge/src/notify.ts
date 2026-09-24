import type { GameEvent } from './events.js';

/**
 * Delivers the mods' "notify" events to players over RCON DirectMessage.
 *
 * The events file is replayed from the top whenever the bridge starts, so only
 * messages written after this process came up (minus a little slack for the
 * tail's poll interval) are sent — a restart must not re-send an hour of
 * "Restored 'default'." to everyone.
 */
export interface DirectMessenger {
  readonly enabled: boolean;
  directMessage(steamId: string, message: string): Promise<string>;
}

export class Notifier {
  readonly #since: number;
  readonly #rcon: DirectMessenger;
  readonly #log: (msg: string) => void;
  #warnedDisabled = false;

  constructor(rcon: DirectMessenger, startedAt: number, log: (msg: string) => void = (m) => console.error(m)) {
    this.#rcon = rcon;
    this.#since = startedAt - 10;
    this.#log = log;
  }

  /** Returns the delivery promise (for tests), or null when nothing is sent. */
  handle(event: GameEvent): Promise<void> | null {
    if (event.type !== 'notify' || event.t < this.#since) return null;
    if (!this.#rcon.enabled) {
      if (!this.#warnedDisabled) {
        this.#warnedDisabled = true;
        this.#log('[notify] RCON is not configured — mod messages to players are not delivered');
      }
      return null;
    }
    return this.#rcon.directMessage(event.steamId, event.message).then(
      () => undefined,
      (error: unknown) => this.#log(`[notify] DirectMessage to ${event.steamId} failed: ${(error as Error).message}`),
    );
  }
}
