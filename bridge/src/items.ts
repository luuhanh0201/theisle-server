import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { NEAR_BLACK, SKIN_CHANNEL_MAX, SKIN_REGIONS, type SkinRequest } from './commands.js';
import { ValidationError } from './garage.js';
import { findReference, type Diet } from './mutation-reference.js';

/**
 * The server's items (panel → Vật phẩm): things an admin makes and gives to
 * players, kept in each player's inventory. One kind for now, the skin:
 * colours, how bright or dark each region is, pattern, theme, saved under a
 * name for one species, worn by its owner on a dino of that species. A new
 * kind (a growth boost, a garage slot…) is a new `type` with its own `data`;
 * how an item reached a player is its `source`, so a loot box or a shop only
 * adds a source.
 *
 *   data/items.json            { items: { <id>: Item } }
 *   data/item-inventory.json   { players: { <steamId>: Owned[] } }
 *
 * Skin colours are the game's LINEAR values. `colors` are what the admin
 * picked (0–1); `light` (per region) and `brightness` (the whole dino) multiply
 * them: below 1 darker, above 1 brighter than any colour a player can pick
 * ("glow", channels up to SKIN_CHANNEL_MAX). Never exactly 0: the game reads
 * (0, 0, 0) as a region the species does not use.
 */

export type ItemType = 'skin' | 'mutation' | 'mutation_ticket' | 'mutation_clear' | 'prime_ticket'
  | 'dino_box' | 'dino' | 'growth_bag' | 'food_box' | 'salt_lick';
export const ITEM_TYPES: ReadonlyArray<{ key: ItemType; label: string; unique: boolean; system?: boolean }> = [
  // unique: a player owns it once (a skin); a kind used up (a mutation…) may be owned several times.
  { key: 'skin', label: 'Skin dino', unique: true },
  { key: 'mutation', label: 'Mutation', unique: false },
  // The tickets (2026-10-02): to put right a mutation forgotten or a prime missed.
  { key: 'mutation_ticket', label: 'Phiếu đổi mutation', unique: false },
  { key: 'mutation_clear', label: 'Phiếu bỏ mutation', unique: false },
  { key: 'prime_ticket', label: 'Phiếu Prime', unique: false },
  // Owner, 2026-10-05 (dino-box.ts): a box opens into a dino (its species and growth drawn, or the
  // species picked, there and then); the dino, used, goes into the garage with the mutations picked.
  { key: 'dino_box', label: 'Hộp dino', unique: false },
  // system: only made by opening a box (each copy carries its own species and growth, Owned.dino).
  { key: 'dino', label: 'Dino', unique: false, system: true },
  // Used on the dino played now (mods/DinoGarage garage/admin.lua): growth, food.
  { key: 'growth_bag', label: 'Túi tăng trưởng', unique: false },
  { key: 'food_box', label: 'Hộp food', unique: false },
  // Đá muối: the sickness after vomiting cleared (ResetVomitSickState).
  { key: 'salt_lick', label: 'Đá muối', unique: false },
];

/**
 * A ticket's own data. mutation_ticket: the player picks the mutation when
 * using it (their species' diet), among the mutations whose item on the
 * Mutation page is no rarer than `maxRarity` (special = quest mutations too).
 * mutation_clear and prime_ticket carry nothing.
 */
export interface TicketData { maxRarity: Rarity }
/**
 * A dino box (dino-box.ts): opened, a dino item, its species drawn (`random`) or picked (`choose`),
 * its growth drawn between growthMin and growthMax. `quest`: the dino may take quest mutations too.
 * (Before 2026-10-05 the "Phiếu chọn dino", type dino_ticket: read as a `choose` box.)
 */
export interface DinoBoxData { pick: 'random' | 'choose'; growthMin: number; growthMax: number; quest: boolean }
export const DINO_BOX_DEFAULT: DinoBoxData = { pick: 'choose', growthMin: 0.5, growthMax: 1, quest: false };
/** Growth bag: +amount on the dino played now, if it is below `below` (owner: +10 % under 60 %, 55 % → 65 %). */
export interface GrowthBagData { amount: number; below: number }
export const GROWTH_BAG_DEFAULT: GrowthBagData = { amount: 0.1, below: 0.6 };
/** Food box: the food bar +amount of its max on the dino played now, food only, no nutrients. */
export interface FoodBoxData { amount: number }
export const FOOD_BOX_DEFAULT: FoodBoxData = { amount: 0.2 };
/** What one dino item (a box opened) is: the species key ("tyrannosaurus"), its growth, quest mutations or not. */
export interface OwnedDino { species: string; growth: number; quest: boolean }
export type EmptyData = Record<string, never>;

