import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { assertSlot, assertSteamId, ValidationError } from './garage.js';

/**
 * Commands for the game, delivered through DinoGarage's inbox — the admin
 * "kill", and a player's own "store" / "redeem" from the web garage
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
  | CommandBase & { type: 'redeem'; slot?: string; where?: 'stored' | 'here' };
type NewCommand =
  | { type: 'kill'; steamId: string; reason: string }
  | { type: 'store'; steamId: string; slot: string }
  | { type: 'redeem'; steamId: string; slot?: string; where?: 'stored' | 'here' };

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
