import type { CatalogSpecies } from '@isle/api';

/** The 16 mutation fields a slot may set, by group (bridge/src/garage.ts). */
export const MUT_SLOTS = {
  active: ['Slot1', 'Slot2', 'Slot3', 'Slot4'],
  parent: ['ParentSlot1', 'ParentSlot2', 'ParentSlot3', 'ParentSlot4'],
  elder: ['ElderSlot1A', 'ElderSlot1B', 'ElderSlot2A', 'ElderSlot2B', 'ElderSlot3A', 'ElderSlot3B', 'ElderSlot4A', 'ElderSlot4B'],
} as const;
export type MutGroup = keyof typeof MUT_SLOTS;
export const SLOT_LABEL = (k: string): string => k.replace('ParentSlot', 'Cha mẹ ').replace('ElderSlot', 'Elder ').replace(/^Slot/, 'Slot ');
/** A mutation name the bridge takes (bridge/src/catalog.ts). */
export const MUT_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9 _-]{0,62}[A-Za-z0-9])?$/;
export const PRIME_MIN = 75;

/** The ten prime tasks as a 10-character code ("0000001100": 7 and 8, a new dino's). */
export const DEFAULT_PRIME = '0000001100';
export const primeCount = (code: string): number => [...code].filter((c) => c === '1').length;
// The game makes a dino prime only with five tasks done: prime ticked on 2–4 tasks came out plain
// (2026-09-27). Ticking prime fills up to five, the most usual ones first.
const PRIME_FILL_ORDER = [3, 5, 1, 6, 10, 2, 4, 9, 7, 8];
/** Prime asked with fewer than five tasks: the most usual ones added up to five. */
export function fillPrime(code: string): string {
  const out = [...code];
  let n = primeCount(code);
  for (const cond of PRIME_FILL_ORDER) {
    if (n >= 5) break;
    if (out[cond - 1] !== '1') { out[cond - 1] = '1'; n++; }
  }
  return out.join('');
}
export const toggleTask = (code: string, cond: number, on: boolean): string => [...code].map((c, i) => (i === cond - 1 ? (on ? '1' : '0') : c)).join('');
/** /api/prime-last's conditions { "1": true, … } → the code. */
export const codeOf = (conditions: Record<string, boolean>): string => Array.from({ length: 10 }, (_, i) => (conditions[String(i + 1)] === true ? '1' : '0')).join('');

/** Entombments the chosen elder slots imply: ElderSlotNA / B come from the N-th one. */
export function impliedStacks(mutations: Record<string, string>): number {
  let n = 0;
  for (const [slot, v] of Object.entries(mutations)) {
    const m = /^ElderSlot(\d)/.exec(slot);
    if (v && m) n = Math.max(n, Number(m[1]));
  }
  return n;
}

/** The mutations a picker offers: confirmed on this species; the others only when allowed. */
export function mutationChoices(catalog: CatalogSpecies[], species: string | null, allowUnconfirmed: boolean): { own: string[]; others: string[] } {
  const entry = species ? catalog.find((c) => c.species === species) ?? null : null;
  const own = entry ? Object.keys(entry.evidence ?? {}).sort() : [];
  const others = new Set<string>();
  if (allowUnconfirmed) {
    for (const c of catalog) {
      if (c === entry) continue;
      for (const n of Object.keys(c.evidence ?? {})) if (!own.includes(n)) others.add(n);
    }
  }
  return { own, others: [...others].sort() };
}

/** A choice no longer offered (species changed, toggle off) falls back to empty. */
export function keepOffered(mutations: Record<string, string>, offered: ReadonlySet<string>): Record<string, string> {
  return Object.fromEntries(Object.entries(mutations).filter(([, v]) => offered.has(v)));
}

export interface StatPoint { growth: number; max: Record<string, number> }
/** The usual maxima at growth g (0–1) from the readings: straight between the two nearest (bridge maximaAt). */
export function maximaAtGrowth(points: StatPoint[] | null | undefined, g: number): Record<string, number> | null {
  if (!points || points.length === 0) return null;
  const first = points[0]!, last = points[points.length - 1]!;
  if (g <= first.growth) return first.max;
  if (g >= last.growth) return last.max;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!;
    if (g >= a.growth && g <= b.growth) {
      const f = (g - a.growth) / (b.growth - a.growth || 1);
      const out: Record<string, number> = {};
      for (const k of Object.keys(a.max)) {
        const x = a.max[k], y = b.max[k];
        if (typeof x === 'number' && typeof y === 'number') out[k] = x + (y - x) * f;
      }
      return out;
    }
  }
  return null;
}

/** A free slot name next to `base` ("admin" → "admin_2", "admin_3"…). */
export function freeSlotName(base: string, taken: ReadonlySet<string>): string {
  const root = base.replace(/_\d+$/, '') || 'admin';
  for (let i = 2; i < 100; i++) {
    const name = `${root}_${i}`.slice(0, 32);
    if (!taken.has(name)) return name;
  }
  return `${root}_${Date.now() % 100000}`;
}