/**
 * A mutation item: used on the dino the player plays now, into one of its four
 * slots (mods/DinoGarage garage/mutation.lua), then gone. Its diet is the
 * mutation's own (mutation-reference.ts). Its strength follows the dino's
 * generation (ElderReplicationStacks), not the slot or a second copy.
 */
export interface MutationData {
  /** The in-game name ("Cellular Regeneration"). */
  mutation: string;
  diet: Diet;
  /** Only on slots 2 and 4 (mutation-reference kind "slot2"). */
  slot2: boolean;
  /** Quest-gated in game: unlocked by the mod before it goes in a slot. */
  unlock: boolean;
}

/** What each playable species eats (who may use a carnivore / herbivore mutation). */
export const SPECIES_DIET: Readonly<Record<string, 'carnivore' | 'herbivore' | 'omnivore'>> = {
  allosaurus: 'carnivore', austroraptor: 'carnivore', carnotaurus: 'carnivore', ceratosaurus: 'carnivore',
  deinosuchus: 'carnivore', dilophosaurus: 'carnivore', herrerasaurus: 'carnivore', omniraptor: 'carnivore',
  pteranodon: 'carnivore', troodon: 'carnivore', tyrannosaurus: 'carnivore',
  diabloceratops: 'herbivore', dryosaurus: 'herbivore', hypsilophodon: 'herbivore', kentrosaurus: 'herbivore',
  maiasaura: 'herbivore', stegosaurus: 'herbivore', tenontosaurus: 'herbivore', triceratops: 'herbivore',
  beipiaosaurus: 'omnivore', gallimimus: 'omnivore', pachycephalosaurus: 'omnivore',
};

/** May a dino of this species take a mutation of this diet? Null: yes; else why not. */
export function dietRefusal(species: string | null | undefined, diet: Diet): string | null {
  if (diet === 'all') return null;
  const own = SPECIES_DIET[speciesKey(species)];
  if (own === undefined) return 'không rõ loài này ăn gì';
  const ok = diet === own || (diet === 'herbivore_omnivore' && (own === 'herbivore' || own === 'omnivore'));
  const words: Record<Diet, string> = { all: 'mọi loài', carnivore: 'loài ăn thịt', herbivore: 'loài ăn cỏ', herbivore_omnivore: 'loài ăn cỏ / ăn tạp' };
  return ok ? null : `mutation này chỉ dành cho ${words[diet]}`;
}

/**
 * How rare an item is; each has its own look on the panel and the portal.
 * An admin picks common…legendary; `special` is a quest mutation's (kind
 * "unlock": earned by a task in game) and only theirs, fixed, not picked.
 */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'special';
export const RARITIES: ReadonlyArray<{ key: Rarity; label: string; pickable: boolean }> = [
  { key: 'common', label: 'Thường', pickable: true }, { key: 'rare', label: 'Hiếm', pickable: true },
  { key: 'epic', label: 'Sử thi', pickable: true }, { key: 'legendary', label: 'Huyền thoại', pickable: true },
  { key: 'special', label: 'Đặc biệt', pickable: false },
];
/** A quest mutation is always special; nothing else is (an item saved before the rule is read so too). */
function withRarity(raw: Item): Item {
  const item = legacy(raw);
  if (item.type === 'mutation_ticket') return item.rarity === item.data.maxRarity ? item : { ...item, rarity: item.data.maxRarity };
  const quest = item.type === 'mutation' && item.data.unlock;
  if (quest) return item.rarity === 'special' ? item : { ...item, rarity: 'special' };
  return item.rarity === 'special' ? { ...item, rarity: 'legendary' } : item;
}
/** An item saved under a type since renamed: the dino ticket is a box the player picks the species of. */
function legacy(item: Item): Item {
  const was = item as unknown as { type: string; data: Record<string, unknown> };
  if (was.type !== 'dino_ticket') return item;
  return { ...item, type: 'dino_box', data: { ...DINO_BOX_DEFAULT, ...was.data, pick: 'choose' } } as Item;
}
/** Rarities from the most common up (a ticket's maxRarity compares on this). */
export const RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary', 'special'];
/** How an item reached a player: an admin now; a loot box, a shop, an event later. */
export type ItemSource = 'admin' | 'gacha' | 'shop' | 'event';

