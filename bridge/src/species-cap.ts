import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';

/**
 * The species limit (owner, 2026-10-10): at most `cap` dinos of a species alive at once ("T-Rex 5 thì cả
 * server chỉ được chọn 5 con"), SVip and admins apart ("ngoại lệ, không tính vào số lượng, tự do chọn").
 * The game's picker is the whole server's (hiding a species would hide it from the SVip too), so it is
 * left as it is; instead:
 *
 *   * a player who counts (not SVip, not admin; VIP counts) and came in as a new dino of a species that
 *     already has `cap` counted dinos alive is told and, `graceS` later, that dino is removed (DinoGarage
 *     garage/speciescap.lua, which also refuses them a garage redeem meanwhile), to pick another one.
 *   * only a new dino: a relog on one they had, a rebirth, a dino out of the garage are never touched,
 *     nor one that did not start at the picker's 25 % (StatsLogger, 887 spawns: every species starts
 *     there). A dino already playing when the admin lowers a limit stays.
 *   * no limit on a species: anyone picks it (the default for every species).
 *
 *   data/species-cap.json         SpeciesCapSettings (panel → Server → Giới hạn loài)
 *   data/species-cap-state.json   { seq }: the last id given to the mod
 *   <DinoGarage>/species-cap.json { over }: who is past the limit (the mod's)
 */

export interface SpeciesRule { cap: number }
export interface SpeciesCapSettings { enabled: boolean; graceS: number; species: Record<string, SpeciesRule> }
export const SPECIES_CAP_DEFAULTS: SpeciesCapSettings = { enabled: false, graceS: 30, species: {} };

/** A spawn is judged this long after it (the rebirth / garage marks come with the next events). */
export const JUDGE_AFTER_S = 8;
/** A dino picked on the game's list starts here (0.25); anything above is not a fresh pick. */
export const FRESH_MAX_GROWTH = 0.26;

const NAME = /^[A-Za-z][A-Za-z0-9_]{1,40}$/;

export function validateSpeciesCap(raw: unknown): SpeciesCapSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const graceS = r['graceS'] ?? SPECIES_CAP_DEFAULTS.graceS;
  if (typeof graceS !== 'number' || !Number.isInteger(graceS) || graceS < 5 || graceS > 300) throw new ValidationError('graceS must be 5–300');
  const sp = r['species'] ?? {};
  if (typeof sp !== 'object' || sp === null || Array.isArray(sp)) throw new ValidationError('species must be an object');
  const species: Record<string, SpeciesRule> = {};
  for (const [name, v] of Object.entries(sp as Record<string, unknown>)) {
    if (!NAME.test(name)) throw new ValidationError(`${name}: not a species name`);
    const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
    const int = (x: unknown, what: string, hi: number): number => {
      if (typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x > hi) throw new ValidationError(`${name}: ${what} must be 0–${hi}`);
      return x;
    };
    // 0 or none: no limit (the panel's 0).
    const cap = int(o['cap'], 'cap', 500);
    if (cap > 0) species[name] = { cap };
  }
  if (Object.keys(species).length > 60) throw new ValidationError('at most 60 species');
  return { enabled: r['enabled'] === true, graceS, species };
}

const settingsPath = (): string => join(config.dataDir, 'species-cap.json');
const statePath = (): string => join(config.dataDir, 'species-cap-state.json');
export const overPath = (): string => join(config.garageRoot, 'species-cap.json');

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, path);
}

export async function readSpeciesCap(): Promise<SpeciesCapSettings> {
  try { return validateSpeciesCap(JSON.parse(await readFile(settingsPath(), 'utf8'))); } catch { return structuredClone(SPECIES_CAP_DEFAULTS); }
}
export async function saveSpeciesCap(raw: unknown): Promise<SpeciesCapSettings> {
  const s = validateSpeciesCap(raw);
  await writeJson(settingsPath(), s);
  return s;
}

export interface OverEntry { id: number; steamId: string; species: string; killAt: number; spawnedAt: number }
export interface AliveDino { steamId: string; species: string; spawnedAt: number; fresh: boolean; growth: number | null }

export interface SpeciesCapDeps {
  aliveDinos: () => AliveDino[];
  /** Who is free of the limit: the SVip and the admins (svip.ts, panel-auth.ts). */
  exempt: () => Promise<ReadonlySet<string>>;
  settings?: () => Promise<SpeciesCapSettings>;
  /** Persist the last id and who is over (the defaults: the files above). */
  saveState?: (st: { seq: number }) => Promise<void>;
  loadState?: () => Promise<{ seq: number }>;
  writeOver?: (over: OverEntry[]) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

/** A species with a limit: the dinos that count alive now, the SVip / admins' apart. */
export interface SpeciesCount { species: string; alive: number; free: number; cap: number }

/** BP_Tyrannosaurus_C (or a class path) → Tyrannosaurus, the name Game.ini and the panel use. */
const short = (raw: string): string => (raw.split('.').pop() ?? raw).replace(/^BP_/, '').replace(/_C$/, '');

export class SpeciesCaps {
  readonly #d: Required<Omit<SpeciesCapDeps, 'aliveDinos' | 'exempt'>> & SpeciesCapDeps;
  #seq = 0;
  #over = new Map<string, OverEntry>();
  #pending: Array<{ steamId: string; t: number }> = [];
  #loaded = false;
  #startedAt: number;
  #overText = '';
  #counts: SpeciesCount[] = [];

