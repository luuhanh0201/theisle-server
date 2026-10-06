import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson } from '@isle/api';
import { useToast } from '@isle/ui';
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
 *   const f = useSettingsForm<TeleSettings>('/api/tele-settings', { label: 'Tele con non', href: '#mods/tele', saved: 'Đã lưu.' });
 *   f.draft.maxGrowthPct, f.set('maxGrowthPct', 50), f.update((d) => …), f.save(), f.dirty, f.serverChanged, f.reload()
 *
 * R is what the GET answers, T what the form edits (R itself unless `select` picks it out: a GET
 * with a status or a catalog beside the settings). `latest` is the last GET, whole (live numbers).
 * `toBody` turns the draft into what the PUT takes. `saved`: the toast after a save (a text, or one
 * made from the PUT's answer). After a save the GET is read again: what it says is what the form holds.
 */
export function useSettingsForm<R extends object, T extends object = R>(url: string, page: {
  label: string; href: string; select?: (raw: R) => T; toBody?: (draft: T) => unknown; saved?: string | ((answer: unknown) => string);
}) {
  const { withToken } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const pageRef = useRef(page);
  pageRef.current = page;
  const pick = useCallback((r: R): T => (pageRef.current.select ? pageRef.current.select(r) : (r as unknown as T)), []);
  const q = useQuery({ queryKey: [url], queryFn: () => getJson<R>(url), refetchInterval: 2000 });
  const server = q.data === undefined ? undefined : pick(q.data);
  // What the form was loaded from, and what the admin made of it.
  const [base, setBase] = useState<T | null>(null);
  const [draft, setDraftState] = useState<T | null>(() => (getDraft(url) as T | undefined) ?? null);
  const [saving, setSaving] = useState(false);
  // A save of this admin's own: the copy coming back is theirs, not "a change from the server".
  const mineUntil = useRef(0);

  useEffect(() => {
    if (q.data === undefined || base !== null) return;
    const data = pick(q.data);
    setBase(data);
    setDraftState((d) => d ?? data);
  }, [q.data, base, pick]);

  const dirty = base !== null && draft !== null && !same(draft, base);
  const serverChanged = base !== null && server !== undefined && !same(server, base) && Date.now() > mineUntil.current;

  const save = useCallback(async (): Promise<boolean> => {
    if (draft === null) return false;
    const p = pageRef.current;
    setSaving(true);
    try {
      return await withToken(`lưu ${p.label}`, async (token) => {
        const answer = await adminFetch<unknown>(url, 'PUT', token, p.toBody ? p.toBody(draft) : draft);
        mineUntil.current = Date.now() + 15_000;
        const fresh = pick(await qc.fetchQuery({ queryKey: [url], queryFn: () => getJson<R>(url), staleTime: 0 }));
        setBase(fresh);
        setDraftState(fresh);
        if (p.saved !== undefined) toast(typeof p.saved === 'string' ? p.saved : p.saved(answer));
      });
    } finally {
      setSaving(false);
    }
  }, [draft, withToken, url, qc, pick, toast]);

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
    const data = pick(q.data);
    setBase(data);
    setDraftState(data);
  }, [q.data, pick]);

  return { draft, set, update, latest: q.data, dirty, saving, save, serverChanged, reload, error: base === null ? (q.error as Error | null) : null };
}