export type Region = (typeof SKIN_REGIONS)[number];
export interface Rgb { r: number; g: number; b: number }

/** Darkest / brightest a region (or the whole dino) may be made: × LIGHT_MIN … × LIGHT_MAX. */
export const LIGHT_MIN = 0.05;
export const LIGHT_MAX = 4;

export interface SkinData {
  /** The species it is made for: the short class name ("Carnotaurus"). */
  species: string;
  colors: Partial<Record<Region, Rgb>>;
  light: Partial<Record<Region, number>>;
  brightness: number;
  pattern: number | null;
  theme: number | null;
  variation: number | null;
}

interface ItemBase {
  id: string;
  name: string;
  rarity: Rarity;
  /** Retired: no longer given out; players who have it keep it. */
  retired: boolean;
  createdAt: number;
  createdBy: string | null;
  updatedAt: number;
}
type TypedData =
  | { type: 'skin'; data: SkinData }
  | { type: 'mutation'; data: MutationData }
  | { type: 'mutation_ticket'; data: TicketData }
  | { type: 'mutation_clear'; data: EmptyData }
  | { type: 'prime_ticket'; data: EmptyData }
  | { type: 'dino_box'; data: DinoBoxData }
  | { type: 'dino'; data: EmptyData }
  | { type: 'growth_bag'; data: GrowthBagData }
  | { type: 'food_box'; data: FoodBoxData }
  | { type: 'salt_lick'; data: EmptyData };
export type Item = ItemBase & TypedData;
type ItemDef = Pick<ItemBase, 'name' | 'rarity'> & TypedData;

export interface Owned {
  /** This one copy (a kind used up later removes it by this). */
  uid: string;
  itemId: string;
  source: ItemSource;
  grantedAt: number;
  /** Who gave it (an admin's SteamID), or null (a script, a loot box). */
  by: string | null;
  note: string | null;
  /** A dino item's own species and growth (only those). */
  dino?: OwnedDino;
}

interface ItemsFile { items: Record<string, Item> }
interface InventoryFile { players: Record<string, Owned[]> }

const itemsPath = (): string => join(config.dataDir, 'items.json');
const inventoryPath = (): string => join(config.dataDir, 'item-inventory.json');

async function readJson<T>(path: string, empty: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return empty; }
}
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, path);
}

// One change at a time: two admins saving at once must not lose one of them.
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

const newId = (prefix: string): string => `${prefix}_${randomBytes(4).toString('hex')}`;
const isRegion = (k: string): k is Region => (SKIN_REGIONS as readonly string[]).includes(k);
const round = (v: number, step = 10000): number => Math.round(v * step) / step;

// --- checking what the panel sends --------------------------------------------------------

function factor(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < LIGHT_MIN || v > LIGHT_MAX) {
    throw new ValidationError(`${what} must be ${LIGHT_MIN}–${LIGHT_MAX}`);
  }
  return round(v, 1000);
}

