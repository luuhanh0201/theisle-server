import { readFile } from 'node:fs/promises';
import { config } from './config.js';

/**
 * A player's prime progress for one species as the game showed it, the
 * StatsLogger "prime" event of that (player, species) with the MOST tasks
 * done (the latest of those). An admin who gives a player a dino (garage.ts
 * createSlot) starts from it, so a dino given back keeps its tasks: an admin
 * slot used to carry none. Not simply the last event: that is most often the
 * fresh dino the player spawned after losing theirs (tasks 7 and 8 only), and
 * prime ticked on top of it came out plain (2026-09-27).
 */
export interface LastPrime {
  t: number;
  growth: number | null;
  /** "1".."10" → done. */
  conditions: Record<string, boolean>;
  eligible: boolean | null;
  prime: boolean | null;
  /** Ten 0/1, condition 1 first (garage.ts primeConditions). */
  code: string;
}

/** "…/BP_Tyrannosaurus.BP_Tyrannosaurus_C" or "BP_Tyrannosaurus_C" → "BP_Tyrannosaurus_C". */
export function speciesClass(raw: string): string {
  return (raw.split('.').pop() ?? raw).trim();
}

export async function lastPrimeOf(steamId: string, species: string): Promise<LastPrime | null> {
  const cls = speciesClass(species);
  let text: string;
  try { text = await readFile(config.eventsPath, 'utf8'); } catch { return null; }
  let last: LastPrime | null = null;
  for (const line of text.split('\n')) {
    if (!line.includes('"prime"') || !line.includes(steamId)) continue;
    let e: Record<string, unknown>;
    try { e = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (e['type'] !== 'prime' || e['steamId'] !== steamId || e['species'] !== cls) continue;
    const c = e['conditions'];
    if (typeof c !== 'object' || c === null) continue;
    const conditions: Record<string, boolean> = {};
    for (let i = 1; i <= 10; i++) conditions[String(i)] = (c as Record<string, unknown>)[String(i)] === true;
    const code = Array.from({ length: 10 }, (_, i) => (conditions[String(i + 1)] ? '1' : '0')).join('');
    const done = [...code].filter((c) => c === '1').length;
    if (last !== null && done < [...last.code].filter((c) => c === '1').length) continue;
    last = {
      t: typeof e['t'] === 'number' ? e['t'] : 0,
      growth: typeof e['growth'] === 'number' ? e['growth'] : null,
      conditions,
      eligible: typeof e['eligible'] === 'boolean' ? e['eligible'] : null,
      prime: typeof e['prime'] === 'boolean' ? e['prime'] : null,
      code,
    };
  }
  return last;
}
