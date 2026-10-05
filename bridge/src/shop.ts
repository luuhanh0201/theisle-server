import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';
import { CURRENCY, credit, dayOf } from './economy.js';
import { ITEM_TYPES, type Item, getItem, grantItem, inventoryOf, listItems } from './items.js';
import { findReference } from './mutation-reference.js';

/**
 * The Hổ phách shop (owner, 2026-10-05): items bought with Hổ phách (economy.ts), never with real money.
 * Each listing: an item, its price, how many one player may buy a day (0 = no limit), on or off.
 * Tried by SVip first (svip.ts feature 'shop'); the panel's "Phát hành" opens it to everyone.
 *
 *   data/shop.json        { listings: [{ id, itemId, price, dailyLimit, enabled }] }   in the shop's order
 *   data/shop-buys.json   { days: { <Vietnam day>: { <steamId>: { <listing id>: count } } } }   8 days kept
 *
 * The first read with no shop.json fills it with the owner's suggested prices for the items there
 * (a day's check-in and quests give ~300): the panel changes them.
 */

export interface Listing { id: string; itemId: string; price: number; dailyLimit: number; enabled: boolean }
interface ShopFile { listings: Listing[] }
interface BuysFile { days: Record<string, Record<string, Record<string, number>>> }

export const MAX_QTY = 10;
const MAX_LISTINGS = 200;
const KEEP_DAYS = 8;

const shopPath = (): string => join(config.dataDir, 'shop.json');
const buysPath = (): string => join(config.dataDir, 'shop-buys.json');

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return null; }
}
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, path);
}

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

const newId = (): string => `sh_${randomBytes(4).toString('hex')}`;
/** Items a shop may sell: not the dino item (made by opening a box). */
const sellable = (i: Item): boolean => !ITEM_TYPES.find((t) => t.key === i.type)?.system;

/** The owner's suggested price and daily limit for an item, or null (not put in the shop by itself). */
export function suggested(i: Item): { price: number; dailyLimit: number } | null {
  if (i.retired || !sellable(i) || i.id.startsWith('starter_')) return null;
  switch (i.type) {
    case 'food_box': return i.data.amount >= 0.4 ? { price: 120, dailyLimit: 5 } : { price: 50, dailyLimit: 5 };
    case 'growth_bag': return i.data.amount >= 0.1 ? { price: 300, dailyLimit: 2 } : { price: 150, dailyLimit: 3 };
    case 'salt_lick': return { price: 100, dailyLimit: 3 };
    case 'dino_box': return i.data.pick === 'random' ? { price: 1500, dailyLimit: 1 } : { price: 3000, dailyLimit: 1 };
    case 'prime_ticket': return { price: 2000, dailyLimit: 1 };
    case 'mutation_ticket': return i.data.maxRarity === 'special' ? { price: 2500, dailyLimit: 1 } : { price: 800, dailyLimit: 1 };
    case 'mutation_clear': return { price: 300, dailyLimit: 2 };
    default: return null;
  }
}

/** The listings, in the shop's order (the suggested ones the first time). */
export function readShop(): Promise<Listing[]> {
  return serialized(async () => {
    const file = await readJson<ShopFile>(shopPath());
    if (file !== null && Array.isArray(file.listings)) return file.listings;
    const listings = (await listItems()).flatMap((i) => {
      const s = suggested(i);
      return s === null ? [] : [{ id: newId(), itemId: i.id, ...s, enabled: true }];
    }).sort((a, b) => a.price - b.price);
    await writeJson(shopPath(), { listings });
    return listings;
  });
}

const whole = (v: unknown, lo: number, hi: number, what: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new ValidationError(`${what} phải là số nguyên ${lo}–${hi}`);
  return v;
};

/** The panel's list, checked: items that exist and may be sold, a price, a daily limit, on or off. */
export async function saveShop(raw: unknown): Promise<Listing[]> {
  const list = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['listings'] : undefined;
  if (!Array.isArray(list) || list.length > MAX_LISTINGS) throw new ValidationError(`listings: tối đa ${MAX_LISTINGS} món`);
  const items = new Map((await listItems()).map((i) => [i.id, i]));
  const seen = new Set<string>();
  const listings = list.map((r, n): Listing => {
    const o = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>;
    const itemId = typeof o['itemId'] === 'string' ? o['itemId'] : '';
    const item = items.get(itemId);
    if (item === undefined) throw new ValidationError(`Dòng ${n + 1}: không có vật phẩm "${itemId}"`);
    if (!sellable(item)) throw new ValidationError(`Dòng ${n + 1}: ${item.name} không bán được (chỉ có khi mở hộp)`);
    let id = typeof o['id'] === 'string' && /^sh_[0-9a-f]{8}$/.test(o['id']) ? o['id'] : newId();
    while (seen.has(id)) id = newId();
    seen.add(id);
    if (o['enabled'] !== undefined && typeof o['enabled'] !== 'boolean') throw new ValidationError(`Dòng ${n + 1}: enabled phải là true / false`);
    return { id, itemId, price: whole(o['price'], 1, 1_000_000, `Dòng ${n + 1}: giá`),
      dailyLimit: whole(o['dailyLimit'] ?? 0, 0, 100, `Dòng ${n + 1}: giới hạn / ngày`), enabled: o['enabled'] !== false };
  });
  return serialized(async () => { await writeJson(shopPath(), { listings }); return listings; });
}