/** A skin's own data, checked. */
export function validateSkinData(raw: unknown): SkinData {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('data must be an object');
  const r = raw as Record<string, unknown>;
  const species = typeof r['species'] === 'string' ? r['species'].trim().replace(/^BP_/, '').replace(/_C$/, '') : '';
  if (!/^[A-Za-z][A-Za-z0-9]{1,40}$/.test(species)) throw new ValidationError('species is required (e.g. Carnotaurus)');

  const colorsRaw = r['colors'];
  if (typeof colorsRaw !== 'object' || colorsRaw === null || Array.isArray(colorsRaw)) throw new ValidationError('colors must be an object');
  const colors: SkinData['colors'] = {};
  for (const [k, v] of Object.entries(colorsRaw as Record<string, unknown>)) {
    if (!isRegion(k)) throw new ValidationError(`unknown region "${k}"`);
    const c = v as Record<string, unknown> | null;
    const ok = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
    if (typeof c !== 'object' || c === null || !ok(c['r']) || !ok(c['g']) || !ok(c['b'])) throw new ValidationError(`${k}: r, g, b must be 0–1`);
    colors[k] = { r: round(c['r']), g: round(c['g']), b: round(c['b']) };
  }
  if (Object.keys(colors).length === 0) throw new ValidationError('at least one colour');

  const light: SkinData['light'] = {};
  const lightRaw = r['light'];
  if (lightRaw !== undefined && lightRaw !== null) {
    if (typeof lightRaw !== 'object' || Array.isArray(lightRaw)) throw new ValidationError('light must be an object');
    for (const [k, v] of Object.entries(lightRaw as Record<string, unknown>)) {
      if (!isRegion(k)) throw new ValidationError(`unknown region "${k}"`);
      const f = factor(v, `light ${k}`);
      if (f !== 1) light[k] = f;
    }
  }
  const brightness = r['brightness'] === undefined ? 1 : factor(r['brightness'], 'brightness');
  const whole = (k: string, max: number): number | null => {
    const v = r[k];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) throw new ValidationError(`${k} must be a whole number 0–${max}`);
    return v;
  };
  const variation = r['variation'];
  if (variation !== undefined && variation !== null && (typeof variation !== 'number' || !Number.isFinite(variation) || variation < 0 || variation > 100)) {
    throw new ValidationError('variation must be 0–100');
  }
  return { species, colors, light, brightness, pattern: whole('pattern', 20), theme: whole('theme', 20), variation: typeof variation === 'number' ? variation : null };
}

/** A mutation item's data, checked: a mutation the reference knows (its diet and slot rules come from there). */
export function validateMutationData(raw: unknown): MutationData {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('data must be an object');
  const name = (raw as Record<string, unknown>)['mutation'];
  if (typeof name !== 'string' || name.trim() === '') throw new ValidationError('mutation is required');
  const ref = findReference(name.trim());
  if (ref === null) throw new ValidationError(`unknown mutation "${name}"`);
  if (ref.status === 'removed') throw new ValidationError(`${ref.name} is no longer in the game`);
  return { mutation: ref.name, diet: ref.diet, slot2: ref.kind === 'slot2', unlock: ref.kind === 'unlock' };
}

/** A dino box's data, checked: drawn or picked species, growth 25–100 % (min ≤ max), quest mutations or not. */
export function validateDinoBoxData(raw: unknown): DinoBoxData {
  const d = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const g = (v: unknown, def: number, what: string): number => {
    if (v === undefined) return def;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0.25 || v > 1) throw new ValidationError(`${what} must be 0.25–1`);
    return Math.round(v * 100) / 100;
  };
  const pick = d['pick'] ?? DINO_BOX_DEFAULT.pick;
  if (pick !== 'random' && pick !== 'choose') throw new ValidationError('pick must be random or choose');
  const growthMin = g(d['growthMin'], DINO_BOX_DEFAULT.growthMin, 'growthMin');
  const growthMax = g(d['growthMax'], DINO_BOX_DEFAULT.growthMax, 'growthMax');
  if (growthMin > growthMax) throw new ValidationError('growthMin must not be above growthMax');
  if (d['quest'] !== undefined && typeof d['quest'] !== 'boolean') throw new ValidationError('quest must be true or false');
  return { pick, growthMin, growthMax, quest: d['quest'] === true };
}

/** A share (0–1) in steps of 1 %, between lo and hi, or its default. */
function share(v: unknown, def: number, lo: number, hi: number, what: string): number {
  if (v === undefined) return def;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new ValidationError(`${what} must be ${lo}–${hi}`);
  return Math.round(v * 100) / 100;
}
export function validateGrowthBagData(raw: unknown): GrowthBagData {
  const d = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return { amount: share(d['amount'], GROWTH_BAG_DEFAULT.amount, 0.01, 0.5, 'amount'), below: share(d['below'], GROWTH_BAG_DEFAULT.below, 0.1, 1, 'below') };
}
export function validateFoodBoxData(raw: unknown): FoodBoxData {
  const d = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return { amount: share(d['amount'], FOOD_BOX_DEFAULT.amount, 0.01, 1, 'amount') };
}

