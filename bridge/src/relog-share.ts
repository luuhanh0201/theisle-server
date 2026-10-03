import type { GameEvent } from './events.js';

/**
 * A dino whose max health jumps at a relog (2026-10-02): a prime the mod set
 * (Phiếu Prime, the garage's late prime) gets its prime stats from the game
 * only when it is loaded again — max health 9350 → 12274 on a Rex — while the
 * health and blood stay the number they were: 100 % before, 76 % after, the
 * screen darkened by the missing blood. Watched here from the events: the last
 * snapshot before a session ends, then the first snapshot of the next session
 * on the same species. When the max grew by more than JUMP, the health and
 * blood are put back to the SAME SHARE they had when the player left (never
 * more: a relog heals nothing). index.ts queues it as an admin "vitals" action.
 */

const JUMP = 1.1;

interface Left { t: number; species: string; health: number; maxHealth: number; blood: number | null; maxBlood: number | null }

export class RelogShare {
  #last = new Map<string, Left>();
  /**
   * A session that ended: when, and the last snapshot before it. The two files are read
   * apart when the bridge starts, so the session's end may come before its snapshots
   * (T-Rex Nổi Loạn, 2026-10-04: left on 02/10, the bridge restarted several times, the
   * end was read first and the relog went unseen — 76 % blood, dark screen). The
   * snapshots up to the end still fill it in when they come after.
   */
  #left = new Map<string, { end: number; snap: Left | null }>();

  /** Events older than this (read again when the bridge starts) are only remembered, never acted on. */
  constructor(readonly startedAt: number) {}

  /** Feed every event; returns the shares to set for a player whose max health jumped at a relog, or null. */
  onEvent(e: GameEvent): { steamId: string; health: number; blood: number; maxBefore: number; maxNow: number } | null {
    if (e.type === 'snapshot') {
      const max = e.max ?? {};
      if (typeof e.health !== 'number' || typeof max.health !== 'number' || max.health <= 0) return null;
      const now: Left = { t: e.t, species: e.species, health: e.health, maxHealth: max.health,
        blood: typeof e.blood === 'number' ? e.blood : null, maxBlood: typeof max.blood === 'number' ? max.blood : null };
      const ended = this.#left.get(e.steamId);
      // A snapshot from before the end (read late): it may be the last one before they left.
      if (ended !== undefined && e.t <= ended.end) {
        if (ended.snap === null || e.t >= ended.snap.t) ended.snap = now;
        return null;
      }
      this.#last.set(e.steamId, now);
      if (ended === undefined) return null;
      this.#left.delete(e.steamId);
      const left = ended.snap;
      if (left === null || e.t < this.startedAt) return null;
      if (left.species !== now.species || now.maxHealth < left.maxHealth * JUMP) return null;
      // Only when the health is still the number it was (the game kept it), not after a fight.
      if (Math.abs(now.health - left.health) > left.maxHealth * 0.05) return null;
      const share = (v: number | null, m: number | null): number => (v !== null && m !== null && m > 0 ? Math.min(1, Math.max(0, v / m)) : 1);
      return { steamId: e.steamId, health: Math.round(share(left.health, left.maxHealth) * 1000) / 1000,
        blood: Math.round(share(left.blood, left.maxBlood) * 1000) / 1000, maxBefore: left.maxHealth, maxNow: now.maxHealth };
    }
    if (e.type === 'session_end') {
      const last = this.#last.get(e.steamId);
      this.#left.set(e.steamId, { end: e.t, snap: last !== undefined && last.t <= e.t ? last : null });
      return null;
    }
    if (e.type === 'death') this.#left.delete(e.steamId);
    return null;
  }
}
