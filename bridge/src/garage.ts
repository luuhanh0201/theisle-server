import { readFile, writeFile, rename, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { Catalog, groupOfSlot, MUTATION_NAME_RE } from './catalog.js';

/**
 * Reads and writes the DinoGarage store on disk.
 *
 * Layout and schema are fixed by the Lua mod — see
 * docs/reference/EVRIMA_DinoStorage_Architecture.md:
 *
 *   <root>/storage.json            index, schema 4
 *   <root>/stored/<steam>/<slot>.json   per-slot state, version 1
 *
 * Write order is per-slot file FIRST, index SECOND, matching the mod. A crash
 * between the two leaves a stale index, and the mod re-reads the index from
 * disk on every listing, so it recovers on the next write.
 */

export const SLOT_VERSION = 1;
export const INDEX_SCHEMA = 4;

const SLOT_RE = /^[A-Za-z0-9_-]{1,32}$/;
const STEAM_RE = /^\d{17}$/;

export interface SlotMeta {
  classPath: string;
  growth: number | null;
  capturedAt: number;
}

export interface GarageIndex {
  schema: number;
  players: Record<string, Record<string, SlotMeta>>;
}

/** What an admin must supply to put a dino straight into someone's garage. */
export interface NewSlotSpec {
  classPath: string;
  growth: number;
  health?: number;
  stamina?: number;
  hunger?: number;
  thirst?: number;
  maxHunger?: number;
  maxThirst?: number;
  maxStamina?: number;
  maxFoodValue?: number;
  isFemale?: boolean;
  /**
   * Prime elder: restore.lua calls ServerSetPrimeEligible(true). The game
   * marks a dino prime from about 75 % growth when it is eligible, so it
   * needs growth >= 0.75.
   */
  isPrime?: boolean;
  /** Elder replication stacks (the lineage counter), 0–10; restore.lua sets them. */
  elderStacks?: number;
  /** Fill the stomach to the game's max for this dino on redeem (default true). */
  stomachFull?: boolean;
  /** Nutrient level to give (carb, protein, lipid), % of the dino's max —
   * its stomach, GetMaxHunger (restore.lua). Default 50. */
  nutrientPct?: number;
  /** Slot key -> mutation FName, e.g. { Slot1: "MUT_Hematophagy" }. */
  mutations?: Record<string, string>;
  /**
   * Must be true to replace a dino already in this slot. The replaced one is
   * moved to deleted/ first, never just overwritten.
   */
  overwrite?: boolean;
  /** Checked by the HTTP layer (catalog), not stored. */
  allowUnconfirmedMutations?: boolean;
}


/**
 * Validate the mutations an admin asked for. The Lua restore writes each value
 * with FName(), so only well-formed names for known slot keys get through.
 */
function validateMutations(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('mutations must be an object of slot -> name');
  }
  const out: Record<string, string> = {};
  for (const [slot, name] of Object.entries(raw as Record<string, unknown>)) {
    if (groupOfSlot(slot) === null) throw new ValidationError(`unknown mutation slot "${slot}"`);
    if (name === '' || name === null) continue;
    if (typeof name !== 'string' || !MUTATION_NAME_RE.test(name)) {
      throw new ValidationError(`mutation for ${slot} must be letters, digits, spaces, _ or - (max 64)`);
    }
    out[slot] = name;
  }
  return out;
}

export class ValidationError extends Error {}
export class NotFoundError extends Error {}
/** The slot already holds a dino and the caller did not ask to replace it. */
export class ConflictError extends Error {}

export function isSteamId(value: string): boolean {
  return STEAM_RE.test(value);
}

export function assertSteamId(value: string): void {
  if (!STEAM_RE.test(value)) throw new ValidationError('steamId must be 17 digits');
}

export function assertSlot(value: string): void {
  if (!SLOT_RE.test(value)) {
    throw new ValidationError('slot must be 1-32 chars of A-Z a-z 0-9 _ -');
  }
}

function indexPath(): string {
  return join(config.garageRoot, 'storage.json');
}

/**
 * Flat layout, one directory: stored/<steam>__<slot>.json
 *
 * The Lua mod cannot create directories (no mkdir in Lua, and io.open will not
 * make one), so a per-player subdirectory would never exist for a first-time
 * player. Both sides use this flat form. SteamID64 is always 17 digits, so the
 * name parses back unambiguously.
 */
