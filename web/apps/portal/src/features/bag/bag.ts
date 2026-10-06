import type { PlayerMe } from '@isle/api';

/** One copy in the bag (/api/me items, bridge player-api.ts): its kind's own fields beside the common ones. */
export interface BagItem {
  uid: string; id: string; type: string; name: string; rarity: string;
  mutation?: string; diet?: string; slot2?: boolean; description?: string; refusal?: string | null;
  maxRarity?: string; amount?: number; below?: number; pick?: 'random' | 'choose'; growthMin?: number; growthMax?: number;
  prizes?: number; species?: string; skin?: { colors?: Record<string, { r: number; g: number; b: number }> } | null;
  dino?: { label: string; growth: number } | null; locked?: string | null;
}
/** A card: copies of the same item together (a dino item each its own). */
export interface BagGroup extends BagItem { key: string; uids: string[] }

export const BAG_DIET: Record<string, string> = { all: 'Mọi loài', carnivore: 'Ăn thịt', herbivore: 'Ăn cỏ', herbivore_omnivore: 'Ăn cỏ / ăn tạp' };
export const BAG_RARITY: Record<string, string> = { common: 'Thường', rare: 'Hiếm', epic: 'Sử thi', legendary: 'Huyền thoại', special: 'Đặc biệt' };

/** The bag's kinds (owner, 2026-10-05: "phân loại vật phẩm cho dễ tìm"): a tab each, a heading each in "Tất cả". */
export const BAG_CATS = [
  { key: 'loot', label: '🏺 Hòm', types: ['loot_box'] },
  { key: 'dino', label: '🦖 Dino', types: ['dino_box', 'dino'] },
  { key: 'mutation', label: '🧬 Mutation', types: ['mutation'] },
  { key: 'ticket', label: '🎟️ Phiếu', types: ['mutation_ticket', 'mutation_clear', 'prime_ticket'] },
  { key: 'care', label: '🍖 Chăm sóc dino', types: ['growth_bag', 'food_box', 'salt_lick'] },
  { key: 'skin', label: '🎨 Skin', types: ['skin'] },
] as const;
export const BAG_TYPE_ORDER: string[] = BAG_CATS.flatMap((c) => [...c.types]);
export const bagCat = (type: string): string => BAG_CATS.find((c) => (c.types as readonly string[]).includes(type))?.key ?? 'other';
/** Items used without a dino in game (they go into the garage). */
export const BAG_NO_DINO = new Set(['dino_box', 'dino', 'loot_box']);
export const bagKey = (s: unknown): string => String(s ?? '').replace(/^BP_/, '').replace(/_C$/, '').toLowerCase();
/** A mutation's icon slug (img/mutations/<slug>.svg, filled by mut-icons.js). */
export const mutSlug = (name: unknown): string => String(name ?? '').replace(/^MUT_/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** The skin's game colours are linear and may go above 1 (lighter than a picker): shown clamped, sRGB. */
export const bagHex = (c: { r: number; g: number; b: number }): string => {
  const ch = (v: number): number => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)));
  return `rgb(${ch(c.r)},${ch(c.g)},${ch(c.b)})`;
};
export const pctOf = (g: number): string => `${Math.round(g * 100)}%`;

/** One card a kind of item: copies of the same item grouped, with how many, a dino item each its own (its species, its growth). */
export function bagGroups(items: BagItem[]): BagGroup[] {
  const by = new Map<string, BagGroup>();
  for (const it of items) {
    const key = it.type === 'dino' ? it.uid : it.id;
    const g = by.get(key);
    if (g) g.uids.push(it.uid);
    else by.set(key, { ...it, key, uids: [it.uid], ...(it.type === 'dino' && it.dino ? { name: `${it.dino.label} ${Math.round(it.dino.growth * 100)}%` } : {}) });
  }
  return [...by.values()];
}

