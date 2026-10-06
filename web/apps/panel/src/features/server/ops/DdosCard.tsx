import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson, type DdosView } from '@isle/api';
import { Button, Card, CardBody, CardHead, NumberInput, Switch, useToast } from '@isle/ui';
import { useSession } from '../../../app/session';
import { dateTime } from '../../../lib/format';
import s from './Ops.module.css';

const URL = '/api/ddos';
const fmtN = (x: number): string => Math.round(x).toLocaleString('vi-VN');
type Form = { enabled: boolean; pps: number; mbps: number; sustainSec: number };

/** "Cảnh báo DDoS" (bridge/src/ddos.ts): the incoming traffic now, its last 5 minutes, and when to tell Discord. */
export function DdosCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const { withToken } = useSession();
  const q = useQuery({ queryKey: [URL], queryFn: () => getJson<DdosView>(URL), refetchInterval: 2000 });
  // The settings as edited; null = not touched (they follow the server).
  const [draft, setDraft] = useState<Form | null>(null);
  const d = q.data;
  if (!d) return <Card><CardHead title="Cảnh báo DDoS" /><CardBody><span className={s.muted}>Đang tải…</span></CardBody></Card>;
  const f: Form = draft ?? { enabled: d.enabled, pps: d.pps, mbps: d.mbps, sustainSec: d.sustainSec };
  const set = (p: Partial<Form>): void => setDraft({ ...f, ...p });
  const last = d.history.at(-1);
  const a = d.attack;
  // The last 5 minutes of incoming packets/s, the threshold as a dashed line.
  const hs = d.history;
  const max = Math.max(d.pps * 1.2, ...hs.map((x) => x.pps), 1);
  const pts = hs.map((x, i) => `${(i / Math.max(1, hs.length - 1)) * 300},${48 - (x.pps / max) * 44 - 2}`).join(' ');
  const ty = 48 - (d.pps / max) * 44 - 2;
  return (
    <Card>
      <CardHead title="Cảnh báo DDoS" sub={d.iface ? `card mạng ${d.iface} · mỗi 5 giây` : 'không tìm thấy card mạng'} />
      <CardBody stack>
        <div className={s.ddLive}>
          <div className={`${s.ddState}${a ? ` ${s.hit}` : ''}`}>{a
            ? `🚨 Đang có lưu lượng bất thường từ ${dateTime(a.since)}, đỉnh ${fmtN(a.peakPps)} gói/s · ${a.peakMbps} Mbit/s`
            : last ? `Bình thường · vào ${fmtN(last.pps)} gói/s · ${last.mbps} Mbit/s · ra ${last.outMbps} Mbit/s` : 'Đang đo…'}</div>
          <svg className={s.ddSpark} viewBox="0 0 300 48" preserveAspectRatio="none" role="img" aria-label="gói/giây 5 phút qua">
            <line x1="0" x2="300" y1={ty} y2={ty} stroke="var(--kill)" strokeDasharray="4 4" strokeWidth="1" opacity=".6" />
            {hs.length > 1 && <polyline points={pts} fill="none" stroke={a ? 'var(--kill)' : 'var(--accent)'} strokeWidth="2" />}
          </svg>
        </div>
        <Switch checked={f.enabled} onChange={(v) => set({ enabled: v })} label={<b>Báo khi lưu lượng vào server bất thường</b>} />
        <div className={s.ddGrid}>
          <label>Từ (gói/giây)<NumberInput aria-label="Từ (gói/giây)" value={f.pps} min={1000} step={1000} onChange={(v) => set({ pps: v })} /></label>
          <label>hoặc từ (Mbit/s)<NumberInput aria-label="hoặc từ (Mbit/s)" value={f.mbps} min={1} step={5} onChange={(v) => set({ mbps: v })} /></label>
          <label>kéo dài ít nhất (giây)<NumberInput aria-label="kéo dài ít nhất (giây)" value={f.sustainSec} min={5} max={600} step={5} onChange={(v) => set({ sustainSec: v })} /></label>
        </div>
        <div><Button variant="soft" onClick={() => void withToken('lưu cảnh báo DDoS', async (token) => {
          await adminFetch(URL, 'PUT', token, { enabled: f.enabled, pps: Math.round(f.pps), mbps: Math.round(f.mbps), sustainSec: Math.round(f.sustainSec) });
          setDraft(null);
          toast('Đã lưu cảnh báo DDoS.');
          void qc.invalidateQueries({ queryKey: [URL] });
        })}>Lưu cảnh báo DDoS</Button></div>
        <div className={s.hint}>Bridge đo lưu lượng vào card mạng của VPS mỗi 5 giây. Vượt ngưỡng đủ lâu → tin <b>"🚨 Nghi bị DDoS"</b> lên Discord
          (loại log "DDoS", chọn kênh ở <a href="#admin/discord">Quản trị → Discord</a>), hết → <b>"✅ Hết lưu lượng bất thường"</b> kèm thời gian và đỉnh;
          lệnh <b>/status</b> cũng báo đang bị tấn công. Mạng nghẽn tới mức VPS không gửi được: tin được gửi bù, trạm ngoài VPS báo "Mất kết nối".
          Cảnh báo không chặn được tấn công, chặn là việc của nhà cung cấp VPS (chống DDoS cho cổng game UDP).</div>
      </CardBody>
    </Card>
  );
}
