import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson } from '@isle/api';
import { useSession } from '../../app/session';
import { getDraft, setDraft } from './drafts';

/** Same content, whatever order an object's keys came in (a text removed then written again). */
const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon)
  : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/**
 * A settings page (AGENTS.md "Panel refresh"): loaded once per visit, never overwritten while the
 * admin edits; the server's copy is still checked every 2 s, and when it changes (another admin,
 * the game) `serverChanged` turns on for the "Có thay đổi mới" bar. Edits survive leaving the page.
 *
 *   const f = useSettingsForm<TeleSettings>('/api/tele-settings', { label: 'Tele con non', href: '#mods/tele' });
 *   f.draft.maxGrowthPct, f.set('maxGrowthPct', 50), f.update((d) => …), f.save(), f.dirty, f.serverChanged, f.reload()
 *
 * `toBody` picks what is sent (a GET may carry more than the PUT takes, e.g. a catalog). After a
 * save the server's copy is read again: what the GET says is what the form now holds.
 */
export function useSettingsForm<T extends object>(url: string, page: { label: string; href: string; toBody?: (draft: T) => unknown }) {
  const { withToken } = useSession();
  const qc = useQueryClient();
  const pick = page.select ?? ((r: R) => r as unknown as T);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const q = useQuery({ queryKey: [url], queryFn: () => getJson<R>(url), refetchInterval: 2000 });
  const server = q.data === undefined ? undefined : pickRef.current(q.data);
  // What the form was loaded from, and what the admin made of it.
  const [base, setBase] = useState<T | null>(null);
  const [draft, setDraftState] = useState<T | null>(() => (getDraft(url) as T | undefined) ?? null);
  const [saving, setSaving] = useState(false);
  // A save of this admin's own: the copy coming back is theirs, not "a change from the server".
  const mineUntil = useRef(0);

  useEffect(() => {
    if (q.data === undefined || base !== null) return;
    const data = pickRef.current(q.data);
    setBase(data);
    setDraftState((d) => d ?? data);
  }, [q.data, base]);

  const dirty = base !== null && draft !== null && !same(draft, base);
  const serverChanged = base !== null && server !== undefined && !same(server, base) && Date.now() > mineUntil.current;

  const save = useCallback(async (): Promise<boolean> => {
    if (draft === null) return false;
    setSaving(true);
    try {
      return await withToken(`lưu ${page.label}`, async (token) => {
        await adminFetch<unknown>(url, 'PUT', token, page.toBody ? page.toBody(draft) : draft);
        mineUntil.current = Date.now() + 15_000;
        const fresh = await qc.fetchQuery({ queryKey: [url], queryFn: () => getJson<T>(url), staleTime: 0 });
        setBase(fresh);
        setDraftState(fresh);
      });
    } finally {
      setSaving(false);
    }
  }, [draft, withToken, page, url, qc]);

  // Kept outside the page while unsaved: the draft, and how to save it from the unsaved bar.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    setDraft(url, dirty ? { label: page.label, href: page.href, value: draft, save: () => void saveRef.current() } : null);
  }, [url, dirty, draft, page.label, page.href]);

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setDraftState((d) => (d === null ? d : { ...d, [key]: value }));
  }, []);

  const update = useCallback((fn: (d: T) => T) => {
    setDraftState((d) => (d === null ? d : fn(d)));
  }, []);

  /** Take the server's copy (dropping unsaved edits). */
  const reload = useCallback(() => {
    if (q.data === undefined) return;
    const data = pickRef.current(q.data);
    setBase(data);
    setDraftState(data);
  }, [q.data]);

  return { draft, set, update, dirty, saving, save, serverChanged, reload, error: base === null ? (q.error as Error | null) : null };
}
