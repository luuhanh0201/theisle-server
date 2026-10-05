import { findReference } from './mutation-reference.js';
import type { MutationSlots } from './events.js';

/**
 * A mutation's strength by generation (đời), for the bag's confirm box
 * (Túi đồ, items.ts). In game it is one number for the whole dino: its
 * ElderReplicationStacks (đời = stacks + 1). A mutation item the dino has
 * already raises it by one (a rebirth's +1 đời, every mutation on the dino
 * with it), while that mutation still grows: its table (mutation-reference.ts
 * `tiers`, đời 1…4, the last holds beyond) stops at its max, and a mutation
 * with no table, or one value, counts as maxed (the owner's call, 2026-10-02).
 */

export const ACTIVE_SLOTS = ['Slot1', 'Slot2', 'Slot3', 'Slot4'] as const;

/**
 * A duplicate item raising the dino +1 đời: OFF (2026-10-02). The owner wants
 * ONE mutation stronger, not the whole dino, and the game keeps no per-mutation
 * tier (ReplicatedMutationsData holds names only; the strength follows
 * ElderReplicationStacks), so +1 đời made every mutation, later picks too,
 * stronger. Kept for a separate "lên đời dino" item; a per-mutation way is being
 * tried on the test server.
 */
export const DUPLICATE_UPGRADE = false;

/** The values per generation, or null when the sources give none. */
export function tierValues(name: string): string[] | null {
  const raw = findReference(name)?.tiers;
  if (!raw) return null;
  const values = raw.split('/').map((s) => s.trim()).filter((s) => s !== '');
  return values.length > 0 ? values : null;
}

/** The stacks at which this mutation stops growing: 0 = it never grows (or nobody knows). */
export function maxStacksOf(name: string): number {
  const v = tierValues(name);
  if (v === null) return 0;
  let last = 0;
  for (let i = 1; i < v.length; i++) if (v[i] !== v[i - 1]) last = i;
  return last;
}

/** Its value at these stacks (the last one beyond the table), or null. */
export function valueAt(name: string, stacks: number): string | null {
  const v = tierValues(name);
  if (v === null) return null;
  return v[Math.min(Math.max(0, stacks), v.length - 1)] ?? null;
}

const norm = (s: string): string => s.replace(/^MUT_/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const display = (fname: string): string => findReference(fname)?.name ?? fname.replace(/^MUT_/i, '');

export interface PreviewRow { name: string; now: string | null; after: string | null; maxed: boolean }
export interface MutationPreview {
  /** The dino's stacks now (đời = stacks + 1), or null when not read yet. */
  stacks: number | null;
  /** The four slots a player picks: what is in each, with its value now. */
  slots: Array<{ slot: number; name: string | null; value: string | null }>;
  /** The item's mutation at the dino's generation now. */
  incoming: { name: string; value: string | null };
  /** Where the dino has it already (slot keys: Slot1…, ParentSlot2…, ElderSlot1A…). */
  has: string[];
  /** Upgrade (+1 đời): null when the dino does not have it; else whether it can, and every mutation before → after. */
  upgrade: { ok: boolean; why: string | null; rows: PreviewRow[] } | null;
}

/** What using this mutation would do on a dino with these slots and stacks. */
export function mutationPreview(mutation: string, slots: MutationSlots | null, stacks: number | null): MutationPreview {
  const s = slots ?? {};
  const at = stacks ?? 0;
  const has = Object.keys(s).filter((k) => norm(s[k] ?? '') === norm(mutation));
  const names = [...new Map(Object.values(s).map((n) => [norm(n), display(n)])).values()];
  let upgrade: MutationPreview['upgrade'] = null;
  if (has.length > 0 && DUPLICATE_UPGRADE) {
    const max = maxStacksOf(mutation);
    const why = stacks === null ? 'Chưa đọc được đời của dino, thử lại sau vài giây.'
      : max === 0 ? `${display(mutation)} không tăng theo đời: dùng thêm không mạnh hơn.`
        : at >= max ? `${display(mutation)} đã max chỉ số (${valueAt(mutation, at) ?? '?'} từ đời ${max + 1}).`
          : null;
    upgrade = {
      ok: why === null, why,
      rows: names.map((n) => ({ name: n, now: valueAt(n, at), after: valueAt(n, at + 1), maxed: at >= maxStacksOf(n) })),
    };
  }
  return {
    stacks,
    slots: ACTIVE_SLOTS.map((k, i) => ({ slot: i + 1, name: s[k] ? display(s[k] as string) : null, value: s[k] ? valueAt(s[k] as string, at) : null })),
    incoming: { name: display(mutation), value: valueAt(mutation, at) },
    has,
    upgrade,
  };
}
