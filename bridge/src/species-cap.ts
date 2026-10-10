import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';

/**
 * The species limit (owner, 2026-10-10): at most `cap` dinos of a species alive at once for everyone,
 * plus `reserve` more for VIP / SVip / admins. "Server chỉ cho 8 T-Rex thì người thứ 9 không thấy T-Rex
 * trên bảng chọn dino":
 *
 *   * cap + reserve alive: the species goes off the game's picker for everyone (RCON RemovePlayable,
 *     the picker is the whole server's), back (AddPlayable) once one dies, leaves or is stored. Only a
 *     species Game.ini allows is ever put back (one the admin took off the server stays off).
 *   * a player with no priority (not VIP / SVip / admin) who came in as one past the common slots (a
 *     priority slot, or picked a moment before it went off) is told and, `graceS` later, the dino is
 *     removed (DinoGarage garage/speciescap.lua, which also refuses them a garage redeem meanwhile).
 *     Only a new dino: a relog on one they had, a rebirth, a dino out of the garage are never
 *     touched, nor one that did not start at the picker's 25 % (StatsLogger, 887 spawns: every
 *     species starts there). A dino already playing when the admin lowers a limit stays.
 *   * every dino counts, the priority ones too ("có đếm").
 *
 *   data/species-cap.json         SpeciesCapSettings (panel → Server → Giới hạn loài)
 *   data/species-cap-state.json   { hidden, seq }: the species this took off the picker
 *   <DinoGarage>/species-cap.json { over }: who is past the common slots (the mod's)
 */

export interface SpeciesRule { cap: number; reserve: number }
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
    species[name] = { cap: int(o['cap'], 'cap', 500), reserve: int(o['reserve'] ?? 0, 'reserve', 100) };
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
  /** VIP / SVip / admins (member-tier.ts). */
  priority: () => Promise<ReadonlySet<string>>;
  /** Game.ini's AllowedClasses, null when it cannot be read. */
  allowed: () => Promise<ReadonlySet<string> | null>;
  /** RCON: AddPlayable / RemovePlayable a species (short name); GetPlayables. */
  rcon: { enabled: boolean; run(name: 'addPlayable' | 'removePlayable' | 'getPlayables', arg?: string): Promise<string> };
  settings?: () => Promise<SpeciesCapSettings>;
  /** Persist what this took off the picker and who is over (the defaults: the files above). */
  saveState?: (st: { hidden: string[]; seq: number }) => Promise<void>;
  loadState?: () => Promise<{ hidden: string[]; seq: number }>;
  writeOver?: (over: OverEntry[]) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

export interface SpeciesCount { species: string; alive: number; cap: number; reserve: number; hidden: boolean }

/** BP_Tyrannosaurus_C (or a class path) → Tyrannosaurus, the name Game.ini and RCON use. */
const short = (raw: string): string => (raw.split('.').pop() ?? raw).replace(/^BP_/, '').replace(/_C$/, '');

export class SpeciesCaps {
  readonly #d: Required<Omit<SpeciesCapDeps, 'aliveDinos' | 'priority' | 'allowed' | 'rcon'>> & SpeciesCapDeps;
  #hidden = new Set<string>();
  #seq = 0;
  #over = new Map<string, OverEntry>();
  #pending: Array<{ steamId: string; t: number }> = [];
  #loaded = false;
  #startedAt: number;
  #lastSync = 0;
  #overText = '';
  #counts: SpeciesCount[] = [];

