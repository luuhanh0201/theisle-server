import type { MutationSlots } from './events.js';

/**
 * Species and mutations that have actually been seen on this server.
 *
 * The admin "create a dino" form picks from this instead of a hard-coded
 * list, for two reasons:
 *   - DinoGarage's !redeem compares the stored classPath with the live pawn's
 *     GetFullName() exactly. A guessed path makes a slot nobody can redeem.
 *   - Mutations are written into the game as FName(name). The valid names are
 *     not documented; the only trustworthy source is what the game reported.
 *
 * Every sighting is kept as evidence (how often, by how many players, when),
 * so the panel can show WHY a mutation counts as confirmed for a species.
 */

export type MutationGroup = 'active' | 'parent' | 'elder';

/** Proof that the game reported a mutation on a species. */
export interface Evidence {
  /** Sightings: spawns, picks and stored slots that carried it. */
  count: number;
  /** Distinct players it was seen on. */
  players: number;
  /** Unix seconds of the latest sighting (0 when unknown). */
  lastSeen: number;
  /** Slot groups it was seen in. */
  groups: MutationGroup[];
}

export interface CatalogSpecies {
  /** BP_Carnotaurus_C */
  species: string;
  /** Null when we have only seen the short name (a spawn from an older mod). */
  classPath: string | null;
  mutations: Record<MutationGroup, string[]>;
  /** Every mutation confirmed on this species, whatever the slot. */
  evidence: Record<string, Evidence>;
}

/**
 * What a mutation FName may look like. The game uses display names with
 * spaces ("Reniculate Kidneys", "Reinforced Tendons") and some CamelCase ones
 * ("PhotosyntheticTissueStatAdder"), so spaces and hyphens are allowed; no
 * leading/trailing space, nothing path- or markup-like.
 */
export const MUTATION_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9 _-]{0,62}[A-Za-z0-9])?$/;

export function groupOfSlot(slot: string): MutationGroup | null {
  if (/^Slot[1-4]$/.test(slot)) return 'active';
  if (/^ParentSlot[1-4]$/.test(slot)) return 'parent';
  if (/^ElderSlot[1-4][AB]$/.test(slot)) return 'elder';
  return null;
}

/** "…/BP_Rex.BP_Rex_C" -> "BP_Rex_C" */
export function speciesOfClassPath(classPath: string): string {
  return classPath.split('.').pop() ?? classPath;
}

interface Sighting {
  count: number;
  players: Set<string>;
  lastSeen: number;
  groups: Set<MutationGroup>;
}

interface Entry {
  classPath: string | null;
  mutations: Map<string, Sighting>;
}

/** Where a sighting came from, for the evidence counts. */
export interface Source {
  t?: number;
  steamId?: string;
}

export class Catalog {
  readonly #bySpecies = new Map<string, Entry>();

  #entry(species: string): Entry {
    let e = this.#bySpecies.get(species);
    if (e === undefined) {
      e = { classPath: null, mutations: new Map() };
      this.#bySpecies.set(species, e);
    }
    return e;
  }

  addSpecies(species: string, classPath?: string | null): void {
    if (species === '' || species === 'unknown') return;
    const e = this.#entry(species);
    if (classPath) e.classPath = classPath;
  }

  addClassPath(classPath: string): void {
    this.addSpecies(speciesOfClassPath(classPath), classPath);
  }

  addMutation(species: string, slot: string, name: string | undefined, source: Source = {}): void {
    if (name === undefined || name === '' || name === 'None') return;
    const group = groupOfSlot(slot);
    if (group === null || species === '' || species === 'unknown') return;
    const e = this.#entry(species);
    let s = e.mutations.get(name);
    if (s === undefined) {
      s = { count: 0, players: new Set(), lastSeen: 0, groups: new Set() };
      e.mutations.set(name, s);
    }
    s.count += 1;
    s.groups.add(group);
    if (source.steamId) s.players.add(source.steamId);
    if (source.t !== undefined && source.t > s.lastSeen) s.lastSeen = source.t;
  }

  addMutations(species: string, slots: MutationSlots | undefined, source: Source = {}): void {
    if (slots === undefined || typeof slots !== 'object') return;
    for (const [slot, name] of Object.entries(slots)) {
      if (typeof name === 'string') this.addMutation(species, slot, name, source);
    }
  }

  /** Is this mutation confirmed on this species (in any slot)? */
  confirms(species: string, name: string): boolean {
    return this.#bySpecies.get(species)?.mutations.has(name) ?? false;
  }

  /** Seen on any species at all. */
  knows(name: string): boolean {
    for (const e of this.#bySpecies.values()) if (e.mutations.has(name)) return true;
    return false;
  }

  /** Merge another catalog in (the garage files into the event-derived one). */
  merge(other: Catalog): Catalog {
    const out = new Catalog();
    for (const src of [this, other]) {
      for (const [species, e] of src.#bySpecies) {
        out.addSpecies(species, e.classPath);
        const into = out.#entry(species);
        for (const [name, s] of e.mutations) {
          let t = into.mutations.get(name);
          if (t === undefined) {
            t = { count: 0, players: new Set(), lastSeen: 0, groups: new Set() };
            into.mutations.set(name, t);
          }
          t.count += s.count;
          for (const p of s.players) t.players.add(p);
          for (const g of s.groups) t.groups.add(g);
          t.lastSeen = Math.max(t.lastSeen, s.lastSeen);
        }
      }
    }
    return out;
  }

  list(): CatalogSpecies[] {
    return [...this.#bySpecies.entries()]
      .map(([species, e]) => {
        const byGroup = { active: [] as string[], parent: [] as string[], elder: [] as string[] };
        const evidence: Record<string, Evidence> = {};
        for (const [name, s] of [...e.mutations.entries()].sort(([a], [b]) => a.localeCompare(b))) {
          for (const g of s.groups) byGroup[g].push(name);
          evidence[name] = {
            count: s.count,
            players: s.players.size,
            lastSeen: s.lastSeen,
            groups: [...s.groups],
          };
        }
        return { species, classPath: e.classPath, mutations: byGroup, evidence };
      })
      .sort((a, b) => a.species.localeCompare(b.species));
  }
}
