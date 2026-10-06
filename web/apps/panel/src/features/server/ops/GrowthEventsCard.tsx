import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson, type GrowthEvents } from '@isle/api';
import { Button, Card, CardBody, CardHead, DateTimeInput, NumberInput, TextInput, useToast } from '@isle/ui';
import { useConfirm } from '../../../app/confirm';
import { useSession } from '../../../app/session';
import { can } from '../../../app/nav';
import s from './Ops.module.css';

const URL = '/api/server/growth-events';
const geTime = (t: number): string => new Date(t * 1000).toLocaleString('vi-VN', { hour12: false, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
/** A moment (ms) as the date box's value, local time: "2026-10-10T00:00". */
const local = (ms: number): string => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
/** The first suggestion: the coming Saturday 00:00 to Monday 00:00. */
function weekend(): [string, string] {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return [local(d.getTime()), local(d.getTime() + 2 * 86400000)];
}

/** "Sự kiện tốc độ lớn" (bridge/src/growth-events.ts): GrowthMultiplier ×N, applied at a start of the game. */
export function GrowthEventsCard() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { access, withToken } = useSession();
  const q = useQuery({ queryKey: [URL], queryFn: () => getJson<GrowthEvents>(URL), refetchInterval: 2000 });
  const [[start, end], setRange] = useState(weekend);
  const [mult, setMult] = useState(2);
  const [note, setNote] = useState('');
  const g = q.data;
  const a = g?.applied ?? null;
  const edit = can(access, 'server.schedule');
  const nowS = Date.now() / 1000;
  const reload = (): void => { void qc.invalidateQueries({ queryKey: [URL] }); };
  return (
    <Card>
      <CardHead title="Sự kiện tốc độ lớn" sub={a ? `đang chạy: ×${a.multiplier}${a.event ? ' (sự kiện)' : ''} từ lần khởi động ${geTime(a.at)}` : undefined} />
      <CardBody stack>
        <div className={s.geList}>
          {g && g.events.length === 0 && <div className={s.muted} style={{ fontSize: 13 }}>Chưa có sự kiện nào.</div>}
          {g?.events.map((e) => {
            const live = a?.event?.id === e.id;
            const state = e.end <= nowS ? 'đã kết thúc'
              : live ? `đang áp dụng · kết thúc ở lần khởi động ${e.endsAt ? geTime(e.endsAt) : 'tay sau giờ kết thúc (chưa có lịch)'}`
                : e.appliesAt ? `bắt đầu ở lần khởi động ${geTime(e.appliesAt)}` : 'chưa có lịch khởi động lại, chỉ áp khi khởi động lại tay';
            return (
              <div key={e.id} className={`${s.geRow}${live ? ` ${s.live}` : ''}`}>
                <span className={s.x}>×{e.multiplier}</span>
                <span className={s.when}><b>{geTime(e.start)} → {geTime(e.end)}</b><small>{state}{e.note ? ` · ${e.note}` : ''}</small></span>
                {edit && <Button variant="danger" small onClick={() => confirm({
                  title: 'Xoá sự kiện tốc độ lớn?', body: 'Nếu sự kiện đang áp dụng, tốc độ lớn về bình thường ở lần khởi động lại tới.', okLabel: 'Xoá',
                  run: async (token) => { await adminFetch(`${URL}/${e.id}`, 'DELETE', token); toast('Đã xoá'); reload(); },
                })}>Xoá</Button>}
              </div>
            );
          })}
        </div>
        {edit && (
          <div className={s.geForm}>
            <label>Bắt đầu<DateTimeInput kind="datetime" aria-label="Bắt đầu" required value={start} onChange={(v) => setRange([v, end])} /></label>
            <label>Kết thúc<DateTimeInput kind="datetime" aria-label="Kết thúc" required value={end} onChange={(v) => setRange([start, v])} /></label>
            <label>Hệ số<NumberInput aria-label="Hệ số" value={mult} min={g?.limits.min ?? 0.1} max={g?.limits.max ?? 20} step={0.1} onChange={setMult} /></label>
            <label className={s.wide}>Ghi chú (người chơi thấy)<TextInput maxLength={80} placeholder="vd: Cuối tuần x2" value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <Button onClick={() => void withToken('thêm sự kiện tốc độ lớn', async (token) => {
              const a0 = Date.parse(start), b0 = Date.parse(end);
              if (!Number.isFinite(a0) || !Number.isFinite(b0)) { toast('Chọn giờ bắt đầu và kết thúc.', 'err'); return; }
              await adminFetch(URL, 'POST', token, { start: Math.floor(a0 / 1000), end: Math.floor(b0 / 1000), multiplier: mult, note });
              setNote('');
              toast('Đã thêm sự kiện, áp dụng ở lần khởi động lại sau giờ bắt đầu.');
              reload();
            })}>+ Thêm sự kiện</Button>
          </div>
        )}
        <div className={s.hint}>Tốc độ lớn (GrowthMultiplier) chỉ đổi khi server <b>khởi động</b>: sự kiện bắt đầu ở lần khởi động lại đầu tiên sau giờ bắt đầu và kết thúc
          ở lần đầu tiên sau giờ kết thúc (theo lịch khởi động lại ở trên, hoặc khi admin khởi động lại tay). Lúc server lên, người chơi được báo sự kiện đang diễn ra
          / đã kết thúc. Hết sự kiện: về hệ số trong Cấu hình game.</div>
      </CardBody>
    </Card>
  );
}