/** The editable part of an item, checked: { type, name, rarity, data, retired? }. */
export function validateItem(raw: unknown): ItemDef & { retired?: boolean } {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('item must be an object');
  const r = raw as Record<string, unknown>;
  const type = r['type'] === 'dino_ticket' ? 'dino_box' : r['type'] ?? 'skin';
  if (!ITEM_TYPES.some((t) => t.key === type)) throw new ValidationError('unknown item type');
  const name = typeof r['name'] === 'string' ? r['name'].trim() : '';
  if (name.length < 1 || name.length > 60) throw new ValidationError('name must be 1–60 characters');
  const rarity = r['rarity'] ?? 'common';
  if (!RARITIES.some((x) => x.key === rarity)) throw new ValidationError('rarity must be common, rare, epic, legendary or special');
  const retired = r['retired'];
  if (retired !== undefined && typeof retired !== 'boolean') throw new ValidationError('retired must be true or false');
  const extra = typeof retired === 'boolean' ? { retired } : {};
  if (type === 'mutation') {
    const data = validateMutationData(r['data']);
    // A quest mutation is special whatever was sent; special is theirs only.
    if (!data.unlock && rarity === 'special') throw new ValidationError('Đặc biệt chỉ dành cho mutation nhiệm vụ');
    return { type, name, rarity: data.unlock ? 'special' : rarity as Rarity, data, ...extra };
  }
  if (type === 'mutation_ticket') {
    const d = r['data'];
    const maxRarity = typeof d === 'object' && d !== null ? (d as Record<string, unknown>)['maxRarity'] : undefined;
    if (!RARITY_ORDER.includes(maxRarity as Rarity)) throw new ValidationError('maxRarity must be common, rare, epic, legendary or special');
    // The ticket shows the rarity it can reach.
    return { type, name, rarity: maxRarity as Rarity, data: { maxRarity: maxRarity as Rarity }, ...extra };
  }
  if (rarity === 'special') throw new ValidationError('Đặc biệt chỉ dành cho mutation nhiệm vụ');
  if (type === 'mutation_clear' || type === 'prime_ticket' || type === 'salt_lick') return { type, name, rarity: rarity as Rarity, data: {}, ...extra };
  if (type === 'dino_box') return { type, name, rarity: rarity as Rarity, data: validateDinoBoxData(r['data']), ...extra };
  if (type === 'dino') return { type, name, rarity: rarity as Rarity, data: {}, ...extra };
  if (type === 'growth_bag') return { type, name, rarity: rarity as Rarity, data: validateGrowthBagData(r['data']), ...extra };
  if (type === 'food_box') return { type, name, rarity: rarity as Rarity, data: validateFoodBoxData(r['data']), ...extra };
  return { type: 'skin', name, rarity: rarity as Rarity, data: validateSkinData(r['data']), ...extra };
}

/** What the game gets for a skin: each colour × its region's light × the brightness, 0 never, SKIN_CHANNEL_MAX at most. */
export function resolveSkin(skin: SkinData): SkinRequest {
  const colors: SkinRequest['colors'] = {};
  for (const [k, c] of Object.entries(skin.colors) as Array<[Region, Rgb]>) {
    const f = (skin.light[k] ?? 1) * skin.brightness;
    const ch = (v: number): number => Math.min(SKIN_CHANNEL_MAX, Math.max(NEAR_BLACK, round(v * f)));
    colors[k] = { r: ch(c.r), g: ch(c.g), b: ch(c.b) };
  }
  // Colours only (2026-10-02, the owner's call): the dino keeps the pattern / theme / variation its
  // player chose in game, a skin item's own (older items have some) is not sent.
  return { colors };
}

/** "BP_Carnotaurus_C" / "Carnotaurus" → "carnotaurus", to compare a dino with a skin's species. */
export const speciesKey = (raw: string | null | undefined): string =>
  String(raw ?? '').split('.').pop()?.replace(/^BP_/, '').replace(/_C$/, '').toLowerCase() ?? '';

