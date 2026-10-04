import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';
import { ensureItem, grantItem, inventoryOf, revokeItem } from './items.js';

/**
 * The starter gift (owner, 2026-10-05): every account that has ever been on the server, and each new
 * one, is offered once a "Hộp dino tự chọn" — taken on the home page ("nhận từ đó mới hiển thị trên
 * túi đồ, khi nhận thì mất ô đó"): only then is it in their bag. Opened there (dino-box.ts): the
 * species picked, the growth drawn 50–100 %; the dino item, used: its sex and mutations picked, into
 * the garage with every prime task done. Tried by SVip first (svip.ts feature 'starter'); the panel's
 * "Phát hành" opens it to everyone.
 *
 *   data/starter.json  { offered: { <steamId>: <unix s> }, claimed: { <steamId>: <unix s> } }
 *
 * Before the home-page gift (the first hours), a ticket was put straight into the bags:
 * data/starter-granted.json. Read once: a ticket still unused goes back to "offered".
 */

export const STARTER_ITEM_ID = 'starter_box';
/** The ticket the first hours gave (an unused one there is taken back by the migration below). */
const OLD_STARTER_ITEM_ID = 'starter_dino';
const STARTER_ITEM = { type: 'dino_box', name: 'Hộp dino tự chọn (tân thủ)', rarity: 'legendary',
  data: { pick: 'choose', growthMin: 0.5, growthMax: 1, quest: false } };

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
      const unused = (await inventoryOf(id)).some((o) => o.itemId === OLD_STARTER_ITEM_ID);
      if (unused) { await revokeItem(id, OLD_STARTER_ITEM_ID); st.offered[id] = now; } else st.claimed[id] = old[id] as number;
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
    await grantItem(steamId, STARTER_ITEM_ID, 'event', null, 'Quà tân thủ: mỗi tài khoản 1 hộp');
    delete st.offered[steamId];
    st.claimed[steamId] = now;
    await writeState(st);
    return { item: item.name };
  });
}
