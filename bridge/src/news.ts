import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';

/**
 * Tin cập nhật (owner, 2026-10-07): the server's update notes, written in the panel (Tính năng mod → Tin cập nhật)
 * and shown on the launcher's Trang chủ, newest first. The panel saves the whole list at once (a settings page):
 * a new note gets its id and date here; an edited one keeps them.
 *
 *   data/news.json   { items: NewsItem[] }
 */

export interface NewsItem {
  id: string;
  title: string;
  /** Plain text; its line breaks are kept on the page. */
  body: string;
  /** Unix seconds, when it was first saved. */
  at: number;
  /** Shown on the page; a hidden note stays in the panel only. */
  shown: boolean;
}
export interface NewsSettings { items: NewsItem[] }

export const NEWS_LIMITS = { items: 50, title: 120, body: 3000 } as const;
/** How many notes a player gets (the newest shown ones). */
export const NEWS_FOR_PLAYERS = 10;

const path = (): string => join(config.dataDir, 'news.json');
const newId = (): string => `n_${randomBytes(4).toString('hex')}`;

function text(v: unknown, max: number, what: string, required: boolean): string {
  if (typeof v !== 'string') throw new ValidationError(`${what} must be text`);
  const t = v.replace(/\r\n?/g, '\n').trim();
  if (required && t === '') throw new ValidationError(`${what} is required`);
  if (t.length > max) throw new ValidationError(`${what} is too long (${max} characters at most)`);
  return t;
}

/** The list as the panel sent it, checked; new notes (no known id) get an id and now as their date. */
export function validateNews(raw: unknown, before: NewsSettings, now = Math.floor(Date.now() / 1000)): NewsSettings {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { items?: unknown }).items)) {
    throw new ValidationError('items must be a list');
  }
  const list = (raw as { items: unknown[] }).items;
  if (list.length > NEWS_LIMITS.items) throw new ValidationError(`at most ${NEWS_LIMITS.items} notes`);
  const known = new Map(before.items.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const items = list.map((v, i): NewsItem => {
    if (typeof v !== 'object' || v === null) throw new ValidationError(`note ${i + 1} must be an object`);
    const o = v as Record<string, unknown>;
    const title = text(o['title'], NEWS_LIMITS.title, `note ${i + 1}: the title`, true);
    const body = text(o['body'] ?? '', NEWS_LIMITS.body, `note ${i + 1}: the text`, false);
    const old = typeof o['id'] === 'string' ? known.get(o['id']) : undefined;
    const id = old && !seen.has(old.id) ? old.id : newId();
    seen.add(id);
    return { id, title, body, at: old?.at ?? now, shown: o['shown'] !== false };
  });
  return { items };
}

export async function readNews(): Promise<NewsSettings> {
  try {
    const raw = JSON.parse(await readFile(path(), 'utf8')) as { items?: unknown };
    return Array.isArray(raw.items) ? { items: raw.items as NewsItem[] } : { items: [] };
  } catch {
    return { items: [] };
  }
}

export async function saveNews(raw: unknown): Promise<NewsSettings> {
  const saved = validateNews(raw, await readNews());
  await mkdir(config.dataDir, { recursive: true });
  const tmp = `${path()}.tmp`;
  await writeFile(tmp, JSON.stringify(saved, null, 2), 'utf8');
  await rename(tmp, path());
  return saved;
}

/** What players see: the newest shown notes, only the fields the page needs. */
export function newsForPlayers(s: NewsSettings): Array<Pick<NewsItem, 'id' | 'title' | 'body' | 'at'>> {
  return s.items.filter((n) => n.shown).sort((a, b) => b.at - a.at).slice(0, NEWS_FOR_PLAYERS)
    .map(({ id, title, body, at }) => ({ id, title, body, at }));
}

/** The audit line: what was added, changed or removed. */
export function describeNewsChanges(before: NewsSettings, after: NewsSettings): string {
  const was = new Map(before.items.map((n) => [n.id, n]));
  const now = new Set(after.items.map((n) => n.id));
  const out: string[] = [];
  for (const n of after.items) {
    const b = was.get(n.id);
    if (!b) out.push(`thêm "${n.title}"`);
    else if (b.title !== n.title || b.body !== n.body || b.shown !== n.shown) out.push(`sửa "${n.title}"${b.shown !== n.shown ? (n.shown ? ' (hiện)' : ' (ẩn)') : ''}`);
  }
  for (const b of before.items) if (!now.has(b.id)) out.push(`xoá "${b.title}"`);
  return out.join(' · ');
}
