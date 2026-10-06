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
 *   f.draft.maxGrowthPct, f.set('maxGrowthPct', 50), f.save(), f.dirty, f.serverChanged, f.reload()
 *
 * When the GET carries more than the PUT takes (a status line, a catalog), `select` picks the
 * editable part out of both the GET and the PUT's answer; `raw` is the latest GET, whole.
 */
export function useSettingsForm<T extends object, R = T>(url: string, page: { label: string; href: string; select?: (raw: R) => T }) {
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
        const saved = pickRef.current(await adminFetch<R>(url, 'PUT', token, draft));
        mineUntil.current = Date.now() + 15_000;
        // The GET's other parts (status, catalog) stay as they were until its next answer.
        qc.setQueryData<R>([url], (old) => (old === undefined ? old : ({ ...(old as object), ...saved } as unknown as R)));
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
    const data = pickRef.current(q.data);
    setBase(data);
    setDraftState(data);
  }, [q.data]);

  /** Change the draft with a function of it (a list's item, a text inside an object). */
  const update = useCallback((fn: (d: T) => T) => {
    setDraftState((d) => (d === null ? d : fn(d)));
  }, []);

  return { draft, set, update, base, raw: q.data, dirty, saving, save, serverChanged, reload, error: base === null ? (q.error as Error | null) : null };
}