// --- the items ------------------------------------------------------------------------------

export async function listItems(): Promise<Item[]> {
  const file = await readJson<ItemsFile>(itemsPath(), { items: {} });
  const group = (i: Item): string => (i.type === 'skin' ? i.data.species : i.type === 'mutation' ? i.data.mutation : '');
  return Object.values(file.items ?? {}).map(withRarity).sort((a, b) => a.type.localeCompare(b.type)
    || group(a).localeCompare(group(b)) || a.name.localeCompare(b.name));
}

export async function getItem(id: string): Promise<Item | null> {
  const file = await readJson<ItemsFile>(itemsPath(), { items: {} });
  const item = file.items?.[id];
  return item === undefined ? null : withRarity(item);
}

export function createItem(raw: unknown, by: string | null): Promise<Item> {
  const def = validateItem(raw);
  if (ITEM_TYPES.find((t) => t.key === def.type)?.system) return Promise.reject(new ValidationError('loại vật phẩm này do hệ thống tạo (mở hộp dino)'));
  return serialized(async () => {
    const file = await readJson<ItemsFile>(itemsPath(), { items: {} });
    file.items ??= {};
    let id: string;
    do { id = newId('it'); } while (file.items[id] !== undefined);
    const now = Math.floor(Date.now() / 1000);
    const item = { id, type: def.type, name: def.name, rarity: def.rarity, retired: def.retired ?? false, data: def.data,
      createdAt: now, createdBy: by, updatedAt: now } as Item;
    file.items[id] = item;
    await writeJson(itemsPath(), file);
    return item;
  });
}

/** An item kept under a fixed id (the starter box, the dino item): made once when missing, else left as the admin set it. */
export function ensureItem(id: string, raw: unknown): Promise<Item> {
  if (!/^[\w-]{1,40}$/.test(id)) return Promise.reject(new ValidationError('bad item id'));
  const def = validateItem(raw);
  return serialized(async () => {
    const file = await readJson<ItemsFile>(itemsPath(), { items: {} });
    file.items ??= {};
    const had = file.items[id];
    if (had !== undefined) return withRarity(had);
    const now = Math.floor(Date.now() / 1000);
    const item = { id, type: def.type, name: def.name, rarity: def.rarity, retired: false, data: def.data,
      createdAt: now, createdBy: null, updatedAt: now } as Item;
    file.items[id] = item;
    await writeJson(itemsPath(), file);
    return item;
  });
}

/** Replace what an admin edits (its type stays). */
export function updateItem(id: string, raw: unknown): Promise<{ before: Item; after: Item }> {
  const def = validateItem(raw);
  return serialized(async () => {
    const file = await readJson<ItemsFile>(itemsPath(), { items: {} });
    const had = file.items?.[id];
    if (had === undefined) throw new ValidationError('no such item');
    const before = legacy(had);
    if (def.type !== before.type) throw new ValidationError('an item keeps its type');
    const after = { ...before, name: def.name, rarity: def.rarity, data: def.data,
      retired: def.retired ?? before.retired, updatedAt: Math.floor(Date.now() / 1000) } as Item;
    file.items[id] = after;
    await writeJson(itemsPath(), file);
    return { before, after };
  });
}

// --- players' inventories ------------------------------------------------------------------------

export async function inventoryOf(steamId: string): Promise<Owned[]> {
  const file = await readJson<InventoryFile>(inventoryPath(), { players: {} });
  return [...(file.players?.[steamId] ?? [])];
}

/** Every owner of one item. */
export async function ownersOf(itemId: string): Promise<Array<Owned & { steamId: string }>> {
  const file = await readJson<InventoryFile>(inventoryPath(), { players: {} });
  const out: Array<Owned & { steamId: string }> = [];
  for (const [steamId, list] of Object.entries(file.players ?? {})) {
    for (const o of list) if (o.itemId === itemId) out.push({ ...o, steamId });
  }
  return out.sort((a, b) => b.grantedAt - a.grantedAt);
}

