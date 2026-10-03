import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { createSlot, ValidationError, ConflictError } from './garage.js';
import { PRIME_NEEDED, PRIME_DEADLINE } from './prime.js';

/**
 * Every dino a player played, as the game showed it (StatsLogger's events):
 * species, the growth it reached, its mutations, its prime tasks and prime,
 * elder stacks, its skin — and a way for an admin to put one back in the
 * player's garage as it was before it died (restoreLife).
 *
 * One life runs from a "spawn" to its "death" (or the dino stored, or removed
 * by an admin). What happened in between on that species updates it:
 * "mutation", "prime", "skin", "growth_set", the growth in "prime" events.
 * Not in the events, so not restored as it was: the vitals and the nutrients
 * — the dino comes out healthy and fed (garage.ts: stomach full, nutrients 50 %).
 */

export interface LifeDetail {
  spawnedAt: number;
  species: string;
  classPath: string | null;
  growth: number | null;
  endedAt: number | null;
  /** 'rebirth': chuyển sinh — the prime at 100 % came back young with one more elder stack (store.ts #rebirth). */
  end: 'death' | 'garage' | 'admin' | 'rebirth' | null;
  mutations: Record<string, string>;
  /** Ten 0/1, condition 1 first, and what it adds up to. Null: never read. */
  prime: { code: string; done: number; eligible: boolean; prime: boolean; elderStacks: number | null } | null;
  skin: Record<string, unknown> | null;
  /** Quest mutations unlocked (drink saltwater…), last seen: spawn / mutation_unlocks. Null: not seen. */
  unlockedMutations: string[] | null;
  female: boolean | null;
  /** Put back already: the garage slot it went into. */
  restoredTo: string | null;
}

/** A rebirth's spawn comes this soon after the "death" that started it (store.ts). */
const REBIRTH_WINDOW = 120;

