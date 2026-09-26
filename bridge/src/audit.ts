import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFile, readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';

/**
 * Log of every admin action taken through the panel, and of every login: who
 * (SteamID + name of the admin logged in with Steam; "ADMIN_TOKEN" for a
 * script on the server), what (with the values it changed, old → new),
 * when, and whether it worked. One JSON object per line in
 * DATA_DIR/admin-audit.ndjson. Kept 7 days: older lines are dropped from
 * the file (checked at most once an hour, and at start).
 */

export interface Actor {
  /** SteamID64, or null for a script using ADMIN_TOKEN. */
  steamId: string | null;
  name: string | null;
}

/** Who the current request is acting as, set once per request by server.ts. */
export const actingAs = new AsyncLocalStorage<Actor>();

export interface AuditEntry {
  t: number;
  action: string;
  detail?: string;
  ok: boolean;
  error?: string;
  /** "Name (SteamID)" of the admin, or "ADMIN_TOKEN" — the line as a person reads it. */
  by?: string;
  byId?: string | null;
  byName?: string | null;
}

/** Told of every audit line written (the Discord log: discord.ts). */
export const auditListeners: Array<(entry: AuditEntry) => void> = [];

export const RETAIN_DAYS = 7;
const RETAIN_S = RETAIN_DAYS * 86_400;
const PRUNE_EVERY_S = 3_600;
const path = (): string => join(config.dataDir, 'admin-audit.ndjson');
let lastPrune = 0;

export const actorLabel = (a: Actor): string => (a.steamId === null ? 'ADMIN_TOKEN' : `${a.name ?? '?'} (${a.steamId})`);

/** Record an action. `as`: who, when not the request's admin (a login, before there is one). */
export async function audit(entry: Omit<AuditEntry, 't' | 'by' | 'byId' | 'byName'>, as?: Actor): Promise<void> {
  const actor = as ?? actingAs.getStore();
  const now = Math.floor(Date.now() / 1000);
  const line: AuditEntry = {
    t: now, ...entry,
    ...(actor ? { by: actorLabel(actor), byId: actor.steamId, byName: actor.name } : {}),
  };
  try {
    await mkdir(config.dataDir, { recursive: true });
    await appendFile(path(), JSON.stringify(line) + '\n', 'utf8');
    if (now - lastPrune >= PRUNE_EVERY_S) await pruneAudit(now);
  } catch (error) {
    // Losing an audit line must not fail the action it describes.
    console.error('[audit] could not write:', error);
  }
  for (const listener of auditListeners) {
    try { listener(line); } catch (error) { console.error('[audit] listener failed:', error); }
  }
  console.info(`[audit] ${line.by ? `${line.by}: ` : ''}${line.action}${line.detail ? ` (${line.detail})` : ''}: ${line.ok ? 'ok' : `FAILED ${line.error ?? ''}`}`);
}

/** Drop lines older than RETAIN_DAYS from the file. */
export async function pruneAudit(now = Math.floor(Date.now() / 1000)): Promise<number> {
  lastPrune = now;
  let text: string;
  try {
    text = await readFile(path(), 'utf8');
  } catch {
    return 0;
  }
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const keep = lines.filter((l) => {
    try { return (JSON.parse(l) as AuditEntry).t >= now - RETAIN_S; } catch { return false; }
  });
  if (keep.length === lines.length) return 0;
  const tmp = `${path()}.tmp`;
  await writeFile(tmp, keep.map((l) => `${l}\n`).join(''), 'utf8');
  await rename(tmp, path());
  return lines.length - keep.length;
}

async function readAll(now: number): Promise<AuditEntry[]> {
  let text: string;
  try {
    text = await readFile(path(), 'utf8');
  } catch {
    return [];
  }
  const out: AuditEntry[] = [];
  const lines = text.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const e = JSON.parse(lines[i] as string) as AuditEntry;
      if (e.t >= now - RETAIN_S) out.push(e);
    } catch {
      /* a torn line is skipped */
    }
  }
  return out;
}

/** Newest first. */
export async function readAudit(limit = 100): Promise<AuditEntry[]> {
  return (await readAll(Math.floor(Date.now() / 1000))).slice(0, limit);
}

/** One page, newest first; `q` filters on the action, detail and who. */
export async function readAuditPage(page: number, per: number, q = '', now = Math.floor(Date.now() / 1000)): Promise<{
  entries: AuditEntry[]; total: number; page: number; pages: number; per: number; retainDays: number;
}> {
  let all = await readAll(now);
  const needle = q.trim().toLowerCase();
  if (needle) {
    all = all.filter((e) => [e.action, e.detail, e.by, e.error].some((v) => typeof v === 'string' && v.toLowerCase().includes(needle)));
  }
  const pages = Math.max(1, Math.ceil(all.length / per));
  const p = Math.min(Math.max(1, page), pages);
  return { entries: all.slice((p - 1) * per, p * per), total: all.length, page: p, pages, per, retainDays: RETAIN_DAYS };
}

// --- what changed ------------------------------------------------------------------

const show = (v: unknown): string => {
  if (v === undefined || v === null) return '(mặc định)';
  if (typeof v === 'string') return v === '' ? '""' : v;
  return JSON.stringify(v);
};

/**
 * "Key: old → new" for every key whose value changed; lists say what was
 * added and removed. Used for the detail of a settings save.
 */
export function describeChanges(before: Record<string, unknown>, after: Record<string, unknown>): string {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const parts: string[] = [];
  for (const k of keys) {
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (Array.isArray(a) || Array.isArray(b)) {
      const from = new Set((Array.isArray(a) ? a : []).map(String));
      const to = new Set((Array.isArray(b) ? b : []).map(String));
      const added = [...to].filter((x) => !from.has(x));
      const removed = [...from].filter((x) => !to.has(x));
      parts.push(`${k}: ${[added.length ? `+${added.join(', +')}` : '', removed.length ? `−${removed.join(', −')}` : ''].filter(Boolean).join(' ') || 'đổi thứ tự'}`);
    } else if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
      const inner = describeChanges(a as Record<string, unknown>, b as Record<string, unknown>);
      if (inner) parts.push(`${k} { ${inner} }`);
    } else {
      parts.push(`${k}: ${show(a)} → ${show(b)}`);
    }
  }
  return parts.join(' · ');
}
