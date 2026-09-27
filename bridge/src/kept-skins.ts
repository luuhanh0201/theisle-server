import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import type { SkinRequest } from './commands.js';

/**
 * Skins a player keeps for the next times they play a species ("giữ màu cho
 * lần chơi sau" on the web skin editor). The DinoGarage mod paints them on
 * every new dino of that species (garage/keepskin.lua).
 *
 *   <garageRoot>/skins.json   { players: { <steamId>: { <BP class>: { colors, pattern?, theme?, variation?, at } } } }
 *
 * Colours only (and pattern / theme / variation): the effects (mud, blood…)
 * dry off in game, they are not kept.
 */

export interface KeptSkin { colors: SkinRequest['colors']; pattern?: number; theme?: number; variation?: number; at: number }
type KeptFile = { players: Record<string, Record<string, KeptSkin>> };

const path = (): string => join(config.garageRoot, 'skins.json');
const SPECIES_RE = /^BP_[A-Za-z0-9]+_C$/;

async function readAll(): Promise<KeptFile> {
  try {
    const d = JSON.parse(await readFile(path(), 'utf8')) as Partial<KeptFile>;
    return { players: typeof d.players === 'object' && d.players !== null ? d.players : {} };
  } catch {
    return { players: {} };
  }
}

// One write at a time (two players saving at once must not lose one).
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

async function writeAll(d: KeptFile): Promise<void> {
  await mkdir(config.garageRoot, { recursive: true });
  const tmp = `${path()}.tmp`;
  await writeFile(tmp, JSON.stringify(d), 'utf8');
  await rename(tmp, path());
}

/** A player's kept skins, by species class. */
export async function keptSkinsOf(steamId: string): Promise<Record<string, KeptSkin>> {
  return (await readAll()).players[steamId] ?? {};
}

/** Keep (skin) or forget (null) a player's colours for one species. */
export function setKeptSkin(steamId: string, species: string, skin: SkinRequest | null, nowS = Math.floor(Date.now() / 1000)): Promise<void> {
  if (!SPECIES_RE.test(species)) return Promise.resolve();
  return serialized(async () => {
    const d = await readAll();
    const mine = { ...(d.players[steamId] ?? {}) };
    if (skin === null) delete mine[species];
    else {
      mine[species] = {
        colors: skin.colors, at: nowS,
        ...(skin.pattern !== undefined ? { pattern: skin.pattern } : {}),
        ...(skin.theme !== undefined ? { theme: skin.theme } : {}),
        ...(skin.variation !== undefined ? { variation: skin.variation } : {}),
      };
    }
    if (Object.keys(mine).length === 0) delete d.players[steamId];
    else d.players[steamId] = mine;
    await writeAll(d);
  });
}