/** A list of mutation names from an event (Lua writes an empty list as {}), or null. */
function names(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.filter((n): n is string => typeof n === 'string' && /^[A-Za-z0-9 '-]{1,60}$/.test(n));
  if (typeof v === 'object' && v !== null && Object.keys(v).length === 0) return [];
  return null;
}

const restoredPath = (): string => join(config.garageRoot, 'restored-lives.json');
type Restored = Record<string, Record<string, { slot: string; t: number }>>;

async function readRestored(): Promise<Restored> {
  try { return JSON.parse(await readFile(restoredPath(), 'utf8')) as Restored; } catch { return {}; }
}

/** A player's lives, newest first (at most `limit`). */
export async function lifeDetails(steamId: string, limit = 40): Promise<LifeDetail[]> {
  let text: string;
  try { text = await readFile(config.eventsPath, 'utf8'); } catch { return []; }
  const restored = (await readRestored())[steamId] ?? {};
  const lives: LifeDetail[] = [];
  let cur: LifeDetail | null = null;
  for (const line of text.split('\n')) {
    if (!line.includes(steamId)) continue;
    let e: Record<string, unknown>;
    try { e = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (e['steamId'] !== steamId) continue;
    const t = typeof e['t'] === 'number' ? e['t'] : 0;
    const species = typeof e['species'] === 'string' ? e['species'] : null;
    const type = e['type'];
    if (type === 'spawn' && species) {
      const m = e['mutations'];
      cur = {
        spawnedAt: t, species, classPath: typeof e['classPath'] === 'string' ? e['classPath'] : null,
        growth: typeof e['growth'] === 'number' ? e['growth'] : null, endedAt: null, end: null,
        mutations: typeof m === 'object' && m !== null && !Array.isArray(m) ? { ...(m as Record<string, string>) } : {},
        prime: null, skin: null, female: null, restoredTo: restored[String(t)]?.slot ?? null,
        unlockedMutations: names(e['unlockedMutations']),
      };
      lives.push(cur);
      continue;
    }
    // Chuyển sinh: the first prime reading of a new life, one stack above a prime
    // at 100 % that "died" moments before (as the bridge's store tells it).
    if (type === 'prime' && cur && cur.prime === null && lives.length >= 2) {
      const before = lives[lives.length - 2] as LifeDetail;
      const stacks = typeof e['elderStacks'] === 'number' ? e['elderStacks'] : null;
      if (before.end === 'death' && before.prime?.prime === true && (before.growth ?? 0) >= 0.99 && stacks !== null
        && stacks > (before.prime.elderStacks ?? 0) && before.endedAt !== null && cur.spawnedAt - before.endedAt <= REBIRTH_WINDOW) {
        before.end = 'rebirth';
      }
    }
    if (!cur || cur.endedAt !== null || (species !== null && species !== cur.species)) continue;
    if (typeof e['growth'] === 'number' && type !== 'growth') cur.growth = e['growth'];
    if (type === 'growth_set' && typeof e['to'] === 'number') cur.growth = e['to'];
    if (type === 'mutation' && typeof e['slot'] === 'string') {
      if (typeof e['to'] === 'string') cur.mutations[e['slot']] = e['to'];
      else delete cur.mutations[e['slot']];
    }
    if (type === 'mutation_unlocks') cur.unlockedMutations = names(e['unlocked']) ?? cur.unlockedMutations;
    if (type === 'skin' && typeof e['skin'] === 'object' && e['skin'] !== null) {
      cur.skin = e['skin'] as Record<string, unknown>;
      const f = (cur.skin as { female?: unknown }).female;
      if (typeof f === 'boolean') cur.female = f;
    }
    if (type === 'prime' && typeof e['conditions'] === 'object' && e['conditions'] !== null) {
      const c = e['conditions'] as Record<string, unknown>;
      const code = Array.from({ length: 10 }, (_, i) => (c[String(i + 1)] === true ? '1' : '0')).join('');
      const done = [...code].filter((x) => x === '1').length;
      cur.prime = { code, done, eligible: e['eligible'] === true || done >= PRIME_NEEDED, prime: e['prime'] === true,
        elderStacks: typeof e['elderStacks'] === 'number' ? e['elderStacks'] : null };
    }
    if (type === 'death') { cur.endedAt = t; cur.end = 'death'; }
    if (type === 'garage_store' || type === 'garage_store_result') { if (e['ok'] !== false) { cur.endedAt = t; cur.end = 'garage'; } }
    if (type === 'admin_kill' && e['ok'] === true) { cur.endedAt = t; cur.end = 'admin'; }
  }
  return lives.reverse().slice(0, limit);
}

/**
 * Put one life back in the player's garage (slot `slot`), as it was: species,
 * growth, mutations (and the quest ones unlocked), prime tasks and prime, elder stacks, skin. Once per life.
 */
export async function restoreLife(steamId: string, spawnedAt: number, slot: string, overwrite = false): Promise<{ slot: string; life: LifeDetail }> {
  const life = (await lifeDetails(steamId, 1000)).find((l) => l.spawnedAt === spawnedAt);
  if (!life) throw new ValidationError('no such life');
  if (life.restoredTo !== null) throw new ConflictError(`already restored into slot "${life.restoredTo}"`);
  if (life.end === null) throw new ValidationError('this dino is still alive (or its end was not seen)');
  if (life.end === 'garage') throw new ValidationError('this dino went into the garage: it is there already');
  if (life.end === 'rebirth') throw new ValidationError('this dino was reborn (chuyển sinh): it lives on as the next one');
  if (!life.classPath || life.growth === null) throw new ValidationError('not enough known about this dino to restore it');
  const isPrime = life.prime?.prime === true && life.growth >= PRIME_DEADLINE;
  await createSlot(steamId, slot, {
    classPath: life.classPath,
    growth: Math.min(1, Math.max(0, life.growth)),
    mutations: life.mutations,
    ...(life.prime ? { primeConditions: life.prime.code } : {}),
    ...(isPrime ? { isPrime: true } : {}),
    ...(life.prime?.elderStacks != null ? { elderStacks: Math.min(10, Math.max(0, life.prime.elderStacks)) } : {}),
    ...(life.female !== null ? { isFemale: life.female } : {}),
    ...(life.skin ? { skin: life.skin } : {}),
    ...(life.unlockedMutations ? { unlockedMutations: life.unlockedMutations } : {}),
    stomachFull: true,
    overwrite,
  });
  const all = await readRestored();
  all[steamId] = { ...(all[steamId] ?? {}), [String(spawnedAt)]: { slot, t: Math.floor(Date.now() / 1000) } };
  await mkdir(config.garageRoot, { recursive: true });
  const tmp = `${restoredPath()}.tmp`;
  await writeFile(tmp, JSON.stringify(all), 'utf8');
  await rename(tmp, restoredPath());
  return { slot, life: { ...life, restoredTo: slot } };
}
