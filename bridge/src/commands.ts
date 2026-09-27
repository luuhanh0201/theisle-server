import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { assertSlot, assertSteamId, ValidationError } from './garage.js';

/**
 * Commands for the game, delivered through DinoGarage's inbox — the admin
 * "kill", a player's own "store" / "redeem" from the web garage, and their
 * "skin" (the colours of the dino they play now, from the web)
 * (mods/DinoGarage/Scripts/garage/inbox.lua). The bridge cannot touch the
 * game; it writes a file the mod polls every 2s.
 *
 *   <garageRoot>/inbox.json      this side: { commands: [...] }, atomic rename
 *   <garageRoot>/inbox.ack.json  the mod's side: { lastId }
 *
 * Ids only grow, and the mod runs each id at most once. A command the mod has
 * not picked up by expiresAt is refused rather than run late.
 */

/** How long the mod may take to pick a command up. */
const COMMAND_TTL_SECONDS = 60;
const MAX_REASON = 200;

interface CommandBase { id: number; steamId: string; createdAt: number; expiresAt: number }
export type InboxCommand =
  | CommandBase & { type: 'kill'; reason: string }
  | CommandBase & { type: 'store'; slot: string }
  | CommandBase & { type: 'redeem'; slot?: string; where?: 'stored' | 'here' }
  | CommandBase & { type: 'skin'; skin: SkinRequest }
  | CommandBase & { type: 'light'; on: boolean };
type NewCommand =
  | { type: 'kill'; steamId: string; reason: string }
  | { type: 'store'; steamId: string; slot: string }
  | { type: 'redeem'; steamId: string; slot?: string; where?: 'stored' | 'here' }
  | { type: 'skin'; steamId: string; skin: SkinRequest }
  | { type: 'light'; steamId: string; on: boolean };

/** The skin regions of pawn.CustomizerData (<Region>Color), as the mods read and write them. */
export const SKIN_REGIONS = ['Body', 'Flank', 'Underbelly', 'Markings', 'MaleDisplay', 'Detail1', 'Eyes', 'Teeth', 'Mouth', 'Claws'] as const;
/** Skin effects (pawn.SkinEffects) a player may set, 0–1 — they dry / fade in game as usual. */
export const SKIN_EFFECTS = ['Wet', 'Mud', 'Blood', 'Dirt', 'Dust', 'Duckweed'] as const;
/**
 * A colour channel may go above 1 ("glow": the game keeps it — tried on a test
 * server, 2026-09-27; how it LOOKS in game is to be seen). The mod takes up to 10.
 */
export const SKIN_CHANNEL_MAX = 4;
/** Colours are the game's LINEAR values 0–SKIN_CHANNEL_MAX (the portal converts from the sRGB hex it shows). */
export interface SkinRequest {
  colors: Partial<Record<(typeof SKIN_REGIONS)[number], { r: number; g: number; b: number }>>;
  effects?: Partial<Record<(typeof SKIN_EFFECTS)[number], number>>;
  pattern?: number;
  theme?: number;
  variation?: number;
}

const inboxPath = (): string => join(config.garageRoot, 'inbox.json');
const ackPath = (): string => join(config.garageRoot, 'inbox.ack.json');

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

// Two admins clicking at once must not both read the same inbox and each
// write back a version missing the other's command.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

function cleanReason(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw new ValidationError('reason must be text');
  // Shown to the player in chat: no control characters, bounded length.
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (text.length > MAX_REASON) throw new ValidationError(`reason is limited to ${MAX_REASON} characters`);
  return text;
}

/** Append one command to the inbox (serialized; ids only grow). */
function enqueue(next: NewCommand): Promise<InboxCommand> {
  return serialized(async () => {
    const inbox = (await readJson(inboxPath())) as { commands?: unknown } | null;
    const ack = (await readJson(ackPath())) as { lastId?: unknown } | null;
    const lastAck = typeof ack?.lastId === 'number' ? ack.lastId : 0;
    const now = Math.floor(Date.now() / 1000);

    const existing = Array.isArray(inbox?.commands) ? (inbox.commands as InboxCommand[]) : [];
    const maxId = existing.reduce((m, c) => (typeof c?.id === 'number' ? Math.max(m, c.id) : m), lastAck);

    // Drop what the mod has handled or can no longer run; keep the rest.
    const pending = existing.filter(
      (c) => typeof c?.id === 'number' && c.id > lastAck && c.expiresAt >= now,
    );
    const command = { ...next, id: maxId + 1, createdAt: now, expiresAt: now + COMMAND_TTL_SECONDS } as InboxCommand;
    pending.push(command);

    const tmp = `${inboxPath()}.tmp`;
    await writeFile(tmp, JSON.stringify({ commands: pending }, null, 2), 'utf8');
    await rename(tmp, inboxPath());
    return command;
  });
}

/**
 * Queue "remove this player's current dino". Resolves once the file is
 * written; bad input rejects (never throws synchronously).
 */
export type KillCommand = Extract<InboxCommand, { type: 'kill' }>;
export async function queueKill(steamId: string, reason: unknown): Promise<KillCommand> {
  assertSteamId(steamId);
  return (await enqueue({ type: 'kill', steamId, reason: cleanReason(reason) })) as KillCommand;
}

// One web-garage command per player every few seconds: the mod replies within
// one poll (2 s), so faster clicking only queues duplicates.
const PLAYER_COMMAND_GAP_MS = 4_000;
const lastPlayerCommand = new Map<string, number>();