function slotPath(steamId: string, slot: string): string {
  return join(config.garageRoot, 'stored', `${steamId}__${slot}.json`);
}

const SLOT_FILE_RE = /^(\d{17})__(.+)\.json$/;

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Write via a temp file and rename, so a crash cannot truncate live data. */
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, path);
}

export async function readIndex(): Promise<GarageIndex> {
  const data = await readJson<GarageIndex>(indexPath());
  if (data === null || typeof data.players !== 'object' || data.players === null) {
    return { schema: INDEX_SCHEMA, players: {} };
  }
  return data;
}

export async function listPlayer(steamId: string): Promise<Record<string, SlotMeta>> {
  assertSteamId(steamId);
  // Goes through listAll so a slot the Lua mod wrote before its index update
  // landed is still visible here. Reading the raw index would hide it.
  const index = await listAll();
  return index.players[steamId] ?? {};
}

/** One stored dino with its full slot file (null when unreadable). */
export interface StoredDino {
  slot: string;
  meta: SlotMeta;
  state: Record<string, unknown> | null;
}

/** Everything a player has parked, newest first, with the full state. */
export async function readPlayerGarage(steamId: string): Promise<StoredDino[]> {
  const slots = await listPlayer(steamId);
  const out: StoredDino[] = [];
  for (const [slot, meta] of Object.entries(slots)) {
    // Slot names come from disk: never build a path from one that could
    // escape stored/.
    if (!SLOT_RE.test(slot)) continue;
    out.push({ slot, meta, state: await readJson(slotPath(steamId, slot)) });
  }
  return out.sort((a, b) => b.meta.capturedAt - a.meta.capturedAt);
}

export async function readSlot(steamId: string, slot: string): Promise<unknown | null> {
  assertSteamId(steamId);
  assertSlot(slot);
  return readJson(slotPath(steamId, slot));
}

/**
 * Build a complete, version-1 slot file from an admin's spec and write it.
 *
 * Fields the admin does not set are left null rather than zeroed: the restore
 * code skips nulls, and a zero would come back as a starving dino.
 */
/** The game marks an eligible dino prime from about this growth (seen: 0.752). */
export const PRIME_MIN_GROWTH = 0.75;

