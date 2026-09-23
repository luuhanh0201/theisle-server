import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { assertSteamId, ValidationError } from './garage.js';

/**
 * Admin commands for the game, delivered through DinoGarage's inbox
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

export interface InboxCommand {
  id: number;
  type: 'kill';
  steamId: string;
  reason: string;
  createdAt: number;
  expiresAt: number;
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

/**
 * Queue "remove this player's current dino". Resolves once the file is
 * written; bad input rejects (never throws synchronously).
 */
export async function queueKill(steamId: string, reason: unknown): Promise<InboxCommand> {
  assertSteamId(steamId);
  const text = cleanReason(reason);

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
    const command: InboxCommand = {
      id: maxId + 1,
      type: 'kill',
      steamId,
      reason: text,
      createdAt: now,
      expiresAt: now + COMMAND_TTL_SECONDS,
    };
    pending.push(command);

    const tmp = `${inboxPath()}.tmp`;
    await writeFile(tmp, JSON.stringify({ commands: pending }, null, 2), 'utf8');
    await rename(tmp, inboxPath());
    return command;
  });
}