/** How many copies of each item players hold. */
export async function ownerCounts(): Promise<Record<string, number>> {
  const file = await readJson<InventoryFile>(inventoryPath(), { players: {} });
  const out: Record<string, number> = {};
  for (const list of Object.values(file.players ?? {})) for (const o of list) out[o.itemId] = (out[o.itemId] ?? 0) + 1;
  return out;
}

/** Give an item to a player (a unique kind, like a skin, once). */
export function grantItem(steamId: string, itemId: string, source: ItemSource, by: string | null, note: unknown = null): Promise<Owned> {
  if (!/^\d{17}$/.test(steamId)) return Promise.reject(new ValidationError('steamId must be a SteamID64'));
  const cleanNote = typeof note === 'string' && note.trim() !== '' ? note.trim().slice(0, 200) : null;
  return serialized(async () => {
    const item = await getItem(itemId);
    if (item === null) throw new ValidationError('no such item');
    if (item.retired && source === 'admin') throw new ValidationError('vật phẩm này đã ngừng phát hành');
    if (item.type === 'dino') throw new ValidationError('vật phẩm dino chỉ có khi mở hộp dino, hãy tặng hộp dino');
    const file = await readJson<InventoryFile>(inventoryPath(), { players: {} });
    file.players ??= {};
    const list = file.players[steamId] ?? [];
    const unique = ITEM_TYPES.find((t) => t.key === item.type)?.unique ?? true;
    if (unique && list.some((o) => o.itemId === itemId)) throw new ValidationError('người chơi đã có vật phẩm này');
    const owned: Owned = { uid: newId('own'), itemId, source, grantedAt: Math.floor(Date.now() / 1000), by, note: cleanNote };
    file.players[steamId] = [...list, owned];
    await writeJson(inventoryPath(), file);
    return owned;
  });
}

/** An item gone from the catalog and from every inventory (no undo: the caller backs the files up). */
export function deleteItem(id: string): Promise<{ item: Item; copies: number } | null> {
  return serialized(async () => {
    const file = await readJson<ItemsFile>(itemsPath(), { items: {} });
    const item = file.items?.[id];
    if (item === undefined) return null;
    delete file.items[id];
    const inv = await readJson<InventoryFile>(inventoryPath(), { players: {} });
    let copies = 0;
    for (const [steamId, list] of Object.entries(inv.players ?? {})) {
      const kept = list.filter((o) => o.itemId !== id);
      copies += list.length - kept.length;
      if (kept.length === 0) delete inv.players[steamId]; else inv.players[steamId] = kept;
    }
    await writeJson(inventoryPath(), inv);
    await writeJson(itemsPath(), file);
    return { item, copies };
  });
}

/** Take every copy of an item back from a player. */
export function revokeItem(steamId: string, itemId: string): Promise<boolean> {
  return serialized(async () => {
    const file = await readJson<InventoryFile>(inventoryPath(), { players: {} });
    const list = file.players?.[steamId] ?? [];
    const kept = list.filter((o) => o.itemId !== itemId);
    if (kept.length === list.length) return false;
    if (kept.length === 0) delete file.players[steamId];
    else file.players[steamId] = kept;
    await writeJson(inventoryPath(), file);
    return true;
  });
}

/** Take one copy (by its uid) out of a player's inventory, a used mutation. False when it is not there. */
export function consumeOwned(steamId: string, uid: string): Promise<boolean> {
  return serialized(async () => {
    const file = await readJson<InventoryFile>(inventoryPath(), { players: {} });
    const list = file.players?.[steamId] ?? [];
    const kept = list.filter((o) => o.uid !== uid);
    if (kept.length === list.length) return false;
    if (kept.length === 0) delete file.players[steamId];
    else file.players[steamId] = kept;
    await writeJson(inventoryPath(), file);
    return true;
  });
}

/**
 * A box opened: the box's copy out, a dino item in, in one write (two opens at once: one dino).
 * `keepBox`: an admin's bag never runs out, the box stays. Null when the copy is not there (used already).
 */
