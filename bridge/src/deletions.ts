import { createHash } from 'node:crypto';
import { copyFile, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';

/**
 * What the super admin deletes on the panel (2026-10-02; no other admin sees
 * the buttons, and the routes are the super admin's only, permissions.ts):
 *
 *   chat lines   the chat comes from the game's events, read again at every
 *                bridge start, so it is not cut out of them: the lines deleted
 *                are kept in data/hidden-chat.json and left out wherever the
 *                panel shows chat (Chat, the feed, a player's timeline).
 *   admin log    the lines are taken out of data/admin-audit.ndjson; a copy of
 *                the file is kept first (admin-audit.ndjson.bak-del-<time>,
 *                the newest BACKUPS of them).
 *
 * Neither leaves a line in the admin log (the owner's call). A line is named by
 * a key of what it holds (time, who, what): stable across restarts.
 */

const BACKUPS = 10;
const sha = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 12);

/** A chat line's key: its time, player and text. */
export const chatKey = (e: { t: number; steamId?: unknown; message?: unknown }): string =>
  `c${e.t}-${sha(`${String(e.steamId ?? '')}|${String(e.message ?? '')}`)}`;
/** An admin log line's key: its time, action, admin and detail. */
export const auditKey = (e: { t: number; action: string; byId?: string | null; detail?: string }): string =>
  `a${e.t}-${sha(`${e.action}|${e.byId ?? ''}|${e.detail ?? ''}`)}`;

const hiddenPath = (): string => join(config.dataDir, 'hidden-chat.json');
let hidden: Set<string> | null = null;

/** The chat keys deleted (read once, then kept in memory). */
export async function hiddenChat(): Promise<Set<string>> {
  if (hidden !== null) return hidden;
  try {
    const d = JSON.parse(await readFile(hiddenPath(), 'utf8')) as { keys?: unknown };
    hidden = new Set(Array.isArray(d.keys) ? d.keys.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    hidden = new Set();
  }
  return hidden;
}
/** Synchronous view, once loaded (index.ts loads it at start): empty before. */
export const isHiddenChat = (e: { type?: unknown; t: number; steamId?: unknown; message?: unknown }): boolean =>
  e.type === 'chat' && hidden !== null && hidden.has(chatKey(e));

export async function hideChat(keys: readonly string[]): Promise<number> {
  const set = await hiddenChat();
  const before = set.size;
  for (const k of keys) if (/^c\d+-[0-9a-f]{12}$/.test(k)) set.add(k);
  const tmp = `${hiddenPath()}.tmp`;
  await writeFile(tmp, JSON.stringify({ keys: [...set] }), 'utf8');
  await rename(tmp, hiddenPath());
  return set.size - before;
}

/** For tests: forget what was read. */
export function resetHiddenChat(): void { hidden = null; }

/** Take admin log lines out by key; a copy of the file first. Returns how many went. */
export async function deleteAuditLines(keys: readonly string[], now = Date.now()): Promise<number> {
  const want = new Set(keys.filter((k) => /^a\d+-[0-9a-f]{12}$/.test(k)));
  if (want.size === 0) return 0;
  const file = join(config.dataDir, 'admin-audit.ndjson');
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch { return 0; }
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const kept = lines.filter((l) => {
    try {
      const e = JSON.parse(l) as { t: number; action: string; byId?: string | null; detail?: string };
      return !want.has(auditKey(e));
    } catch { return true; }
  });
  const gone = lines.length - kept.length;
  if (gone === 0) return 0;
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').slice(0, 15);
  await copyFile(file, `${file}.bak-del-${stamp}`);
  // The oldest copies go.
  const copies = (await readdir(config.dataDir)).filter((n) => n.startsWith('admin-audit.ndjson.bak-del-')).sort();
  for (const n of copies.slice(0, Math.max(0, copies.length - BACKUPS))) await unlink(join(config.dataDir, n)).catch(() => undefined);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, kept.map((l) => `${l}\n`).join(''), 'utf8');
  await rename(tmp, file);
  return gone;
}
