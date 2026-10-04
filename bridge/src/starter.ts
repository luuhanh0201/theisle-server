import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { ValidationError, createSlot, nextFreeSlot } from './garage.js';
import { type DinoTicketData, SPECIES_DIET, dietRefusal, ensureItem, getItem, grantItem, inventoryOf, isPendingUse, consumeOwned, speciesKey } from './items.js';
import { MUTATION_REFERENCE } from './mutation-reference.js';

/**
 * The starter ticket (owner, 2026-10-05): every account that has ever been on the server, and each
 * new one, gets one "Phiếu chọn dino" once. Used from the bag: the player picks any species, its sex
 * and the mutations of its four slots; the dino goes into their garage with every prime task done
 * and a growth drawn between the ticket's growthMin and growthMax (50–100 % by default) — from about
 * 75 % the game makes it prime. Tried by SVip first (svip.ts feature 'starter'); the panel's
 * "Phát hành" opens it to everyone.
 *
 *   data/starter-granted.json  { players: { <steamId>: <unix s> } }   who has had theirs
 */

export const STARTER_ITEM_ID = 'starter_dino';
const STARTER_ITEM = { type: 'dino_ticket', name: 'Phiếu chọn dino (tân thủ)', rarity: 'legendary',
  data: { growthMin: 0.5, growthMax: 1, quest: false } };
/** Every prime task done (ten 1s, task 1 first — garage.ts primeConditions). */
export const ALL_PRIME_TASKS = '1111111111';

const grantedPath = (): string => join(config.dataDir, 'starter-granted.json');

async function readGranted(): Promise<Record<string, number>> {
  try {
    const raw = JSON.parse(await readFile(grantedPath(), 'utf8')) as { players?: unknown };
    return typeof raw.players === 'object' && raw.players !== null ? raw.players as Record<string, number> : {};
  } catch {
    return {};
  }
}

async function writeGranted(players: Record<string, number>): Promise<void> {
  await mkdir(dirname(grantedPath()), { recursive: true });
  const tmp = `${grantedPath()}.tmp`;
  await writeFile(tmp, JSON.stringify({ players }, null, 2), 'utf8');
  await rename(tmp, grantedPath());
}

let busy: Promise<unknown> = Promise.resolve();

/**
 * Give the ticket to each of these SteamIDs that has never had one. Returns who got it now.
 * Run at the bridge's start (everyone who has played) and every minute (anyone new).
 */
export function grantStarters(steamIds: Iterable<string>, now = Math.floor(Date.now() / 1000)): Promise<string[]> {
  const ids = [...new Set(steamIds)].filter((id) => /^\d{17}$/.test(id));
  const run = busy.then(async () => {
    await ensureItem(STARTER_ITEM_ID, STARTER_ITEM);
    const granted = await readGranted();
    const fresh = ids.filter((id) => granted[id] === undefined);
    for (const id of fresh) {
      await grantItem(id, STARTER_ITEM_ID, 'event', null, 'Quà tân thủ: mỗi tài khoản 1 phiếu');
      granted[id] = now;
      // Kept after each one: a crash halfway must not give the first ones a second ticket.
      await writeGranted(granted);
    }
    return fresh;
  });
  busy = run.catch(() => undefined);
  return run;
}

export interface DinoOption { key: string; label: string; classPath: string; diet: 'carnivore' | 'herbivore' | 'omnivore' }
export interface MutationOption { name: string; description: string; diet: string; slot2: boolean; femaleOnly: boolean; quest: boolean }

