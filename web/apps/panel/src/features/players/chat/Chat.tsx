import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson } from '@isle/api';
import { Button, Card, CardBody, CardHead, Checkbox, useToast } from '@isle/ui';
import { useConfirm } from '../../../app/confirm';
import { useSession } from '../../../app/session';
import { Avatar, PlayerLink } from '../../../components/dino/Identity';
import { ListTools, Pager, Pill, pageOf } from '../../../components/list/List';
import { clock, dateTime } from '../../../lib/format';
import s from './Chat.module.css';

/** A chat line; `key` only reaches the super admin (it is what a delete names). */
export interface ChatLine { id: number; t: number; steamId: string; name: string | null; message: string; key?: string }
const URL = '/api/chat?limit=300';
const LIMIT = 20;
export const chatMatch = (e: ChatLine, q: string): boolean => {
  const n = q.trim().toLowerCase();
  return !n || [e.message ?? '', e.name ?? '', e.steamId].some((v) => v.toLowerCase().includes(n));
};

/** Người chơi → Chat: the last 300 lines, searched, 20 a page; the super admin may delete lines. */
export function Chat() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { me } = useSession();
  const q = useQuery({ queryKey: [URL], queryFn: () => getJson<{ events: ChatLine[] }>(URL), refetchInterval: 2000 });
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  // The super admin's ticked lines (keys), kept across pages.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const all = q.data?.events ?? [];
  const rows = all.filter((e) => chatMatch(e, text));
  const shown = pageOf(rows, page, LIMIT);
  const canDel = me?.super === true && all.some((e) => e.key);
  const pageKeys = shown.rows.map((e) => e.key).filter((k): k is string => !!k);
  const pick = (k: string, on: boolean): void => setPicked((p) => { const n = new Set(p); if (on) n.add(k); else n.delete(k); return n; });
  const del = (keys: string[]): void => confirm({
    title: `Xoá ${keys.length} tin chat?`, body: 'Tin bị xoá khỏi panel (trang Chat, feed, lịch sử người chơi). Không ghi vào nhật ký admin.', okLabel: 'Xoá',
    run: async (token) => {
      await adminFetch('/api/chat/delete', 'POST', token, { keys });
      const gone = new Set(keys);
      qc.setQueryData<{ events: ChatLine[] }>([URL], (d) => (d ? { events: d.events.filter((e) => !e.key || !gone.has(e.key)) } : d));
      setPicked((p) => new Set([...p].filter((k) => !gone.has(k))));
      toast(`Đã xoá ${keys.length} tin`);
    },
  });
  return (
    <Card>
      <CardHead title="Chat trong game" sub={`Tổng cộng ${all.length} tin nhắn`}><Pill>{rows.length} tin nhắn</Pill></CardHead>
      <CardBody>
        <ListTools q={text} onQ={(v) => { setText(v); setPage(1); }} placeholder="Tìm theo nội dung chat, tên người chơi hoặc SteamID…" />
        {canDel && (
          <div className={s.delBar}>
            <Checkbox label="Chọn cả trang" checked={pageKeys.length > 0 && pageKeys.every((k) => picked.has(k))}
              onChange={(on) => setPicked((p) => { const n = new Set(p); for (const k of pageKeys) { if (on) n.add(k); else n.delete(k); } return n; })} />
            <span className={s.muted}>{picked.size} tin đã chọn</span>
            <Button variant="danger" small className={s.right} disabled={picked.size === 0} onClick={() => del([...picked])}>Xoá đã chọn</Button>
          </div>
        )}
        <ul className={s.list}>
          {shown.rows.length === 0 && <li className={s.empty}>{q.isLoading ? 'Đang tải…' : text ? 'Không tìm thấy tin nhắn nào' : 'Chưa có tin chat'}</li>}
          {shown.rows.map((e) => (
            <li key={e.id}>
              {me?.super && e.key && <span className={s.pick}><Checkbox label={<span className={s.sr}>Chọn tin này</span>} checked={picked.has(e.key)} onChange={(on) => pick(e.key!, on)} /></span>}
              <Avatar id={e.steamId} name={e.name} />
              <div className={`${s.bubble}${/^\s*!/.test(e.message) ? ` ${s.cmd}` : ''}`}>
                <div className={s.top}><PlayerLink id={e.steamId} name={e.name} /><span className={s.muted} title={dateTime(e.t)}>{clock(e.t)}</span></div>
                <div className={s.txt}>{e.message}</div>
              </div>
              {me?.super && e.key && <button type="button" className={s.delOne} title="Xoá tin này" aria-label="Xoá tin này" onClick={() => del([e.key!])}>🗑</button>}
            </li>
          ))}
        </ul>
        <Pager total={rows.length} page={shown.page} limit={LIMIT} unit="tin nhắn" onPage={setPage} />
      </CardBody>
    </Card>
  );
}
