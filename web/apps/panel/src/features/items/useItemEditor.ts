import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { adminFetch } from '@isle/api';
import { useToast } from '@isle/ui';
import { useConfirm } from '../../app/confirm';
import { useSession } from '../../app/session';
import { ITEMS_URL, type Item } from './items';

interface EditorState<D> { sel: string | null; draft: D | null; saved: string | null }
/** Each page's editor, kept while the admin goes elsewhere and back (as the panel before React). */
const kept = new Map<string, EditorState<unknown>>();

/**
 * One item being edited (Skin, Mutation, Phiếu): which is selected, its draft, unsaved or not;
 * another one picked while unsaved asks first; saving creates (POST) or updates (PUT) and reselects.
 */
export function useItemEditor<D extends { name: string }>(key: string, items: Item[] | undefined, opts: {
  first: (items: Item[]) => Item | undefined; toDraft: (item: Item) => D; fresh: () => D; what: string;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const { withToken } = useSession();
  const [st, setSt] = useState<EditorState<D>>(() => (kept.get(key) as EditorState<D> | undefined) ?? { sel: null, draft: null, saved: null });
  useEffect(() => { kept.set(key, st); }, [key, st]);
  const dirty = st.draft !== null && JSON.stringify(st.draft) !== st.saved;
  const item = st.sel ? items?.find((i) => i.id === st.sel) ?? null : null;

  const load = (it: Item | null): void => {
    const draft = it ? opts.toDraft(it) : opts.fresh();
    setSt({ sel: it?.id ?? null, draft, saved: it ? JSON.stringify(draft) : null });
  };
  // The first one, once the list is there.
  useEffect(() => {
    if (st.draft === null && items !== undefined) load(opts.first(items) ?? null);
  }, [items, st.draft]);

  const select = (id: string | null): void => {
    const go = (): void => load(id ? items?.find((i) => i.id === id) ?? null : null);
    if (!dirty) { go(); return; }
    confirm({
      title: 'Bỏ thay đổi chưa lưu?', okLabel: 'Bỏ thay đổi',
      body: `${opts.what} đang sửa có thay đổi chưa lưu.${key === 'skin' ? ' Chuyển sang skin khác sẽ mất các thay đổi đó.' : ''}`,
      run: async () => go(),
    });
  };
  const setDraft = (fn: (d: D) => D): void => setSt((s) => (s.draft === null ? s : { ...s, draft: fn(s.draft) }));
  /** Create or update; the saved item is selected (its draft as the bridge kept it). */
  const save = (body: object, id: string | null, said: string | ((it: Item) => string)): Promise<boolean> => withToken(`lưu ${opts.what.toLowerCase()}`, async (token) => {
    const r = id ? await adminFetch<{ item: Item }>(`${ITEMS_URL}/${id}`, 'PUT', token, body) : await adminFetch<{ item: Item }>(ITEMS_URL, 'POST', token, body);
    load(r.item);
    await qc.invalidateQueries({ queryKey: [ITEMS_URL] });
    toast(typeof said === 'string' ? said : said(r.item));
  });
  const retire = (): void => {
    if (!item) return;
    void save({ type: item.type, name: item.name, rarity: item.rarity, data: item.data, retired: !item.retired }, item.id,
      item.retired ? 'Đã phát hành lại' : 'Đã ngừng phát hành, người đã có vẫn giữ');
  };
  /** A copy, unsaved (Skin → Tạo bản sao). */
  const copy = (d: D): void => setSt({ sel: null, draft: d, saved: null });
  return { sel: st.sel, item, draft: st.draft, dirty, select, setDraft, save, retire, copy };
}

/** For tests: forget the editors. */
export function clearItemEditors(): void { kept.clear(); }
