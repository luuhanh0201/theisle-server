import { ValidationError, createSlot, nextFreeSlot } from './garage.js';
import { SLOT_MIN_GROWTH } from './commands.js';
import { type Owned, type OwnedDino, SPECIES_DIET, consumeOwned, dietRefusal, ensureItem, getItem, inventoryOf, isPendingUse, openOwned, putBackOwned, speciesKey } from './items.js';
import { MUTATION_REFERENCE } from './mutation-reference.js';

/**
 * The dino boxes (owner, 2026-10-05): "bất kể hộp quà nào khi mở sẽ ra vật phẩm dino; khi dùng vật
 * phẩm dino mới bắt đầu chọn mutations (theo % dino đó)".
 *
 *   open    a box (items.ts dino_box) → a dino item in the bag: the species drawn among the ones the
 *           server knows (`random`) or picked by the player (`choose`), the growth drawn between the
 *           box's growthMin and growthMax. The box and the dino change places in one write.
 *   use     the dino item → the player picks its sex and the mutations of the slots its growth opens
 *           (as the game: slot 1 from 25 %, 2 from 50 %, 3 and 4 from 75 %); it goes into their next
 *           free garage slot with every prime task done, from 75 % the game makes it prime.
 */

/** The one item every dino copy is (its species and growth are the copy's own, Owned.dino). */
export const DINO_ITEM_ID = 'dino';
const DINO_ITEM = { type: 'dino', name: 'Dino', rarity: 'legendary', data: {} };
/** Every prime task done (ten 1s, task 1 first, garage.ts primeConditions). */
export const ALL_PRIME_TASKS = '1111111111';

type Catalog = Array<{ species: string; classPath: string | null }>;
export interface DinoOption { key: string; label: string; classPath: string; diet: 'carnivore' | 'herbivore' | 'omnivore' }
export interface MutationOption { name: string; description: string; diet: string; slot2: boolean; femaleOnly: boolean; quest: boolean }

/** The species a box can give: known to the server, with their class path and diet. */
export function speciesOptions(catalog: Catalog): DinoOption[] {
  return catalog.flatMap((c) => {
    const key = speciesKey(c.species);
    const diet = SPECIES_DIET[key];
    if (c.classPath === null || diet === undefined) return [];
    return [{ key, label: c.species.replace(/^BP_/, '').replace(/_C$/, ''), classPath: c.classPath, diet }];
  }).sort((a, b) => a.label.localeCompare(b.label));
}