export async function createSlot(
  steamId: string,
  slot: string,
  spec: NewSlotSpec,
): Promise<SlotMeta & { replaced: string | null }> {
  assertSteamId(steamId);
  assertSlot(slot);

  if (typeof spec.classPath !== 'string' || spec.classPath.trim() === '') {
    throw new ValidationError('classPath is required');
  }
  if (typeof spec.growth !== 'number' || !Number.isFinite(spec.growth)) {
    throw new ValidationError('growth is required and must be a number');
  }
  if (spec.growth < 0 || spec.growth > 1) {
    throw new ValidationError('growth must be between 0 and 1');
  }
  if (spec.overwrite !== undefined && typeof spec.overwrite !== 'boolean') {
    throw new ValidationError('overwrite must be true or false');
  }
  if (spec.isFemale !== undefined && typeof spec.isFemale !== 'boolean') {
    throw new ValidationError('isFemale must be true or false');
  }
  if (spec.isPrime !== undefined && typeof spec.isPrime !== 'boolean') {
    throw new ValidationError('isPrime must be true or false');
  }
  if (spec.isPrime === true && spec.growth < PRIME_MIN_GROWTH) {
    throw new ValidationError(`a prime elder needs growth of at least ${PRIME_MIN_GROWTH * 100} %`);
  }
  const elderStacks = spec.elderStacks ?? null;
  if (elderStacks !== null && (!Number.isInteger(elderStacks) || elderStacks < 0 || elderStacks > 10)) {
    throw new ValidationError('elderStacks must be a whole number 0–10');
  }
  const mutations = validateMutations(spec.mutations);
  if (spec.stomachFull !== undefined && typeof spec.stomachFull !== 'boolean') {
    throw new ValidationError('stomachFull must be true or false');
  }
  const nutrientPct = spec.nutrientPct ?? 50;
  if (!Number.isInteger(nutrientPct) || nutrientPct < 0 || nutrientPct > 100) {
    throw new ValidationError('nutrientPct must be a whole number 0–100');
  }

  const capturedAt = Math.floor(Date.now() / 1000);
  const state = {
    version: SLOT_VERSION,
    slot,
    capturedAt,
    classPath: spec.classPath,

    health: spec.health ?? null,
    stamina: spec.stamina ?? null,
    hunger: spec.hunger ?? null,
    thirst: spec.thirst ?? null,
    oxygen: null,
    blood: null,
    lockedDamage: null,
    food: null,
    waterLevel: null,
    rottenValue: null,

    maxHunger: spec.maxHunger ?? null,
    maxFoodValue: spec.maxFoodValue ?? null,
    maxThirst: spec.maxThirst ?? null,
    maxStamina: spec.maxStamina ?? null,

    growth: spec.growth,
    // Informational only: restore.lua has no way to change sex (the player
    // picks it at respawn), so an unset value stays null rather than
    // claiming "male".
    isFemale: spec.isFemale ?? null,
    // restore.lua: ServerSetPrimeEligible(true). Null = leave it as the game has it.
    isPrime: spec.isPrime === true ? true : null,

    // Only what the admin chose. Empty slots are left out, and the restore
    // skips a missing slot rather than clearing it.
    mutations,
    nutrients: {},
    elderStacks,
    // Read by restore.lua: an admin gift comes out fed (see NewSlotSpec).
    fill: { stomachFull: spec.stomachFull ?? true, nutrientPct },

    createdBy: 'admin',
  };

  // A slot is taken if either the file or the index says so: the index can
  // lag the files, and the files can lag the index.
  const taken =
    (await readJson(slotPath(steamId, slot))) !== null ||
    (await readIndex()).players[steamId]?.[slot] !== undefined;
  if (taken && spec.overwrite !== true) {
    throw new ConflictError(`slot "${slot}" already holds a dino — send overwrite: true to replace it`);
  }
  // Replacing: keep the old dino in deleted/, the same as an explicit delete.
  const replaced = taken ? await moveToTrash(steamId, slot) : null;

  await mkdir(join(config.garageRoot, 'stored'), { recursive: true });
  await writeJsonAtomic(slotPath(steamId, slot), state);

  const meta: SlotMeta = { classPath: spec.classPath, growth: spec.growth, capturedAt };
  const index = await readIndex();
  index.schema = INDEX_SCHEMA;
  index.players[steamId] = { ...(index.players[steamId] ?? {}), [slot]: meta };
  await writeJsonAtomic(indexPath(), index);

  return { ...meta, replaced };
}

/**
 * Move a slot file to deleted/<steam>__<slot>__<unix>.json.
 * Returns the new name, or null when there was no file to move.
 */