  constructor(deps: SpeciesCapDeps) {
    this.#d = {
      settings: readSpeciesCap,
      saveState: (st) => writeJson(statePath(), st),
      loadState: async () => {
        try {
          const raw = JSON.parse(await readFile(statePath(), 'utf8')) as { seq?: unknown };
          return { seq: typeof raw.seq === 'number' ? raw.seq : 0 };
        } catch { return { seq: 0 }; }
      },
      writeOver: (over) => writeJson(overPath(), { over: over.map(({ id, steamId, species, killAt }) => ({ id, steamId, species, killAt })) }),
      now: () => Math.floor(Date.now() / 1000),
      log: (line) => console.info(`[species-cap] ${line}`),
      ...deps,
    };
    this.#startedAt = this.#d.now();
  }

  /** Fed every event in file order (index.ts): the spawns to judge. */
  onEvent(event: object): void {
    const e = event as Record<string, unknown>;
    const t = e['t'];
    // The files are read from the start at every bridge start: only what happens now counts.
    if (typeof t !== 'number' || t < this.#startedAt - 5) return;
    if (e['type'] === 'spawn' && typeof e['steamId'] === 'string') this.#pending.push({ steamId: e['steamId'], t });
  }

  /** The species with a limit, how many alive (the panel). */
  counts(): SpeciesCount[] { return this.#counts; }
  /** Who is past the limit now, waiting to be removed (the panel). */
  over(): OverEntry[] { return [...this.#over.values()]; }

  /** Every few seconds (index.ts). */
  async tick(): Promise<void> {
    const d = this.#d;
    if (!this.#loaded) { this.#seq = (await d.loadState()).seq; this.#loaded = true; }
    const s = await d.settings();
    const now = d.now();
    const dinos = d.aliveDinos().map((x) => ({ ...x, species: short(x.species) }));
    const byId = new Map(dinos.map((x) => [x.steamId, x]));
    const seqBefore = this.#seq;

    // Still the same dino, and not long past its time: kept; anything else is over and done.
    for (const [id, o] of this.#over) {
      const x = byId.get(id);
      if (!s.enabled || x === undefined || x.spawnedAt !== o.spawnedAt || x.species !== o.species || now > o.killAt + 60) this.#over.delete(id);
    }

    const exempt = await d.exempt();
    const counted = (o: { steamId: string }): boolean => !exempt.has(o.steamId) && !this.#over.has(o.steamId);
    if (!s.enabled) {
      this.#pending = [];
    } else {
      const due = this.#pending.filter((p) => now - p.t >= JUDGE_AFTER_S).sort((a, b) => a.t - b.t);
      this.#pending = this.#pending.filter((p) => now - p.t < JUDGE_AFTER_S);
      for (const p of due) {
        const x = byId.get(p.steamId);
        if (x === undefined || x.spawnedAt !== p.t || !x.fresh || x.growth === null || x.growth > FRESH_MAX_GROWTH || exempt.has(p.steamId)) continue;
        const rule = s.species[x.species];
        if (rule === undefined || this.#over.has(p.steamId)) continue;
        // The ones that count and were there before it (a later spawn does not take its place).
        const before = dinos.filter((o) => o.steamId !== x.steamId && o.species === x.species && o.spawnedAt <= x.spawnedAt && counted(o)).length;
        if (before < rule.cap) continue;
        this.#over.set(x.steamId, { id: ++this.#seq, steamId: x.steamId, species: x.species, killAt: now + s.graceS, spawnedAt: x.spawnedAt });
        d.log(`${x.steamId} came in as ${x.species} with ${before} of ${rule.cap} there: removed in ${s.graceS} s`);
      }
    }

    this.#counts = Object.entries(s.species).map(([sp, r]) => {
      const of = dinos.filter((x) => x.species === sp);
      return { species: sp, alive: of.filter(counted).length, free: of.filter((x) => exempt.has(x.steamId)).length, cap: r.cap };
    }).sort((a, b) => a.species.localeCompare(b.species));

    if (this.#seq !== seqBefore) await d.saveState({ seq: this.#seq });
    const text = JSON.stringify(this.over().map((o) => o.id));
    if (text !== this.#overText) { await d.writeOver(this.over()); this.#overText = text; }
  }
}
