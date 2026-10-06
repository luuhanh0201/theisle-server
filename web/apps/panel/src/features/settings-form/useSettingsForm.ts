import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson } from '@isle/api';
import { useSession } from '../../app/session';
import { getDraft, setDraft } from './drafts';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * A settings page (AGENTS.md "Panel refresh"): loaded once per visit, never overwritten while the
 * admin edits; the server's copy is still checked every 2 s, and when it changes (another admin,
 * the game) `serverChanged` turns on for the "Có thay đổi mới" bar. Edits survive leaving the page.
 *
 *   const f = useSettingsForm<TeleSettings>('/api/tele-settings', { label: 'Tele con non', href: '#mods/tele' });
 *   f.draft.maxGrowthPct, f.set('maxGrowthPct', 50), f.save(), f.dirty, f.serverChanged, f.reload()
 */
export function useSettingsForm<T extends object>(url: string, page: { label: string; href: string }) {
  const { withToken } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [url], queryFn: () => getJson<T>(url), refetchInterval: 2000 });
  // What the form was loaded from, and what the admin made of it.
  const [base, setBase] = useState<T | null>(null);
  const [draft, setDraftState] = useState<T | null>(() => (getDraft(url) as T | undefined) ?? null);
  const [saving, setSaving] = useState(false);
  // A save of this admin's own: the copy coming back is theirs, not "a change from the server".
  const mineUntil = useRef(0);

  useEffect(() => {
    const data = q.data;
    if (data === undefined || base !== null) return;
    setBase(data);
    setDraftState((d) => d ?? data);
  }, [q.data, base]);

  const dirty = base !== null && draft !== null && !same(draft, base);
  const serverChanged = base !== null && q.data !== undefined && !same(q.data, base) && Date.now() > mineUntil.current;

  const save = useCallback(async (): Promise<boolean> => {
    if (draft === null) return false;
    setSaving(true);
    try {
      return await withToken(`lưu ${page.label}`, async (token) => {
        const saved = await adminFetch<T>(url, 'PUT', token, draft);
        mineUntil.current = Date.now() + 15_000;
        qc.setQueryData([url], saved);
        setBase(saved);
        setDraftState(saved);
      });
    } finally {
      setSaving(false);
    }
  }, [draft, withToken, page.label, url, qc]);

  // Kept outside the page while unsaved: the draft, and how to save it from the unsaved bar.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    setDraft(url, dirty ? { label: page.label, href: page.href, value: draft, save: () => void saveRef.current() } : null);
  }, [url, dirty, draft, page.label, page.href]);

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setDraftState((d) => (d === null ? d : { ...d, [key]: value }));
  }, []);

  /** Take the server's copy (dropping unsaved edits). */
  const reload = useCallback(() => {
    if (q.data === undefined) return;
    setBase(q.data);
    setDraftState(q.data);
  }, [q.data]);

  return { draft, set, dirty, saving, save, serverChanged, reload, error: base === null ? (q.error as Error | null) : null };
}
