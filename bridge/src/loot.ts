import { ValidationError } from './garage.js';
import { ITEM_TYPES, type Item, type LootEntry, getItem, inventoryOf, isPendingUse, listItems, swapOwned } from './items.js';
import { findReference } from './mutation-reference.js';

/**
 * Hòm (owner, 2026-10-05, "Hòm cổ đại"): opened, one prize drawn among the admin's list by weight and
 * put in the bag; the hòm gone (an admin's bag keeps it). What a player may draw: the list without the
 * items gone from the server (deleted, retired) and without one they may own once and own already (a
 * skin). The draw is the bridge's; the web only shows it, with its roll.
 *
 * The chances are the admin's only (owner, 2026-10-05: "người chơi không được xem tỉ lệ"): nothing sent
 * to a player carries a weight or a chance (PlayerPrize); the browser sends the hòm's uid and nothing
 * else, so a changed page (F12) cannot pick or see the odds. The audit line keeps the chance.
 */

/** One prize as the web shows it: the item, how many, its chance now (0–1). */
export interface LootPrize {
  itemId: string; name: string; type: Item['type']; rarity: Item['rarity']; qty: number; chance: number;
  /** For its card: the mutation's name and Vietnamese description, a skin's species. */
  mutation?: string; description?: string | null; species?: string;
}

async function lootBoxOf(steamId: string, uid: string): Promise<{ item: Extract<Item, { type: 'loot_box' }> }> {
  const owned = (await inventoryOf(steamId)).find((o) => o.uid === uid);
  if (owned === undefined) throw new ValidationError('Bạn không có hòm này (hoặc đã mở).');
  if (isPendingUse(steamId, uid)) throw new ValidationError('Hòm này đang được dùng.');
  const item = await getItem(owned.itemId);
  if (item === null || item.type !== 'loot_box') throw new ValidationError('Đây không phải hòm.');
  return { item };
}

/** What this player may draw from this hòm, with each prize's chance. */
export async function lootPool(steamId: string, box: Extract<Item, { type: 'loot_box' }>): Promise<Array<LootPrize & { weight: number }>> {
  const [items, owned] = await Promise.all([listItems(), inventoryOf(steamId)]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const have = new Set(owned.map((o) => o.itemId));
  const open = box.data.pool.flatMap((e: LootEntry) => {
    const it = byId.get(e.itemId);
    if (it === undefined || it.retired || ITEM_TYPES.find((t) => t.key === it.type)?.system) return [];
    if (ITEM_TYPES.find((t) => t.key === it.type)?.unique && have.has(it.id)) return [];
    return [{ entry: e, it }];
  });
  const sum = open.reduce((n, x) => n + x.entry.weight, 0);
  return open.map(({ entry, it }) => ({
    itemId: it.id, name: it.name, type: it.type, rarity: it.rarity, qty: entry.qty, weight: entry.weight, chance: sum > 0 ? entry.weight / sum : 0,
    ...(it.type === 'mutation' ? { mutation: it.data.mutation, description: findReference(it.data.mutation)?.description ?? null } : {}),
    ...(it.type === 'skin' ? { species: it.data.species } : {}),
  }));
}

/** A prize as a player may see it: no weight, no chance. */
export type PlayerPrize = Omit<LootPrize, 'chance'>;
const forPlayer = ({ itemId, name, type, rarity, qty, mutation, description, species }: LootPrize): PlayerPrize =>
  ({ itemId, name, type, rarity, qty, ...(mutation !== undefined ? { mutation } : {}), ...(description !== undefined ? { description } : {}), ...(species !== undefined ? { species } : {}) });

/** What the hòm may give, for the web's box before opening: the prizes, never their chances. */
export async function lootOptions(steamId: string, uid: string): Promise<{ name: string; rarity: Item['rarity']; pool: PlayerPrize[] }> {
  const { item } = await lootBoxOf(steamId, uid);
  return { name: item.name, rarity: item.rarity, pool: (await lootPool(steamId, item)).map(forPlayer) };
}

/** Open a hòm: a prize drawn by weight (`random` for the tests), the swap in one write. */
export async function openLootBox(steamId: string, uid: string, keepBox = false, random: () => number = Math.random,
): Promise<{ won: PlayerPrize; box: string; chance: number }> {
  const { item } = await lootBoxOf(steamId, uid);
  const pool = await lootPool(steamId, item);
  const sum = pool.reduce((n, p) => n + p.weight, 0);
  if (pool.length === 0 || sum <= 0) throw new ValidationError('Hòm này chưa có gì để mở (hoặc bạn đã có hết). Hòm vẫn còn.');
  let r = random() * sum;
  let won = pool[pool.length - 1] as (typeof pool)[number];
  for (const p of pool) { if (r < p.weight) { won = p; break; } r -= p.weight; }
  const out = await swapOwned(steamId, uid, won.itemId, won.qty, `Mở từ ${item.name}`, keepBox);
  if (out === null) throw new ValidationError('Hòm đã được mở.');
  // The chance for the audit (player-api.ts sends `won` and `box` only).
  return { won: forPlayer(won), box: item.name, chance: won.chance };
}