  constructor(deps: SpeciesCapDeps) {
    this.#d = {
      settings: readSpeciesCap,
      saveState: (st) => writeJson(statePath(), st),
      loadState: async () => {
        try {
          const raw = JSON.parse(await readFile(statePath(), 'utf8')) as { hidden?: unknown; seq?: unknown };
          return { hidden: Array.isArray(raw.hidden) ? raw.hidden.filter((x): x is string => typeof x === 'string' && NAME.test(x)) : [],
            seq: typeof raw.seq === 'number' ? raw.seq : 0 };
        } catch { return { hidden: [], seq: 0 }; }
      },
      writeOver: (over) => writeJson(overPath(), { over: over.map(({ id, steamId, species, killAt }) => ({ id, steamId, species, killAt })) }),
      now: () => Math.floor(Date.now() / 1000),
      log: (line) => console.info(`[species-cap] ${line}`),
      ...deps,
    };
    this.#startedAt = this.#d.now();
  }

  /** Fed every event in file order (index.ts): spawns to judge; a server start shows every species again. */
  onEvent(event: object): void {
    const e = event as Record<string, unknown>;
    const t = e['t'];
    // The files are read from the start at every bridge start: only what happens now counts.
    if (typeof t !== 'number' || t < this.#startedAt - 5) return;
    if (e['type'] === 'spawn' && typeof e['steamId'] === 'string') this.#pending.push({ steamId: e['steamId'], t });
    // The game read Game.ini again: every allowed species is on its list.
    if (e['type'] === 'mod_loaded' && e['mod'] === 'StatsLogger') { this.#hidden.clear(); this.#lastSync = 0; }
  }

  /** The species with a limit, how many alive, whether off the picker (the panel). */
  counts(): SpeciesCount[] { return this.#counts; }
  /** Who is past the common slots now (the panel). */
  over(): OverEntry[] { return [...this.#over.values()]; }

  /** Every few seconds (index.ts). */
  async tick(): Promise<void> {
    const d = this.#d;
    if (!this.#loaded) {
      const st = await d.loadState();
      this.#hidden = new Set(st.hidden);
      this.#seq = st.seq;
      this.#loaded = true;
    }
    const s = await d.settings();
    const now = d.now();
    const dinos = d.aliveDinos().map((x) => ({ ...x, species: short(x.species) }));
    const byId = new Map(dinos.map((x) => [x.steamId, x]));
    const hiddenBefore = [...this.#hidden].sort().join(',');
    const seqBefore = this.#seq;

    // Still the same dino, and not long past its time: kept; anything else is over and done.
    for (const [id, o] of this.#over) {
      const x = byId.get(id);
      if (!s.enabled || x === undefined || x.spawnedAt !== o.spawnedAt || x.species !== o.species || now > o.killAt + 60) this.#over.delete(id);
    }

    if (!s.enabled) {
      this.#pending = [];
    } else {
      const due = this.#pending.filter((p) => now - p.t >= JUDGE_AFTER_S).sort((a, b) => a.t - b.t);
      this.#pending = this.#pending.filter((p) => now - p.t < JUDGE_AFTER_S);
      const prio = due.length > 0 ? await d.priority() : new Set<string>();
      for (const p of due) {
        const x = byId.get(p.steamId);
        if (x === undefined || x.spawnedAt !== p.t || !x.fresh || x.growth === null || x.growth > FRESH_MAX_GROWTH || prio.has(p.steamId)) continue;
        const rule = s.species[x.species];
        if (rule === undefined || this.#over.has(p.steamId)) continue;
        // The ones there before it (a later spawn does not take its slot), none of those already over.
        const before = dinos.filter((o) => o.steamId !== x.steamId && o.species === x.species && o.spawnedAt <= x.spawnedAt && !this.#over.has(o.steamId));
        const inPriority = Math.min(before.filter((o) => prio.has(o.steamId)).length, rule.reserve);
        if (before.length - inPriority < rule.cap) continue;
        const entry: OverEntry = { id: ++this.#seq, steamId: x.steamId, species: x.species, killAt: now + s.graceS, spawnedAt: x.spawnedAt };
        this.#over.set(x.steamId, entry);
        d.log(`${x.steamId} came in as ${x.species} past the ${rule.cap} common slots (${before.length} there before): removed in ${s.graceS} s`);
      }
    }

    // The picker: a species full (cap + reserve, the ones over not counted) off, the others back.
    const alive = new Map<string, number>();
    for (const x of dinos) if (!this.#over.has(x.steamId)) alive.set(x.species, (alive.get(x.species) ?? 0) + 1);
    const full = new Set(s.enabled ? Object.entries(s.species).filter(([sp, r]) => (alive.get(sp) ?? 0) >= r.cap + r.reserve).map(([sp]) => sp) : []);
    if (d.rcon.enabled) await this.#picker(full, now);
    this.#counts = Object.entries(s.species).map(([sp, r]) => ({ species: sp, alive: alive.get(sp) ?? 0, cap: r.cap, reserve: r.reserve, hidden: this.#hidden.has(sp) }))
      .sort((a, b) => a.species.localeCompare(b.species));

    if ([...this.#hidden].sort().join(',') !== hiddenBefore || this.#seq !== seqBefore) await d.saveState({ hidden: [...this.#hidden].sort(), seq: this.#seq });
    const text = JSON.stringify(this.over().map((o) => o.id));
    if (text !== this.#overText) { await d.writeOver(this.over()); this.#overText = text; }
  }

  async #picker(full: ReadonlySet<string>, now: number): Promise<void> {
    const d = this.#d;
    // Every 30 s, the game's own list: a species this took off but the game shows again (the server
    // restarted while the bridge was down) is taken off again.
    if (this.#hidden.size > 0 && now - this.#lastSync >= 30) {
      this.#lastSync = now;
      try {
        const listed = new Set((await d.rcon.run('getPlayables')).split(/[\s,]+/).map((x) => x.trim()).filter((x) => NAME.test(x)));
        if (listed.size > 0) for (const sp of this.#hidden) if (listed.has(sp)) this.#hidden.delete(sp);
      } catch (error) { d.log(`getPlayables failed: ${(error as Error).message}`); }
    }
    for (const sp of full) {
      if (this.#hidden.has(sp)) continue;
      try { await d.rcon.run('removePlayable', sp); this.#hidden.add(sp); d.log(`${sp} full: off the picker`); }
      catch (error) { d.log(`removePlayable ${sp} failed: ${(error as Error).message}`); }
    }
    const back = [...this.#hidden].filter((sp) => !full.has(sp));
    if (back.length === 0) return;
    const allowed = await d.allowed();
    for (const sp of back) {
      // Not on Game.ini's list (the admin took it off the server): left off, no longer ours.
      if (allowed === null) continue;
      if (!allowed.has(sp)) { this.#hidden.delete(sp); continue; }
      try { await d.rcon.run('addPlayable', sp); this.#hidden.delete(sp); d.log(`${sp} has room: back on the picker`); }
      catch (error) { d.log(`addPlayable ${sp} failed: ${(error as Error).message}`); }
    }
  }
}