/** What the bag shows for this player now: the cards, which can be used, which do not fit the dino. */
export function bagView(me: PlayerMe, filter: string, query: string) {
  const items = (Array.isArray(me.items) ? me.items : []) as unknown as BagItem[];
  const groups = bagGroups(items);
  const dino = me.dino?.species ?? null;
  const prison = Boolean((me as { prison?: unknown }).prison);
  const usable = (g: BagGroup): boolean => (g.locked ? false : BAG_NO_DINO.has(g.type) ? true : g.type === 'mutation' ? dino !== null && !g.refusal && !prison
    : g.type === 'skin' ? dino !== null && bagKey(g.species) === bagKey(dino) : dino !== null && !prison);
  const mismatch = (g: BagGroup): boolean => !g.locked && !BAG_NO_DINO.has(g.type) && dino !== null
    && (g.type === 'mutation' ? Boolean(g.refusal) : g.type === 'skin' ? bagKey(g.species) !== bagKey(dino) : false);
  const counts: Record<string, number> = Object.fromEntries(BAG_CATS.map((c) => [c.key, groups.filter((g) => (c.types as readonly string[]).includes(g.type)).length]));
  // A kind emptied: back to everything.
  const f = !['all', 'usable'].includes(filter) && !counts[filter] ? 'all' : filter;
  const q = query.trim().toLowerCase();
  const shown = groups.filter((g) => (f === 'all' || (f === 'usable' ? usable(g) : bagCat(g.type) === f))
    && (!q || `${g.name} ${g.mutation ?? ''} ${g.species ?? ''} ${g.dino?.label ?? ''}`.toLowerCase().includes(q)))
    .sort((a, b) => BAG_TYPE_ORDER.indexOf(a.type) - BAG_TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name, 'vi'));
  const tabs: Array<[string, string, number]> = [['all', 'Tất cả', groups.length], ['usable', 'Dùng được ngay', groups.filter(usable).length],
    ...BAG_CATS.filter((c) => (counts[c.key] ?? 0) > 0).map((c): [string, string, number] => [c.key, c.label, counts[c.key] ?? 0])];
  return { items, groups, dino, prison, usable, mismatch, filter: f, shown, tabs };
}

/** What can be drawn from a dino box, a hòm, a dino item (bridge dino-box.ts, loot.ts). */
export interface BoxOptions { pick: 'random' | 'choose'; growthMin: number; growthMax: number; species: Array<{ key: string; label: string; diet: string }> }
export interface BoxResult { uid: string; label: string; growth: number; species?: string }
export interface LootPrize { itemId: string; name: string; type: string; rarity: string; qty: number; mutation?: string; description?: string }
export interface LootOptions { name?: string; rarity?: string; pool: LootPrize[] }
export interface DinoMutation { name: string; description?: string; slot2?: boolean; femaleOnly?: boolean; quest?: boolean }
export interface DinoOptions { label: string; growth: number; diet: string; openSlots: number[]; mutations: DinoMutation[] }
/** A use's preview (GET /api/items/preview/<uid>): the dino played now and its four slots. */
export interface PreviewSlot { slot: number; name: string | null; value: string | null; minGrowth: number; open: boolean }
export interface Preview {
  species?: string | null; growth: number | null; prime?: boolean; stacks: number | null; slot2?: boolean;
  slots: PreviewSlot[]; pool?: Array<{ name: string; rarity: string; slot2?: boolean; description?: string }>;
}

export const DIET_VI: Record<string, string> = { carnivore: 'ăn thịt', herbivore: 'ăn cỏ', omnivore: 'ăn tạp' };
export const SLOT_FROM: Record<number, number> = { 1: 25, 2: 50, 3: 75, 4: 75 };

/** The mutations that fit slot n (its diet came from the bridge; slot 2 / 4, female only, not in another slot). */
export function dinoSlotChoices(opts: DinoOptions, female: boolean, muts: Record<number, string>, n: number): DinoMutation[] {
  const taken = new Set(Object.entries(muts).filter(([k, v]) => Number(k) !== n && v).map(([, v]) => v));
  return opts.mutations.filter((m) => (!m.slot2 || n === 2 || n === 4) && (!m.femaleOnly || female) && !taken.has(m.name));
}
/** A pick that no longer fits (the sex changed) is cleared, slot by slot as before React. */
export function fitMuts(opts: DinoOptions, female: boolean, muts: Record<number, string>): Record<number, string> {
  const next = { ...muts };
  for (const n of [1, 2, 3, 4]) if (next[n] && !dinoSlotChoices(opts, female, next, n).some((m) => m.name === next[n])) next[n] = '';
  return next;
}

/** The hòm's roll: any of the prizes, a rarer one beside the prize (a near miss), the prize at LOOT_AT. */
export const LOOT_CARD = 112, LOOT_GAP = 8, LOOT_LEN = 48, LOOT_AT = 42;
export function lootStrip(pool: LootPrize[], won: LootPrize, rnd: () => number = Math.random): LootPrize[] {
  const pick = (): LootPrize => pool[Math.floor(rnd() * pool.length)] ?? won;
  const strip = Array.from({ length: LOOT_LEN }, pick);
  strip[LOOT_AT] = won;
  const order = ['common', 'rare', 'epic', 'legendary', 'special'];
  const rarer = pool.filter((p) => p.itemId !== won.itemId).sort((a, b) => order.indexOf(b.rarity) - order.indexOf(a.rarity))[0];
  if (rarer) strip[LOOT_AT + (rnd() < 0.5 ? -1 : 1)] = rarer;
  return strip;
}