async function moveToTrash(steamId: string, slot: string): Promise<string | null> {
  await mkdir(join(config.garageRoot, 'deleted'), { recursive: true });
  const trashedAs = `${steamId}__${slot}__${Math.floor(Date.now() / 1000)}.json`;
  try {
    await rename(slotPath(steamId, slot), join(config.garageRoot, 'deleted', trashedAs));
    return trashedAs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Remove a dino from a garage. SOFT delete: the slot file moves to
 * <garageRoot>/deleted/<steam>__<slot>__<unix>.json, so a misclick is one
 * `mv` away from undone. Index entry is dropped after the move, in the same
 * file-then-index order the mod uses.
 */
export async function deleteSlot(steamId: string, slot: string): Promise<{ trashedAs: string | null }> {
  assertSteamId(steamId);
  assertSlot(slot);

  const index = await readIndex();
  const inIndex = index.players[steamId]?.[slot] !== undefined;

  const trashedAs = await moveToTrash(steamId, slot);

  if (trashedAs === null && !inIndex) throw new NotFoundError('slot not found');

  if (inIndex) {
    const players = index.players[steamId] as Record<string, SlotMeta>;
    delete players[slot];
    if (Object.keys(players).length === 0) delete index.players[steamId];
    index.schema = INDEX_SCHEMA;
    await writeJsonAtomic(indexPath(), index);
  }
  return { trashedAs };
}

/** Species and mutations found in every stored slot file. */
export async function readGarageCatalog(): Promise<Catalog> {
  const catalog = new Catalog();
  let files: string[];
  try {
    files = await readdir(join(config.garageRoot, 'stored'));
  } catch {
    return catalog;
  }
  for (const name of files) {
    const match = SLOT_FILE_RE.exec(name);
    if (match === null) continue;
    const state = await readJson<{
      classPath?: unknown;
      mutations?: unknown;
      createdBy?: unknown;
      capturedAt?: unknown;
    }>(
      join(config.garageRoot, 'stored', name),
    );
    // An admin-written slot proves nothing about what exists in the game:
    // learning from it would let one typo teach the catalog a fake species.
    if (state === null || state.createdBy === 'admin' || typeof state.classPath !== 'string') continue;
    catalog.addClassPath(state.classPath);
    if (typeof state.mutations === 'object' && state.mutations !== null) {
      catalog.addMutations(
        state.classPath.split('.').pop() ?? state.classPath,
        state.mutations as Record<string, string>,
        {
          steamId: match[1] as string,
          ...(typeof state.capturedAt === 'number' ? { t: state.capturedAt } : {}),
        },
      );
    }
  }
  return catalog;
}

/** Every player who has anything stored, for the panel's garage view. */
export async function listAll(): Promise<GarageIndex> {
  const index = await readIndex();
  // The index can lag behind the files if a write was interrupted. Fold in any
  // slot file it does not know about, so the panel never hides a dino.
  try {
    const files = await readdir(join(config.garageRoot, 'stored'));
    for (const name of files) {
      const match = SLOT_FILE_RE.exec(name);
      if (match === null) continue;
      const [, steamId, slot] = match as unknown as [string, string, string];
      const slots = (index.players[steamId] ??= {});
      if (slots[slot] !== undefined) continue;

      const state = await readJson<Partial<SlotMeta>>(
        join(config.garageRoot, 'stored', name),
      );
      slots[slot] = {
        classPath: state?.classPath ?? 'unknown',
        growth: state?.growth ?? null,
        capturedAt: state?.capturedAt ?? 0,
      };
    }
  } catch {
    // No stored/ directory yet — nothing has been parked.
  }
  return index;
}

// --- settings the mod reads (garage/settings.lua) --------------------------

/** Where a redeemed dino appears. The mod treats anything else as 'current'. */
export const REDEEM_AT = ['current', 'stored', 'choice'] as const;
export type RedeemAt = (typeof REDEEM_AT)[number];
export interface GarageSettings {
  redeemAt: RedeemAt;
  /** Slots a player may fill with !store. */
  maxSlots: number;
  /** Seconds from "!store" to the dino going in; nothing is saved before. */
  storeCountdown: number;
  /** Seconds between two garage uses (!store or !redeem) by one player. */
  cooldown: number;
}
export const GARAGE_SETTINGS_DEFAULTS: GarageSettings = { redeemAt: 'current', maxSlots: 2, storeCountdown: 30, cooldown: 60 };
/** Same ranges as mods/DinoGarage/Scripts/garage/settings.lua. */
const RANGES = { maxSlots: [1, 20], storeCountdown: [0, 300], cooldown: [0, 86400] } as const;

const settingsPath = (): string => join(config.garageRoot, 'garage-settings.json');

function wholeIn(v: unknown, [lo, hi]: readonly [number, number]): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
}

export async function readGarageSettings(): Promise<GarageSettings> {
  const out = { ...GARAGE_SETTINGS_DEFAULTS };
  try {
    const raw = JSON.parse(await readFile(settingsPath(), 'utf8')) as Record<string, unknown>;
    if (REDEEM_AT.includes(raw['redeemAt'] as RedeemAt)) out.redeemAt = raw['redeemAt'] as RedeemAt;
    for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
      out[key] = wholeIn(raw[key], RANGES[key]) ?? out[key];
    }
  } catch {
    // Missing or unreadable: the mod falls back to the defaults too.
  }
  return out;
}

/** Validated (every field), then written atomically. Takes effect on the next command. */
export async function saveGarageSettings(raw: unknown): Promise<GarageSettings> {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!REDEEM_AT.includes(r['redeemAt'] as RedeemAt)) {
    throw new ValidationError(`redeemAt must be one of: ${REDEEM_AT.join(', ')}`);
  }
  const settings = { redeemAt: r['redeemAt'] as RedeemAt } as GarageSettings;
  for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
    const v = r[key] === undefined ? GARAGE_SETTINGS_DEFAULTS[key] : wholeIn(r[key], RANGES[key]);
    if (v === null) throw new ValidationError(`${key} must be a whole number ${RANGES[key][0]}–${RANGES[key][1]}`);
    settings[key] = v;
  }
  await writeJsonAtomic(settingsPath(), settings);
  return settings;
}