/** The mutations a dino may take (still in the game; quest ones only when its box said so), with their Vietnamese description. */
export function mutationOptions(quest: boolean): MutationOption[] {
  return MUTATION_REFERENCE
    .filter((m) => (m.status === 'active' || m.status === 'disputed') && (quest || m.kind !== 'unlock'))
    .map((m) => ({ name: m.name, description: m.description, diet: m.diet, slot2: m.kind === 'slot2', femaleOnly: m.femaleOnly === true, quest: m.kind === 'unlock' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The slots open at this growth, as in the game. */
export const openSlots = (growth: number): number[] => ([1, 2, 3, 4] as const).filter((n) => growth + 1e-6 >= SLOT_MIN_GROWTH[n]);

/**
 * The player's pick for a dino item, checked: a sex; mutations that fit its diet and their slot, in a
 * slot its growth opens, female-only ones on a female, none twice.
 */
export function checkPick(raw: unknown, option: DinoOption, growth: number, mutations: MutationOption[]): { female: boolean; mutations: Record<string, string> } {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  if (typeof r['female'] !== 'boolean') throw new ValidationError('Chọn giới tính.');
  const female = r['female'];
  const picked = (typeof r['mutations'] === 'object' && r['mutations'] !== null ? r['mutations'] : {}) as Record<string, unknown>;
  const open = openSlots(growth);
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(picked)) {
    if (value === null || value === '') continue;
    const slot = Number(key);
    if (![1, 2, 3, 4].includes(slot)) throw new ValidationError('Chỉ có 4 ô mutation (1–4).');
    if (!open.includes(slot)) {
      throw new ValidationError(`Ô ${slot} mở từ ${Math.round(SLOT_MIN_GROWTH[slot as 1 | 2 | 3 | 4] * 100)}% tăng trưởng, dino này ${Math.round(growth * 100)}%.`);
    }
    const m = mutations.find((x) => x.name === value);
    if (m === undefined) throw new ValidationError(`Mutation "${String(value)}" không chọn được.`);
    const refused = dietRefusal(option.key, m.diet as Parameters<typeof dietRefusal>[1]);
    if (refused !== null) throw new ValidationError(`${m.name}: ${refused}.`);
    if (m.slot2 && slot !== 2 && slot !== 4) throw new ValidationError(`${m.name} chỉ đặt được ở ô 2 hoặc 4.`);
    if (m.femaleOnly && !female) throw new ValidationError(`${m.name} chỉ dành cho con cái.`);
    if (seen.has(m.name)) throw new ValidationError(`${m.name} đã chọn ở ô khác.`);
    seen.add(m.name);
    out[`Slot${slot}`] = m.name;
  }
  return { female, mutations: out };
}

async function ownedOf(steamId: string, uid: string, what: string): Promise<Owned> {
  const owned = (await inventoryOf(steamId)).find((o) => o.uid === uid);
  if (owned === undefined) throw new ValidationError(`Bạn không có ${what} này (hoặc đã dùng).`);
  if (isPendingUse(steamId, uid)) throw new ValidationError(`${what[0]?.toUpperCase()}${what.slice(1)} này đang được dùng.`);
  return owned;
}

/** What opening this box offers: how the species comes, the species (to pick, or the roll's reel), the growth range. */
export async function boxOptions(steamId: string, uid: string, catalog: Catalog) {
  const owned = await ownedOf(steamId, uid, 'hộp');
  const item = await getItem(owned.itemId);
  if (item === null || item.type !== 'dino_box') throw new ValidationError('Đây không phải hộp dino.');
  return { pick: item.data.pick, growthMin: item.data.growthMin, growthMax: item.data.growthMax,
    species: speciesOptions(catalog).map((s) => ({ key: s.key, label: s.label, diet: s.diet })) };
}

/**
 * Open a box: its species drawn or picked, its growth drawn (`random` for the tests); the dino item in the
 * bag. `keepBox`: an admin's bag (player-api.ts bagUnlimited), the box stays.
 */
export async function openDinoBox(steamId: string, uid: string, raw: unknown, catalog: Catalog, random: () => number = Math.random, keepBox = false,
): Promise<{ uid: string; species: string; label: string; growth: number; drawn: boolean }> {
  const owned = await ownedOf(steamId, uid, 'hộp');
  const box = await getItem(owned.itemId);
  if (box === null || box.type !== 'dino_box') throw new ValidationError('Đây không phải hộp dino.');
  const options = speciesOptions(catalog);
  if (options.length === 0) throw new ValidationError('Server chưa có danh sách dino, thử lại sau.');
  let option: DinoOption | undefined;
  if (box.data.pick === 'random') {
    option = options[Math.min(options.length - 1, Math.floor(random() * options.length))];
  } else {
    const want = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['species'] : undefined;
    option = options.find((s) => s.key === speciesKey(typeof want === 'string' ? want : ''));
    if (option === undefined) throw new ValidationError('Chọn một loài dino trong danh sách.');
  }
  if (option === undefined) throw new ValidationError('Chọn một loài dino trong danh sách.');
  const { growthMin, growthMax } = box.data;
  const growth = Math.round((growthMin + (growthMax - growthMin) * random()) * 100) / 100;
  await ensureItem(DINO_ITEM_ID, DINO_ITEM);
  const dino: OwnedDino = { species: option.key, growth, quest: box.data.quest };
  const out = await openOwned(steamId, uid, DINO_ITEM_ID, dino, `Mở từ ${box.name}`, keepBox);
  if (out === null) throw new ValidationError('Hộp đã được mở.');
  return { uid: out.dino.uid, species: option.key, label: option.label, growth, drawn: box.data.pick === 'random' };
}

function dinoOf(owned: Owned, catalog: Catalog): { dino: OwnedDino; option: DinoOption } {
  if (owned.dino === undefined) throw new ValidationError('Đây không phải vật phẩm dino.');
  const option = speciesOptions(catalog).find((s) => s.key === owned.dino?.species);
  if (option === undefined) throw new ValidationError('Server chưa có loài này trong danh sách, thử lại sau.');
  return { dino: owned.dino, option };
}

/** What using this dino item offers: its species, growth, the slots open and the mutations that fit its diet. */
export async function dinoItemOptions(steamId: string, uid: string, catalog: Catalog) {
  const owned = await ownedOf(steamId, uid, 'vật phẩm dino');
  const { dino, option } = dinoOf(owned, catalog);
  return { species: option.key, label: option.label, diet: option.diet, growth: dino.growth, openSlots: openSlots(dino.growth),
    mutations: mutationOptions(dino.quest).filter((m) => dietRefusal(option.key, m.diet as Parameters<typeof dietRefusal>[1]) === null) };
}

/**
 * Use a dino item: into the player's next free garage slot (a gift: past the slot limit too), then the
 * item is gone, taken first (two uses at once: one dino), given back as it was when the slot fails.
 */
export async function useDinoItem(steamId: string, uid: string, raw: unknown, catalog: Catalog,
): Promise<{ slot: string; species: string; growth: number; female: boolean; mutations: Record<string, string> }> {
  const owned = await ownedOf(steamId, uid, 'vật phẩm dino');
  const item = await getItem(owned.itemId);
  if (item === null || item.type !== 'dino') throw new ValidationError('Đây không phải vật phẩm dino.');
  const { dino, option } = dinoOf(owned, catalog);
  const pick = checkPick(raw, option, dino.growth, mutationOptions(dino.quest));
  if (!(await consumeOwned(steamId, uid))) throw new ValidationError('Vật phẩm dino đã được dùng.');
  let slot: string;
  try {
    slot = await nextFreeSlot(steamId);
    await createSlot(steamId, slot, {
      classPath: option.classPath, growth: dino.growth, isFemale: pick.female,
      primeConditions: ALL_PRIME_TASKS, ...(dino.growth >= 0.75 ? { isPrime: true } : {}),
      mutations: pick.mutations, stomachFull: true,
    });
  } catch (error) {
    await putBackOwned(steamId, owned);
    throw error;
  }
  return { slot, species: option.label, growth: dino.growth, female: pick.female, mutations: pick.mutations };
}