export function openOwned(steamId: string, uid: string, intoItemId: string, dino: OwnedDino, note: string, keepBox = false): Promise<{ box: Owned; dino: Owned } | null> {
  return serialized(async () => {
    const file = await readJson<InventoryFile>(inventoryPath(), { players: {} });
    file.players ??= {};
    const list = file.players[steamId] ?? [];
    const box = list.find((o) => o.uid === uid);
    if (box === undefined) return null;
    const out: Owned = { uid: newId('own'), itemId: intoItemId, source: box.source, grantedAt: Math.floor(Date.now() / 1000), by: box.by,
      note: note.slice(0, 200), dino };
    file.players[steamId] = [...(keepBox ? list : list.filter((o) => o.uid !== uid)), out];
    await writeJson(inventoryPath(), file);
    return { box, dino: out };
  });
}

/**
 * The admins' bags (owner, 2026-10-05: "tất cả đều tự add vào túi admin"): one copy of every item still
 * given out (not retired; never the dino item, made by opening a box) in each of these bags that has
 * none, one write. Their bag never runs out (player-api.ts bagUnlimited), so one is enough. `skip`: items
 * never put there (the starter gift, one per account, "Hộp dino tự chọn" is the same box for them).
 * Returns how many copies went in.
 */
export function fillBags(steamIds: Iterable<string>, skip: readonly string[] = [], note = 'Túi admin: mọi vật phẩm'): Promise<number> {
  const ids = [...new Set(steamIds)].filter((id) => /^\d{17}$/.test(id));
  if (ids.length === 0) return Promise.resolve(0);
  return serialized(async () => {
    const all = (await listItems()).filter((i) => !i.retired && !skip.includes(i.id) && !ITEM_TYPES.find((t) => t.key === i.type)?.system);
    const file = await readJson<InventoryFile>(inventoryPath(), { players: {} });
    file.players ??= {};
    const now = Math.floor(Date.now() / 1000);
    let added = 0;
    for (const id of ids) {
      const list = file.players[id] ?? [];
      const have = new Set(list.map((o) => o.itemId));
      const fresh = all.filter((i) => !have.has(i.id))
        .map((i): Owned => ({ uid: newId('own'), itemId: i.id, source: 'admin', grantedAt: now, by: null, note }));
      if (fresh.length === 0) continue;
      file.players[id] = [...list, ...fresh];
      added += fresh.length;
    }
    if (added > 0) await writeJson(inventoryPath(), file);
    return added;
  });
}

/** A copy taken out given back as it was (its uid and data), when what it was used for failed. */
export function putBackOwned(steamId: string, owned: Owned): Promise<void> {
  return serialized(async () => {
    const file = await readJson<InventoryFile>(inventoryPath(), { players: {} });
    file.players ??= {};
    const list = file.players[steamId] ?? [];
    if (list.some((o) => o.uid === owned.uid)) return;
    file.players[steamId] = [...list, owned];
    await writeJson(inventoryPath(), file);
  });
}

// --- using a mutation item ------------------------------------------------------------------
// The copy is taken out of the inventory only once the mod says the mutation is
// on the dino (a portal_command event, action "mutation"): a refused or lost
// command leaves the item where it was. In memory: a bridge restart while one
// is on its way leaves that item in the bag too.
const pendingUses = new Map<number, { steamId: string; uid: string }>();

export function markPendingUse(commandId: number, steamId: string, uid: string): void {
  pendingUses.set(commandId, { steamId, uid });
}

/** Is this copy on its way to the game already (used twice in a row)? */
export function isPendingUse(steamId: string, uid: string): boolean {
  for (const p of pendingUses.values()) if (p.steamId === steamId && p.uid === uid) return true;
  return false;
}

/**
 * The mod's answer to a use: the copy is used up when it worked, unless
 * `unlimited(steamId)` says this bag never runs out (the server's admins,
 * player-api.ts bagUnlimited; the owner's call, 2026-10-02).
 */
export async function settleUse(
  event: { type: string; id?: unknown; action?: unknown; ok?: unknown },
  unlimited: (steamId: string) => Promise<boolean> = async () => false,
): Promise<void> {
  if (event.type !== 'portal_command' || event.action !== 'mutation' || typeof event.id !== 'number') return;
  const p = pendingUses.get(event.id);
  if (p === undefined) return;
  pendingUses.delete(event.id);
  if (event.ok === true && !(await unlimited(p.steamId))) await consumeOwned(p.steamId, p.uid);
}