async function readBuys(): Promise<BuysFile> {
  const f = await readJson<BuysFile>(buysPath());
  return f !== null && typeof f.days === 'object' && f.days !== null ? f : { days: {} };
}

/** What a player sees: each listing on sale with its item, the price, how many they may still buy today. */
export async function shopView(steamId: string, now = Math.floor(Date.now() / 1000)) {
  const [listings, items, buys, owned] = await Promise.all([readShop(), listItems(), readBuys(), inventoryOf(steamId)]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const today = buys.days[String(dayOf(now))]?.[steamId] ?? {};
  return listings.flatMap((l) => {
    const item = byId.get(l.itemId);
    if (!l.enabled || item === undefined || item.retired || !sellable(item)) return [];
    const bought = today[l.id] ?? 0;
    const unique = ITEM_TYPES.find((t) => t.key === item.type)?.unique === true;
    const ownedAlready = unique && owned.some((o) => o.itemId === item.id);
    return [{ id: l.id, price: l.price, dailyLimit: l.dailyLimit, bought, left: l.dailyLimit === 0 ? null : Math.max(0, l.dailyLimit - bought),
      ...(ownedAlready ? { owned: true } : {}), item: { id: item.id, type: item.type, name: item.name, rarity: item.rarity, data: item.data,
        ...(item.type === 'mutation' ? { description: findReference(item.data.mutation)?.description ?? null } : {}) } }];
  });
}

/**
 * Buy `qty` of a listing: the Hổ phách taken first (refused when short, economy.ts never below 0), then
 * the copies given (source "shop"); a copy that cannot be given is paid back. One buy at a time.
 */
export function buy(steamId: string, listingId: unknown, qtyRaw: unknown, now = Math.floor(Date.now() / 1000),
): Promise<{ item: string; qty: number; spent: number; balance: number; left: number | null }> {
  return serialized(async () => {
    const qty = whole(qtyRaw ?? 1, 1, MAX_QTY, 'Số lượng');
    const file = await readJson<ShopFile>(shopPath());
    const listing = (file?.listings ?? []).find((l) => l.id === listingId);
    if (listing === undefined || !listing.enabled) throw new ValidationError('Món này không còn bán.');
    const item = await getItem(listing.itemId);
    if (item === null || item.retired || !sellable(item)) throw new ValidationError('Món này không còn bán.');
    const unique = ITEM_TYPES.find((t) => t.key === item.type)?.unique === true;
    if (unique && (qty > 1 || (await inventoryOf(steamId)).some((o) => o.itemId === item.id))) throw new ValidationError(`Bạn đã có ${item.name} (mỗi người 1 cái).`);
    const buys = await readBuys();
    const day = String(dayOf(now));
    const mine = ((buys.days[day] ??= {})[steamId] ??= {});
    const bought = mine[listing.id] ?? 0;
    if (listing.dailyLimit > 0 && bought + qty > listing.dailyLimit) {
      throw new ValidationError(`Mỗi ngày mua tối đa ${listing.dailyLimit} ${item.name}; hôm nay bạn còn mua được ${Math.max(0, listing.dailyLimit - bought)}.`);
    }
    const cost = listing.price * qty;
    let line;
    try {
      line = await credit(steamId, -cost, `Mua ${qty} × ${item.name}`, null, now);
    } catch (err) {
      if (err instanceof ValidationError && /không đủ/.test(err.message)) throw new ValidationError(`Không đủ ${CURRENCY}: cần ${cost.toLocaleString('vi-VN')}.`);
      throw err;
    }
    let given = 0;
    let failed: unknown = null;
    try {
      for (; given < qty; given++) await grantItem(steamId, item.id, 'shop', null, `Mua ở cửa hàng (${listing.price.toLocaleString('vi-VN')} ${CURRENCY})`);
    } catch (err) {
      failed = err;
    }
    if (given < qty) line = await credit(steamId, listing.price * (qty - given), `Hoàn tiền: ${qty - given} × ${item.name} không giao được`, null, now);
    if (given === 0) {
      console.error('[shop] nothing given, paid back:', failed);
      throw new ValidationError('Không giao được vật phẩm, đã hoàn tiền.');
    }
    mine[listing.id] = bought + given;
    for (const d of Object.keys(buys.days)) if (Number(d) < Number(day) - KEEP_DAYS) delete buys.days[d];
    await writeJson(buysPath(), buys);
    return { item: item.name, qty: given, spent: listing.price * given, balance: line.balance,
      left: listing.dailyLimit === 0 ? null : listing.dailyLimit - bought - given };
  });
}
