import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { adminFetch, type ServerStatusFull } from '@isle/api';
import { Button, Card, CardBody, CardHead, DateTimeInput, Select, useToast } from '@isle/ui';
import { useSession } from '../../../app/session';
import { STATUS_URL } from './PowerCard';
import s from './Ops.module.css';

const WARN = [0, 1, 5, 10, 15, 30].map((m) => ({ value: String(m), label: m === 0 ? 'không báo' : `${m} phút` }));

/** "Khởi động lại định kỳ": the daily times and the warning, edited as a draft until Lưu lịch. */
export function ScheduleCard({ status }: { status: ServerStatusFull }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { withToken } = useSession();
  // The times being edited; null = not touched (the saved ones are shown, and follow the server).
  const [times, setTimes] = useState<string[] | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [add, setAdd] = useState('');
  const shownTimes = times ?? status.schedule.daily;
  const shownWarn = warn ?? String(status.schedule.countdownMinutes);
  const next = status.schedule.next;
  return (
    <Card>
      <CardHead title="Khởi động lại định kỳ" sub={next ? `lần tới: ${new Date(next * 1000).toLocaleString('vi-VN', { hour12: false })}` : 'chưa có lịch'} />
      <CardBody stack>
        <div className={s.timeChips}>
          {shownTimes.length === 0 ? <span className={s.muted} style={{ fontSize: 12.5 }}>Chưa có giờ nào.</span>
            : shownTimes.map((t) => (
              <span key={t} className={s.timeChip}>{t}
                <button type="button" aria-label={`Bỏ ${t}`} onClick={() => setTimes(shownTimes.filter((x) => x !== t))}>×</button></span>
            ))}
        </div>
        <div className={s.row}>
          <span className={s.timeBox}><DateTimeInput kind="time" aria-label="Giờ" value={add} onChange={setAdd} /></span>
          <Button variant="soft" onClick={() => {
            if (!/^\d{2}:\d{2}$/.test(add)) { toast('Chọn giờ trước.', 'err'); return; }
            setTimes([...new Set([...shownTimes, add])].sort());
          }}>+ Thêm giờ</Button>
        </div>
        <div className={s.row}>
          <label htmlFor="sch-countdown" className={s.inlineLabel}>Báo trước</label>
          <span className={s.warnBox}><Select id="sch-countdown" value={shownWarn} options={WARN} onChange={(v) => { setWarn(v); if (times === null) setTimes([...status.schedule.daily]); }} /></span>
          <Button onClick={() => void withToken('lưu lịch', async (token) => {
            await adminFetch('/api/server/schedule', 'PUT', token, { daily: shownTimes, countdownMinutes: Number(shownWarn) });
            setTimes(null); setWarn(null);
            toast('Đã lưu lịch khởi động lại.');
            void qc.invalidateQueries({ queryKey: [STATUS_URL] });
          })}>Lưu lịch</Button>
        </div>
        <div className={s.hint}>Giờ theo múi giờ của VPS ({status.timeZone}). Người chơi được báo đếm ngược qua RCON.</div>
      </CardBody>
    </Card>
  );
}
