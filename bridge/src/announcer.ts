import { audit } from './audit.js';
import { currentMessages, leftVars, renderMessage, type MessagesSettings } from './messages.js';

/**
 * The timed announcements set on the panel (tab Thông báo, messages.ts):
 *
 *   periodic    each enabled text every `everyMin` minutes
 *   corpseWipe  every `everyMin` minutes: warn `warnSec` before, then RCON
 *               WipeCorpses and say it is done
 *
 * Only while someone is playing: nobody hears an announcement to an empty
 * server, and corpses do not pile up without players. The clocks start when
 * the bridge starts (or the setting changes) and are not persisted: a bridge
 * restart only delays the next one.
 */

interface RconLike {
  readonly enabled: boolean;
  run(name: string, args?: unknown): Promise<string>;
}

export interface AnnouncerDeps {
  rcon: RconLike;
  online: () => number;
  settings?: () => MessagesSettings;
  now?: () => number;
  log?: (msg: string) => void;
}

export class Announcer {
  readonly #d: Required<AnnouncerDeps>;
  /** Periodic id -> ms of its next send (with its interval, to see a change). */
  readonly #periodic = new Map<string, { at: number; everyMin: number }>();
  #wipe: { at: number; everyMin: number; warned: boolean } | null = null;

  constructor(deps: AnnouncerDeps) {
    this.#d = { settings: currentMessages, now: () => Date.now(), log: (m) => console.warn(m), ...deps };
  }

  async #announce(text: string | null): Promise<void> {
    if (text === null) return;
    try {
      await this.#d.rcon.run('announce', text);
    } catch (error) {
      this.#d.log(`[announcer] announce failed: ${(error as Error).message}`);
    }
  }

  /** Call every few seconds. */
  async tick(): Promise<void> {
    const s = this.#d.settings();
    const now = this.#d.now();
    const playing = this.#d.online() > 0 && this.#d.rcon.enabled;

    // --- periodic ---
    const seen = new Set<string>();
    for (const p of s.periodic) {
      if (!p.enabled) continue;
      seen.add(p.id);
      const every = p.everyMin * 60_000;
      const st = this.#periodic.get(p.id);
      if (!st || st.everyMin !== p.everyMin) {
        this.#periodic.set(p.id, { at: now + every, everyMin: p.everyMin });
        continue;
      }
      if (now < st.at) continue;
      st.at = now + every;
      if (playing) await this.#announce(p.text);
    }
    for (const id of this.#periodic.keys()) if (!seen.has(id)) this.#periodic.delete(id);

    // --- corpse wipe ---
    const cw = s.corpseWipe;
    if (cw.everyMin <= 0) { this.#wipe = null; return; }
    if (!this.#wipe || this.#wipe.everyMin !== cw.everyMin) {
      this.#wipe = { at: now + cw.everyMin * 60_000, everyMin: cw.everyMin, warned: false };
      return;
    }
    const w = this.#wipe;
    if (!w.warned && cw.warnSec > 0 && now >= w.at - cw.warnSec * 1000 && now < w.at) {
      w.warned = true;
      if (playing) await this.#announce(renderMessage('corpses.warning', leftVars(Math.round((w.at - now) / 1000)), s));
    }
    if (now < w.at) return;
    this.#wipe = { at: now + cw.everyMin * 60_000, everyMin: cw.everyMin, warned: false };
    if (!playing) return;
    try {
      await this.#d.rcon.run('wipeCorpses');
      await audit({ action: 'corpses wiped (schedule)', detail: `mỗi ${cw.everyMin} phút`, ok: true });
      await this.#announce(renderMessage('corpses.done', {}, s));
    } catch (error) {
      await audit({ action: 'corpses wiped (schedule)', ok: false, error: (error as Error).message });
    }
  }
}
