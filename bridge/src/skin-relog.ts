import type { GameEvent, Skin } from './events.js';
import { SKIN_CHANNEL_MAX, SKIN_REGIONS, type SkinRequest } from './commands.js';

/**
 * The colours a dino had, painted again when the player comes back on it.
 *
 * The game saves a dino with the colours the player picked in the game, not
 * the ones painted on it while playing (the web skin editor, the garage's
 * restore): after every relog — and every server restart — it came back in
 * its own colours (8 players, 2026-09-27/28). The kept colours ("giữ màu cho
 * lần chơi sau") are painted by the mod itself (DinoGarage keepskin.lua), so a
 * species with kept colours is left to it.
 *
 * From StatsLogger's events: the last "skin" of each player's dino; a "spawn"
 * of the same species with its growth going on (not lower) and no death or
 * garage store since is that dino again; the "skin" read at that spawn tells
 * whether the colours were lost. Replayed events (older than the start) only
 * set the state.
 */

/** Growth may read a little lower after a relog (rounding): still the same dino. */
const GROWTH_SLACK = 0.02;
/** The spawn's own skin comes right after it; later ones are the player's doing. */
const SKIN_AFTER_SPAWN_S = 30;

interface Seen { species: string; skin: Skin; t: number }

export class SkinRelog {
  readonly #last = new Map<string, Seen>();
  readonly #growth = new Map<string, number>();
  /** steamId -> the colours to find again on the dino that just came back. */
  readonly #awaiting = new Map<string, Seen & { spawnedAt: number }>();

  constructor(
    readonly startedAt: number,
    /** Paint these colours on the player's dino now. */
    readonly repaint: (steamId: string, skin: SkinRequest) => Promise<unknown>,
    /** Colours the player keeps for that species (the mod paints those). */
    readonly isKept: (steamId: string, species: string) => Promise<boolean>,
    readonly log: (line: string) => void = (l) => console.info(l),
  ) {}

  async handle(event: GameEvent): Promise<void> {
    const e = event as GameEvent & { steamId?: string; species?: string; growth?: number | null; skin?: Skin; ok?: boolean };
    const id = e.steamId;
    if (typeof id !== 'string') return;
    switch (e.type) {
      case 'snapshot':
        if (typeof e.growth === 'number') this.#growth.set(id, e.growth);
        return;
      case 'death':
      case 'garage_store':
        // That dino is gone: nothing to paint on the next one.
        this.#last.delete(id);
        this.#awaiting.delete(id);
        return;
      case 'spawn': {
        const last = this.#last.get(id);
        const before = this.#growth.get(id);
        if (typeof e.growth === 'number') this.#growth.set(id, e.growth);
        this.#awaiting.delete(id);
        if (!last || last.species !== e.species || typeof e.growth !== 'number') return;
        if (before !== undefined && e.growth < before - GROWTH_SLACK) return;
        this.#awaiting.set(id, { ...last, spawnedAt: e.t });
        return;
      }
      case 'skin': {
        if (!e.skin || typeof e.species !== 'string') return;
        const waiting = this.#awaiting.get(id);
        this.#last.set(id, { species: e.species, skin: e.skin, t: e.t });
        if (!waiting) return;
        this.#awaiting.delete(id);
        if (e.t - waiting.spawnedAt > SKIN_AFTER_SPAWN_S || waiting.species !== e.species) return;
        if (skinKey(e.skin) === skinKey(waiting.skin)) return;          // the game kept them
        if (e.t < this.startedAt) return;                                // a replay: nothing to send
        if (await this.isKept(id, e.species)) return;                    // keepskin.lua paints those
        const req = toRequest(waiting.skin);
        if (req === null) return;
        try {
          await this.repaint(id, req);
          // The dino shows these again: they are its last colours.
          this.#last.set(id, { species: e.species, skin: waiting.skin, t: e.t });
          this.log(`[skin-relog] ${id} came back on its ${e.species}: its colours painted again`);
        } catch (err) {
          this.log(`[skin-relog] ${id}: could not repaint — ${(err as Error).message}`);
        }
        return;
      }
      default:
    }
  }
}

/** Colours to compare (to 3 decimals: a relog reads back what was written). */
export function skinKey(skin: Skin): string {
  const c = (skin.colors ?? {}) as Record<string, { r: number; g: number; b: number }>;
  const regions = Object.keys(c).sort().map((k) => {
    const v = c[k] as { r: number; g: number; b: number };
    return `${k}:${[v.r, v.g, v.b].map((x) => (typeof x === 'number' ? x.toFixed(3) : '?')).join(',')}`;
  });
  return `${regions.join('|')}|p${String(skin.patternIndex ?? '')}|t${String(skin.themeIndex ?? '')}`;
}

/** A skin as the game held it -> the web editor's request (commands.ts validateSkin). */
export function toRequest(skin: Skin): SkinRequest | null {
  const colors: SkinRequest['colors'] = {};
  const c = (skin.colors ?? {}) as Record<string, unknown>;
  const ch = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(SKIN_CHANNEL_MAX, Math.max(0, v)) : null);
  for (const region of SKIN_REGIONS) {
    const v = c[region] as { r?: unknown; g?: unknown; b?: unknown } | undefined;
    if (!v) continue;
    const r = ch(v.r); const g = ch(v.g); const b = ch(v.b);
    if (r === null || g === null || b === null) continue;
    colors[region] = { r, g, b };
  }
  if (Object.keys(colors).length === 0) return null;
  const out: SkinRequest = { colors };
  if (Number.isInteger(skin.patternIndex) && (skin.patternIndex as number) >= 0 && (skin.patternIndex as number) <= 20) out.pattern = skin.patternIndex as number;
  if (Number.isInteger(skin.themeIndex) && (skin.themeIndex as number) >= 0 && (skin.themeIndex as number) <= 20) out.theme = skin.themeIndex as number;
  if (typeof skin.variation === 'number' && skin.variation >= 0 && skin.variation <= 100) out.variation = skin.variation;
  return out;
}
