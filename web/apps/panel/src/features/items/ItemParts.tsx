import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson, type PlayerRow } from '@isle/api';
import { Button, SuggestInput, TextInput, useToast } from '@isle/ui';
import { useConfirm } from '../../app/confirm';
import { can } from '../../app/nav';
import { useSession } from '../../app/session';
import { dateTime, dinoName } from '../../lib/format';
import { ITEMS_URL, SOURCE, type Item, type Owner, type Rarity } from './items';
import s from './Items.module.css';

/** One item in the left list: its name, rarity badge (and the row's rarity frame), a line under it. */
export function ItemRow({ item, rarities, on, onPick, top, sub }: {
  item: Item; rarities: Rarity[]; on: boolean; onPick: () => void; top?: ReactNode; sub: ReactNode;
}) {
  const label = rarities.find((r) => r.key === item.rarity)?.label ?? item.rarity;
  return (
    <button type="button" className={`${s.row} ${s[`r-${item.rarity}`] ?? ''}${on ? ` ${s.on}` : ''}`} onClick={onPick} aria-pressed={on}>
      <span className={s.top}>{top}<b>{item.name}</b><span className={`${s.rar} ${s[item.rarity] ?? ''}`}>{label}</span></span>
      {sub}
    </button>
  );
}
export const Retired = ({ item }: { item: Item }) => (item.retired ? <> · <span className={s.kill}>ngừng phát hành</span></> : null);

/** The editor's foot: unsaved or saved, (re)issue, copy, save. */
export function EditorActions({ edit, item, dirty, sel, onRetire, onSave, saveLabel, extra }: {
  edit: boolean; item: Item | null; dirty: boolean; sel: string | null; onRetire: () => void; onSave: () => void; saveLabel: string; extra?: ReactNode;
}) {
  return (
    <div className={s.actions}>
      <span className={s.dirty}>{dirty ? '● Có thay đổi chưa lưu' : sel ? 'Đã lưu' : ''}</span>
      {edit && item && <Button variant="ghost" onClick={onRetire}>{item.retired ? 'Phát hành lại' : 'Ngừng phát hành'}</Button>}
      {extra}
      {edit && <Button onClick={onSave}>{saveLabel}</Button>}
    </div>
  );
}

/** The players to give to (SteamID or a name): every player the panel has seen. */
export function usePlayerSuggestions() {
  const { access } = useSession();
  const on = can(access, 'items.grant') && can(access, 'players.view');
  const players = useQuery({ queryKey: ['/api/players'], queryFn: () => getJson<{ players: PlayerRow[] }>('/api/players'), enabled: on, staleTime: 60_000 }).data?.players ?? [];
  return players.map((x) => ({ value: x.steamId, label: `${x.name ?? ''} · ${dinoName(x.species)}` }));
}

/** The owners of `item`, read when it is selected (a row a copy). */
export function useOwners(itemId: string | null) {
  const url = `${ITEMS_URL}/${itemId}/owners`;
  return useQuery({ queryKey: [url], queryFn: () => getJson<{ owners: Owner[] }>(url).catch(() => ({ owners: [] as Owner[] })), enabled: itemId !== null, refetchInterval: 30_000 });
}

/** Người sở hữu: give one (SteamID or a name picked, a note), and the list with its own buttons. */
export function OwnersBox({ itemId, count, grantLabel, granted, notePlaceholder, extraGrant, children }: {
  itemId: string; count: string; grantLabel: string; granted: string; notePlaceholder: string;
  extraGrant?: (steamId: string) => ReactNode; children: ReactNode;
}) {
  const { access, withToken } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const suggestions = usePlayerSuggestions();
  const grant = can(access, 'items.grant');
  // Who to give to and why (emptied after a gift).
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const give = (): void => {
    void withToken(grantLabel.toLowerCase(), async (token) => {
      await adminFetch(`${ITEMS_URL}/${itemId}/grant`, 'POST', token, { steamId: to.trim(), note });
      toast(granted);
      setTo(''); setNote('');
      await qc.invalidateQueries({ queryKey: [ITEMS_URL] });
      await qc.invalidateQueries({ queryKey: [`${ITEMS_URL}/${itemId}/owners`] });
    });
  };
  return (
    <div className={s.own}>
      <h3>Người sở hữu <span>{count}</span></h3>
      {grant && (
        <div className={s.grant}>
          <SuggestInput aria-label="Người nhận" placeholder="SteamID64 hoặc chọn tên" value={to} onChange={setTo} suggestions={suggestions} />
          <TextInput aria-label="Ghi chú" maxLength={200} placeholder={notePlaceholder} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button onClick={give}>{grantLabel}</Button>
          {extraGrant?.(to.trim())}
        </div>
      )}
      <div className={s.owners}>{children}</div>
    </div>
  );
}

/** An owner's row: who, how it came, when, a note, and the page's buttons. */
export function OwnerRow({ o, n, actions, showSource = true }: { o: Owner; n?: number; actions?: ReactNode; showSource?: boolean }) {
  return (
    <div className={s.owner}>
      <div className={s.who}><b>{o.name ?? 'Chưa rõ tên'}{n !== undefined ? ` × ${n}` : ''}</b><span>{o.steamId}</span></div>
      <span className={s.muted}>{showSource ? `${SRC(o.source)} · ` : ''}{dateTime(o.grantedAt)}{o.note ? ` · ${o.note}` : ''}</span>
      {actions}
    </div>
  );
}
const SRC = (k: string): string => SOURCE[k] ?? k;

/** Revoke every copy a player holds, asked first. */
export function useRevoke(itemId: string | null) {
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  return (steamId: string, title: string, body: ReactNode): void => confirm({
    title, okLabel: 'Thu hồi', body,
    run: async (token) => {
      await adminFetch(`${ITEMS_URL}/${itemId}/grant/${steamId}`, 'DELETE', token);
      toast('Đã thu hồi');
      await qc.invalidateQueries({ queryKey: [ITEMS_URL] });
      await qc.invalidateQueries({ queryKey: [`${ITEMS_URL}/${itemId}/owners`] });
    },
  });
}
