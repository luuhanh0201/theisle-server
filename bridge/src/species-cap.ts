import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';

/**
 * The species limit (owner, 2026-10-10): "T-Rex 5" = once 5 T-Rex of plain players (VIP included) are
 * alive, the species goes off the game's picker (RCON RemovePlayable), so the next player does not see it
 * there; back (AddPlayable) once one dies, leaves or is stored. Nothing is removed: a player who comes back
 * on a dino they already had (a relog, the garage) plays it as ever. SVip and admins are not counted
 * ("ngoại lệ, không tính vào số lượng"). The picker is the whole server's: while a species is off, nobody
 * picks it there, SVip included. No limit (0) on a species: always on the picker (the default).
 *
 * Only a species Game.ini allows is ever put back (one the admin took off the server stays off); after a
 * game restart (Game.ini read again, every allowed species back) the full ones are taken off again.
 *
 *   data/species-cap.json         SpeciesCapSettings (panel → Server → Giới hạn loài)
 *   data/species-cap-state.json   { hidden }: the species this took off the picker
 */

export interface SpeciesRule { cap: number }
export interface SpeciesCapSettings { enabled: boolean; species: Record<string, SpeciesRule> }
export const SPECIES_CAP_DEFAULTS: SpeciesCapSettings = { enabled: false, species: {} };

const NAME = /^[A-Za-z][A-Za-z0-9_]{1,40}$/;

export function validateSpeciesCap(raw: unknown): SpeciesCapSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const sp = r['species'] ?? {};
  if (typeof sp !== 'object' || sp === null || Array.isArray(sp)) throw new ValidationError('species must be an object');
  const species: Record<string, SpeciesRule> = {};
  for (const [name, v] of Object.entries(sp as Record<string, unknown>)) {
    if (!NAME.test(name)) throw new ValidationError(`${name}: not a species name`);
    const n = (typeof v === 'object' && v !== null ? v as Record<string, unknown> : {})['cap'];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 500) throw new ValidationError(`${name}: cap must be 0–500`);
    // 0: no limit (the panel's 0).
    if (n > 0) species[name] = { cap: n };
  }
  if (Object.keys(species).length > 60) throw new ValidationError('at most 60 species');
  return { enabled: r['enabled'] === true, species };
}

const settingsPath = (): string => join(config.dataDir, 'species-cap.json');
const statePath = (): string => join(config.dataDir, 'species-cap-state.json');

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

export interface AliveDino { steamId: string; species: string }

export interface SpeciesCapDeps {
  /** One dino per online player alive now (store.ts aliveDinos). */
  aliveDinos: () => AliveDino[];
  /** Who is not counted: the SVip and the admins (member-tier.ts). */
  exempt: () => Promise<ReadonlySet<string>>;
  /** Game.ini's AllowedClasses, null when it cannot be read. */
  allowed: () => Promise<ReadonlySet<string> | null>;
  /** RCON: AddPlayable / RemovePlayable a species (short name); GetPlayables. */
  rcon: { enabled: boolean; run(name: 'addPlayable' | 'removePlayable' | 'getPlayables', arg?: string): Promise<string> };
  settings?: () => Promise<SpeciesCapSettings>;
  saveState?: (st: { hidden: string[] }) => Promise<void>;
  loadState?: () => Promise<{ hidden: string[] }>;
  now?: () => number;
  log?: (line: string) => void;
}

/** A species with a limit: the dinos that count alive now, the SVip / admins' apart, whether off the picker. */
export interface SpeciesCount { species: string; alive: number; free: number; cap: number; hidden: boolean }

/** BP_Tyrannosaurus_C (or a class path) → Tyrannosaurus, the name Game.ini and RCON use. */
const short = (raw: string): string => (raw.split('.').pop() ?? raw).replace(/^BP_/, '').replace(/_C$/, '');

export class SpeciesCaps {
  readonly #d: Required<Omit<SpeciesCapDeps, 'aliveDinos' | 'exempt' | 'allowed' | 'rcon'>> & SpeciesCapDeps;
  #hidden = new Set<string>();
  #loaded = false;
  #startedAt: number;
  #lastSync = 0;
  #counts: SpeciesCount[] = [];

