import { useQuery } from '@tanstack/react-query';
import { getJson } from '@isle/api';

/** GET /api/items (bridge/src/server.ts, items.ts): every item, the rarities, the mutations an item may be. */
export interface Item {
  id: string; type: string; name: string; rarity: string; retired?: boolean; owners: number;
  data: Record<string, any>;
}
export interface Rarity { key: string; label: string; pickable: boolean }
export interface MutationRef {
  name: string; description: string; diet: string; kind: string; unlock: string | null; stat?: string; tiers?: string; status: string; femaleOnly: boolean;
}
export interface ItemsView { items: Item[]; rarities: Rarity[]; mutations: MutationRef[] }
/** GET /api/items/<id>/owners: one row a copy, newest first. */
export interface Owner { steamId: string; name: string | null; source: string; grantedAt: number; note: string | null }

export const ITEMS_URL = '/api/items';
export const SOURCE: Record<string, string> = { admin: 'admin tặng', gacha: 'quay hòm', shop: 'mua', event: 'sự kiện' };

/** The items, read again every 30 s (as the panel before React: not on every 2 s, an editor is open). */
export function useItems() {
  return useQuery({ queryKey: [ITEMS_URL], queryFn: () => getJson<ItemsView>(ITEMS_URL), refetchInterval: 30_000, staleTime: 30_000 });
}

/** The owners of one item, a row a player with how many copies they hold (mutations, tickets). */
export function byPlayer(owners: Owner[]): Array<Owner & { n: number }> {
  const by = new Map<string, Owner & { n: number }>();
  for (const o of owners) { const x = by.get(o.steamId); if (x) x.n += 1; else by.set(o.steamId, { ...o, n: 1 }); }
  return [...by.values()];
}