/** The species a ticket can give (known to the server, with their class path) and the mutations it can carry. */
export function dinoOptions(catalog: Array<{ species: string; classPath: string | null }>, data: DinoTicketData): { species: DinoOption[]; mutations: MutationOption[] } {
  const species = catalog.flatMap((c) => {
    const key = speciesKey(c.species);
    const diet = SPECIES_DIET[key];
    if (c.classPath === null || diet === undefined) return [];
    const label = c.species.replace(/^BP_/, '').replace(/_C$/, '');
    return [{ key, label, classPath: c.classPath, diet }];
  }).sort((a, b) => a.label.localeCompare(b.label));
  const mutations = MUTATION_REFERENCE
    .filter((m) => (m.status === 'active' || m.status === 'disputed') && (data.quest || m.kind !== 'unlock'))
    .map((m) => ({ name: m.name, description: m.description, diet: m.diet, slot2: m.kind === 'slot2', femaleOnly: m.femaleOnly === true, quest: m.kind === 'unlock' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { species, mutations };
}

export interface DinoChoice { species: string; female: boolean; mutations: Record<string, string> }

/** The player's choice, checked against the options: a known species, mutations that fit it and their slot, none twice. */
export function checkChoice(raw: unknown, options: ReturnType<typeof dinoOptions>): { option: DinoOption; female: boolean; mutations: Record<string, string> } {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const option = options.species.find((s) => s.key === speciesKey(typeof r['species'] === 'string' ? r['species'] : ''));
  if (option === undefined) throw new ValidationError('Chọn một loài dino trong danh sách.');
  if (typeof r['female'] !== 'boolean') throw new ValidationError('Chọn giới tính.');
  const female = r['female'];
  const picked = (typeof r['mutations'] === 'object' && r['mutations'] !== null ? r['mutations'] : {}) as Record<string, unknown>;
  const mutations: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(picked)) {
    if (value === null || value === '') continue;
    const slot = Number(key);
    if (![1, 2, 3, 4].includes(slot)) throw new ValidationError('Chỉ có 4 ô mutation (1–4).');
    const m = options.mutations.find((x) => x.name === value);
    if (m === undefined) throw new ValidationError(`Mutation "${String(value)}" không chọn được.`);
    const refused = dietRefusal(option.key, m.diet as Parameters<typeof dietRefusal>[1]);
    if (refused !== null) throw new ValidationError(`${m.name}: ${refused}.`);
    if (m.slot2 && slot !== 2 && slot !== 4) throw new ValidationError(`${m.name} chỉ đặt được ở ô 2 hoặc 4.`);
    if (m.femaleOnly && !female) throw new ValidationError(`${m.name} chỉ dành cho con cái.`);
    if (seen.has(m.name)) throw new ValidationError(`${m.name} đã chọn ở ô khác.`);
    seen.add(m.name);
    mutations[`Slot${slot}`] = m.name;
  }
  return { option, female, mutations };
}

/**
 * Use a dino ticket: the dino into the player's next free garage slot (a gift: past the slot limit
 * too), then the ticket is gone. The growth is drawn here (`random` for the tests).
 */
export async function useDinoTicket(steamId: string, uid: string, raw: unknown,
  catalog: Array<{ species: string; classPath: string | null }>, random: () => number = Math.random,
): Promise<{ slot: string; species: string; growth: number; female: boolean; mutations: Record<string, string> }> {
  const owned = (await inventoryOf(steamId)).find((o) => o.uid === uid);
  if (owned === undefined) throw new ValidationError('Bạn không có phiếu này (hoặc đã dùng).');
  if (isPendingUse(steamId, uid)) throw new ValidationError('Phiếu này đang được dùng.');
  const item = await getItem(owned.itemId);
  if (item === null || item.type !== 'dino_ticket') throw new ValidationError('Đây không phải phiếu chọn dino.');
  const choice = checkChoice(raw, dinoOptions(catalog, item.data));
  const { growthMin, growthMax } = item.data;
  const growth = Math.round((growthMin + (growthMax - growthMin) * random()) * 100) / 100;
  // The ticket first: two uses at once cannot both make a dino. Given back when the dino cannot be made.
  if (!(await consumeOwned(steamId, uid))) throw new ValidationError('Phiếu đã được dùng.');
  let slot: string;
  try {
    slot = await nextFreeSlot(steamId);
    await createSlot(steamId, slot, {
      classPath: choice.option.classPath, growth, isFemale: choice.female,
      primeConditions: ALL_PRIME_TASKS, ...(growth >= 0.75 ? { isPrime: true } : {}),
      mutations: choice.mutations, stomachFull: true,
    });
  } catch (error) {
    await grantItem(steamId, owned.itemId, owned.source, owned.by, owned.note);
    throw error;
  }
  return { slot, species: choice.option.label, growth, female: choice.female, mutations: choice.mutations };
}