  constructor(deps: SpeciesCapDeps) {
    this.#d = {
      settings: readSpeciesCap,
      saveState: (st) => writeJson(statePath(), st),
      loadState: async () => {
        try {
          const raw = JSON.parse(await readFile(statePath(), 'utf8')) as { hidden?: unknown };
          return { hidden: Array.isArray(raw.hidden) ? raw.hidden.filter((x): x is string => typeof x === 'string' && NAME.test(x)) : [] };
        } catch { return { hidden: [] }; }
      },
      now: () => Math.floor(Date.now() / 1000),
      log: (line) => console.info(`[species-cap] ${line}`),
      ...deps,
    };
    this.#startedAt = this.#d.now();
  }

  /** Fed every event in file order (index.ts): a server start shows every allowed species again. */
  onEvent(event: object): void {
    const e = event as Record<string, unknown>;
    const t = e['t'];
    // The files are read from the start at every bridge start: only what happens now counts.
    if (typeof t !== 'number' || t < this.#startedAt - 5) return;
    if (e['type'] === 'mod_loaded' && e['mod'] === 'StatsLogger') { this.#hidden.clear(); this.#lastSync = 0; }
  }

  /** The species with a limit, how many alive, whether off the picker (the panel). */
  counts(): SpeciesCount[] { return this.#counts; }

  /** Every few seconds (index.ts). */
  async tick(): Promise<void> {
    const d = this.#d;
    if (!this.#loaded) { this.#hidden = new Set((await d.loadState()).hidden); this.#loaded = true; }
    const s = await d.settings();
    const now = d.now();
    const before = [...this.#hidden].sort().join(',');
    const exempt = await d.exempt();
    const counted = new Map<string, number>();
    const free = new Map<string, number>();
    for (const x of d.aliveDinos()) {
      const sp = short(x.species);
      const m = exempt.has(x.steamId) ? free : counted;
      m.set(sp, (m.get(sp) ?? 0) + 1);
    }
    const full = new Set(s.enabled ? Object.entries(s.species).filter(([sp, r]) => (counted.get(sp) ?? 0) >= r.cap).map(([sp]) => sp) : []);
    if (d.rcon.enabled) await this.#picker(full, now);
    this.#counts = Object.entries(s.species).map(([sp, r]) => ({ species: sp, alive: counted.get(sp) ?? 0, free: free.get(sp) ?? 0, cap: r.cap, hidden: this.#hidden.has(sp) }))
      .sort((a, b) => a.species.localeCompare(b.species));
    if ([...this.#hidden].sort().join(',') !== before) await d.saveState({ hidden: [...this.#hidden].sort() });
  }

  async #picker(full: ReadonlySet<string>, now: number): Promise<void> {
    const d = this.#d;
    // Every 30 s, the game's own list: a species this took off but the game shows again (the server
    // restarted while the bridge was down) is taken off again.
    if (this.#hidden.size > 0 && now - this.#lastSync >= 30) {
      this.#lastSync = now;
      try {
        const listed = new Set((await d.rcon.run('getPlayables')).split(/[\s,]+/).map((x) => x.trim()).filter((x) => NAME.test(x)));
        for (const sp of this.#hidden) if (listed.has(sp)) this.#hidden.delete(sp);
      } catch (error) { d.log(`getPlayables failed: ${(error as Error).message}`); }
    }
    for (const sp of full) {
      if (this.#hidden.has(sp)) continue;
      try { await d.rcon.run('removePlayable', sp); this.#hidden.add(sp); d.log(`${sp} at its limit: off the picker`); }
      catch (error) { d.log(`removePlayable ${sp} failed: ${(error as Error).message}`); }
    }
    const back = [...this.#hidden].filter((sp) => !full.has(sp));
    if (back.length === 0) return;
    const allowed = await d.allowed();
    // Game.ini unreadable: kept off until it can be read (never put back one the admin took off the server).
    if (allowed === null) return;
    for (const sp of back) {
      if (!allowed.has(sp)) { this.#hidden.delete(sp); continue; }
      try { await d.rcon.run('addPlayable', sp); this.#hidden.delete(sp); d.log(`${sp} has room: back on the picker`); }
      catch (error) { d.log(`addPlayable ${sp} failed: ${(error as Error).message}`); }
    }
  }
}
