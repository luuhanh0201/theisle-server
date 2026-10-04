import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { ValidationError, createSlot, nextFreeSlot } from './garage.js';
import { type DinoTicketData, SPECIES_DIET, dietRefusal, ensureItem, getItem, grantItem, inventoryOf, isPendingUse, consumeOwned, revokeItem, speciesKey } from './items.js';
import { MUTATION_REFERENCE } from './mutation-reference.js';

/**
 * The starter ticket (owner, 2026-10-05): every account that has ever been on the server, and each
 * new one, is offered one "Phiếu chọn dino" once — a gift taken on the home page ("nhận từ đó mới hiển
 * thị trên túi đồ, khi nhận thì mất ô đó"): only then is it in their bag. Used from the bag: the player picks any species, its sex
 * and the mutations of its four slots; the dino goes into their garage with every prime task done
 * and a growth drawn between the ticket's growthMin and growthMax (50–100 % by default) — from about
 * 75 % the game makes it prime. Tried by SVip first (svip.ts feature 'starter'); the panel's
 * "Phát hành" opens it to everyone.
 *
 *   data/starter.json  { offered: { <steamId>: <unix s> }, claimed: { <steamId>: <unix s> } }
 *
 * Before the home-page gift (the first hours), the ticket was put straight into the bags:
 * data/starter-granted.json. Read once: a ticket still unused goes back to "offered".
 */

export const STARTER_ITEM_ID = 'starter_dino';
const STARTER_ITEM = { type: 'dino_ticket', name: 'Phiếu chọn dino (tân thủ)', rarity: 'legendary',
  data: { growthMin: 0.5, growthMax: 1, quest: false } };
/** Every prime task done (ten 1s, task 1 first — garage.ts primeConditions). */
export const ALL_PRIME_TASKS = '1111111111';

const statePath = (): string => join(config.dataDir, 'starter.json');
const oldPath = (): string => join(config.dataDir, 'starter-granted.json');
const inventoryFile = (): string => join(config.dataDir, 'item-inventory.json');

interface StarterState { offered: Record<string, number>; claimed: Record<string, number> }

async function writeState(st: StarterState): Promise<void> {
  await mkdir(dirname(statePath()), { recursive: true });
  const tmp = `${statePath()}.tmp`;
  await writeFile(tmp, JSON.stringify(st, null, 2), 'utf8');
  await rename(tmp, statePath());
}

async function readState(now: number): Promise<StarterState> {
  try {
    const raw = JSON.parse(await readFile(statePath(), 'utf8')) as Partial<StarterState>;
    return { offered: raw.offered ?? {}, claimed: raw.claimed ?? {} };
  } catch { /* none yet */ }
  const st: StarterState = { offered: {}, claimed: {} };
  let old: Record<string, number> = {};
  try { old = (JSON.parse(await readFile(oldPath(), 'utf8')) as { players?: Record<string, number> }).players ?? {}; } catch { /* none */ }
  if (Object.keys(old).length > 0) {
    // The bags are changed: kept as they were first.
    await copyFile(inventoryFile(), `${inventoryFile()}.bak-starter-${now}`).catch(() => undefined);
    for (const id of Object.keys(old)) {
      const unused = (await inventoryOf(id)).some((o) => o.itemId === STARTER_ITEM_ID);
      if (unused) { await revokeItem(id, STARTER_ITEM_ID); st.offered[id] = now; } else st.claimed[id] = old[id] as number;
    }
    await rename(oldPath(), `${oldPath()}.migrated`);
  }
  await writeState(st);
  return st;
}

let busy: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = busy.then(fn, fn);
  busy = run.catch(() => undefined);
  return run;
}

/**
 * Offer the gift to each of these SteamIDs never offered it. Returns who is offered it now.
 * Run at the bridge's start (everyone who has played) and every minute (anyone new).
 */
export function grantStarters(steamIds: Iterable<string>, now = Math.floor(Date.now() / 1000)): Promise<string[]> {
  const ids = [...new Set(steamIds)].filter((id) => /^\d{17}$/.test(id));
  return serialized(async () => {
    await ensureItem(STARTER_ITEM_ID, STARTER_ITEM);
    const st = await readState(now);
    const fresh = ids.filter((id) => st.offered[id] === undefined && st.claimed[id] === undefined);
    for (const id of fresh) st.offered[id] = now;
    if (fresh.length > 0) await writeState(st);
    return fresh;
  });
}

/** Whether this player has the gift waiting on the home page. */
export async function starterOffered(steamId: string, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const st = await serialized(() => readState(now));
  return st.offered[steamId] !== undefined && st.claimed[steamId] === undefined;
}

/** Take the gift: the ticket into their bag, the home page's box gone. */
export function claimStarter(steamId: string, now = Math.floor(Date.now() / 1000)): Promise<{ item: string }> {
  return serialized(async () => {
    const st = await readState(now);
    if (st.claimed[steamId] !== undefined) throw new ValidationError('Bạn đã nhận quà tân thủ rồi.');
    if (st.offered[steamId] === undefined) throw new ValidationError('Bạn chưa có quà tân thủ.');
    const item = await ensureItem(STARTER_ITEM_ID, STARTER_ITEM);
    await grantItem(steamId, STARTER_ITEM_ID, 'event', null, 'Quà tân thủ: mỗi tài khoản 1 phiếu');
    delete st.offered[steamId];
    st.claimed[steamId] = now;
    await writeState(st);
    return { item: item.name };
  });
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
