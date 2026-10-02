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
  #left = new Map<string, Left>();

  /** Events older than this (read again when the bridge starts) are only remembered, never acted on. */
  constructor(readonly startedAt: number) {}

  /** Feed every event; returns the shares to set for a player whose max health jumped at a relog, or null. */
  onEvent(e: GameEvent): { steamId: string; health: number; blood: number; maxBefore: number; maxNow: number } | null {
    if (e.type === 'snapshot') {
      const max = e.max ?? {};
      if (typeof e.health !== 'number' || typeof max.health !== 'number' || max.health <= 0) return null;
      const now: Left = { t: e.t, species: e.species, health: e.health, maxHealth: max.health,
        blood: typeof e.blood === 'number' ? e.blood : null, maxBlood: typeof max.blood === 'number' ? max.blood : null };
      const left = this.#left.get(e.steamId);
      this.#last.set(e.steamId, now);
      // The snapshots and the sessions are two files read apart: one from before the relog may come late.
      if (left === undefined || e.t <= left.t) return null;
      this.#left.delete(e.steamId);
      if (e.t < this.startedAt) return null;
      if (left.species !== now.species || now.maxHealth < left.maxHealth * JUMP) return null;
      // Only when the health is still the number it was (the game kept it), not after a fight.
      if (Math.abs(now.health - left.health) > left.maxHealth * 0.05) return null;
      const share = (v: number | null, m: number | null): number => (v !== null && m !== null && m > 0 ? Math.min(1, Math.max(0, v / m)) : 1);
      return { steamId: e.steamId, health: Math.round(share(left.health, left.maxHealth) * 1000) / 1000,
        blood: Math.round(share(left.blood, left.maxBlood) * 1000) / 1000, maxBefore: left.maxHealth, maxNow: now.maxHealth };
    }
    if (e.type === 'session_end') {
      const last = this.#last.get(e.steamId);
      if (last !== undefined) this.#left.set(e.steamId, { ...last, t: Math.max(last.t, e.t) });
      return null;
    }
    if (e.type === 'death') this.#left.delete(e.steamId);
    return null;
  }
}