export class TooSoonError extends Error {}

/**
 * Queue a player's own store / redeem, as if typed in chat. The SteamID must
 * be the player's own (the portal takes it from their Steam login).
 */
export async function queuePlayerCommand(
  steamId: string, action: unknown, args: { slot?: unknown; where?: unknown }, now = Date.now(),
): Promise<InboxCommand> {
  assertSteamId(steamId);
  if (action !== 'store' && action !== 'redeem') throw new ValidationError('action must be store or redeem');
  let slot: string | undefined;
  if (args.slot !== undefined && args.slot !== null && args.slot !== '') {
    if (typeof args.slot !== 'string') throw new ValidationError('slot must be text');
    assertSlot(args.slot);
    slot = args.slot;
  }
  let where: 'stored' | 'here' | undefined;
  if (args.where !== undefined && args.where !== null && args.where !== '') {
    if (args.where !== 'stored' && args.where !== 'here') throw new ValidationError('where must be stored or here');
    if (action === 'store') throw new ValidationError('where is only for redeem');
    where = args.where;
  }
  const last = lastPlayerCommand.get(steamId);
  if (last !== undefined && now - last < PLAYER_COMMAND_GAP_MS) throw new TooSoonError('one command every few seconds');
  lastPlayerCommand.set(steamId, now);
  if (lastPlayerCommand.size > 5000) lastPlayerCommand.clear();

  return action === 'store'
    ? enqueue({ type: 'store', steamId, slot: slot ?? 'default' })
    : enqueue({ type: 'redeem', steamId, ...(slot !== undefined ? { slot } : {}), ...(where !== undefined ? { where } : {}) });
}

/** Check a skin from the web: every colour channel 0–SKIN_CHANNEL_MAX, known regions only; effects 0–1; pattern / theme whole numbers; variation 0–100. */
export function validateSkin(raw: unknown): SkinRequest {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('skin must be an object');
  const r = raw as Record<string, unknown>;
  const colorsRaw = r['colors'];
  if (typeof colorsRaw !== 'object' || colorsRaw === null || Array.isArray(colorsRaw)) throw new ValidationError('colors must be an object');
  const colors: SkinRequest['colors'] = {};
  const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= SKIN_CHANNEL_MAX;
  for (const [k, v] of Object.entries(colorsRaw as Record<string, unknown>)) {
    if (!(SKIN_REGIONS as readonly string[]).includes(k)) throw new ValidationError(`unknown region "${k}"`);
    const c = v as Record<string, unknown> | null;
    if (typeof c !== 'object' || c === null || !unit(c['r']) || !unit(c['g']) || !unit(c['b'])) throw new ValidationError(`${k}: r, g, b must be 0–${SKIN_CHANNEL_MAX}`);
    colors[k as (typeof SKIN_REGIONS)[number]] = { r: Math.round(c['r'] * 10000) / 10000, g: Math.round(c['g'] * 10000) / 10000, b: Math.round(c['b'] * 10000) / 10000 };
  }
  if (Object.keys(colors).length === 0) throw new ValidationError('at least one colour');
  const out: SkinRequest = { colors };
  const effectsRaw = r['effects'];
  if (effectsRaw !== undefined && effectsRaw !== null) {
    if (typeof effectsRaw !== 'object' || Array.isArray(effectsRaw)) throw new ValidationError('effects must be an object');
    const effects: NonNullable<SkinRequest['effects']> = {};
    for (const [k, v] of Object.entries(effectsRaw as Record<string, unknown>)) {
      if (!(SKIN_EFFECTS as readonly string[]).includes(k)) throw new ValidationError(`unknown effect "${k}"`);
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw new ValidationError(`${k} must be 0–1`);
      effects[k as (typeof SKIN_EFFECTS)[number]] = Math.round(v * 1000) / 1000;
    }
    if (Object.keys(effects).length > 0) out.effects = effects;
  }
  for (const k of ['pattern', 'theme'] as const) {
    const v = r[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 20) throw new ValidationError(`${k} must be a whole number 0–20`);
    out[k] = v;
  }
  const variation = r['variation'];
  if (variation !== undefined && variation !== null) {
    if (typeof variation !== 'number' || !Number.isFinite(variation) || variation < 0 || variation > 100) throw new ValidationError('variation must be 0–100');
    out.variation = variation;
  }
  return out;
}

/** Queue a player's own skin onto the dino they play now (one command every few seconds, like the garage). */
export async function queueSkin(steamId: string, raw: unknown, now = Date.now()): Promise<InboxCommand> {
  assertSteamId(steamId);
  const skin = validateSkin(raw);
  const last = lastPlayerCommand.get(steamId);
  if (last !== undefined && now - last < PLAYER_COMMAND_GAP_MS) throw new TooSoonError('one command every few seconds');
  lastPlayerCommand.set(steamId, now);
  return enqueue({ type: 'skin', steamId, skin });
}

/**
 * Admin test (panel API only): a light attached to a player's dino, or taken
 * off it (mods/DinoGarage garage/light.lua) — to see whether a light the
 * server spawns shows on players' machines at night. Not for players.
 */
export async function queueLightTest(steamId: string, on: unknown): Promise<InboxCommand> {
  assertSteamId(steamId);
  if (typeof on !== 'boolean') throw new ValidationError('on must be true or false');
  return enqueue({ type: 'light', steamId, on });
}
