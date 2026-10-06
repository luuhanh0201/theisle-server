import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJson } from '@isle/api';
import { Card, CardBody, CardHead, DateTimeInput, PageHead } from '@isle/ui';
import { ChartEmpty, ChartTip, LineChart, Tile, Tiles, TipRow, useWidth, type Point } from '../../components/chart/LineChart';
import { Seg } from '../../components/list/List';
import s from './Traffic.module.css';

/** GET /api/traffic (bridge/src/traffic.ts): totals and one point an hour (a day) or a day (a span). */
type Counts = Record<string, number>;
interface TrafficView { unit: 'hour' | 'day'; total: Counts; points: Array<Counts & { label: string }> }
type Range = 'day' | 'week' | 'month' | 'custom';

export const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The days asked: today, the last 7 or 30, or the two typed (in order). */
export function spanOf(range: Range, from: string | null, to: string | null, now = new Date()): [string, string] {
  if (range === 'custom' && from && to) return from <= to ? [from, to] : [to, from];
  const back = { day: 0, week: 6, month: 29, custom: 0 }[range];
  return [dayKey(new Date(now.getTime() - back * 86_400_000)), dayKey(now)];
}
export const trDay = (k: string): string => { const [, m, d] = k.split('-'); return `${d}/${m}`; };
const vn = (n: number | undefined): string => Number(n ?? 0).toLocaleString('vi-VN');

export const TR_CHARTS: ReadonlyArray<{ title: string; unit: string; series: ReadonlyArray<readonly [string, string]> }> = [
  { title: 'Lượt mở web', unit: 'lượt', series: [['viewsWeb', 'Web'], ['viewsLauncher', 'Trong launcher']] },
  { title: 'Người xem mới', unit: 'người', series: [['visitorsWeb', 'Web'], ['visitorsLauncher', 'Trong launcher']] },
  { title: 'Bấm tải launcher', unit: 'lượt', series: [['clicksWin', 'Windows'], ['clicksLinux', 'Linux']] },
  { title: 'Cài mới / máy dùng launcher', unit: 'máy', series: [['launchers', 'Máy dùng'], ['installs', 'Cài mới']] },
  { title: 'Lượt đăng nhập', unit: 'lượt', series: [['loginsWeb', 'Web'], ['loginsLauncher', 'Launcher']] },
  { title: 'Tài khoản đang dùng', unit: 'tài khoản', series: [['activeWeb', 'Web'], ['activeLauncher', 'Launcher']] },
];
const COLORS = ['var(--series-1)', 'var(--series-2)'];

/** Truy cập: web, launcher and login counts (no IP kept), as tiles and line charts. */
export function Traffic() {
  const [range, setRange] = useState<Range>('day');
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const charts = useRef<HTMLDivElement>(null);
  const [a, b] = spanOf(range, from, to);
  const q = useQuery({ queryKey: ['/api/traffic', a, b], queryFn: () => getJson<TrafficView>(`/api/traffic?from=${a}&to=${b}`), refetchInterval: 30_000 });
  const d = q.data;
  const pick = (r: Range): void => {
    setRange(r);
    if (r === 'custom' && !from) {
      const t = new Date();
      setTo(dayKey(t)); setFrom(dayKey(new Date(t.getTime() - 13 * 86_400_000)));
    }
  };
  const t = d?.total;
  const label = (p: { label: string }): string => (d?.unit === 'hour' ? p.label : trDay(p.label));
  const hp = hover && d ? d.points[hover.i] : undefined;
  return (
    <div>
      <PageHead title="Truy cập" sub="Lượt mở web, tải và dùng launcher, đăng nhập (giờ server). Không lưu IP: người xem là mã băm theo ngày." />
      <Card>
        <CardHead title="Khoảng thời gian">
          <Seg label="Khoảng thời gian" value={range} onChange={pick} options={[['day', 'Hôm nay'], ['week', '7 ngày'], ['month', '30 ngày'], ['custom', 'Khoảng ngày']]} />
          {range === 'custom' && (
            <span className={s.custom}>
              <DateTimeInput kind="date" aria-label="Từ ngày" value={from ?? ''} onChange={(v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setFrom(v); }} />
              <span className={s.muted}>→</span>
              <DateTimeInput kind="date" aria-label="Đến ngày" value={to ?? ''} onChange={(v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setTo(v); }} />
            </span>
          )}
          <span className={s.rangeLabel}>{a === b ? `${trDay(a)} · theo giờ` : `${trDay(a)} – ${trDay(b)} · theo ngày`}</span>
        </CardHead>
        <CardBody>
          {q.isError && !d ? <ChartEmpty>Chưa đọc được số liệu truy cập.</ChartEmpty> : t && (
            <Tiles>
              <Tile k="Lượt mở web" v={vn((t['viewsWeb'] ?? 0) + (t['viewsLauncher'] ?? 0))} sub={`web ${vn(t['viewsWeb'])} · launcher ${vn(t['viewsLauncher'])}`} />
              <Tile k="Người xem khác nhau" v={vn(t['visitors'])} sub="cùng người trong một ngày tính một" />
              <Tile k="Bấm tải launcher" v={vn((t['clicksWin'] ?? 0) + (t['clicksLinux'] ?? 0))} sub={`Windows ${vn(t['clicksWin'])} · Linux ${vn(t['clicksLinux'])}`} />
              <Tile k="File cài từ server" v={vn(t['files'])} sub={`+ ${vn(t['filesUpdate'])} lượt tự cập nhật · thấp hơn thật`} />
              <Tile k="Cài mới" v={vn(t['installs'])} sub="launcher mở lần đầu" />
              <Tile k="Máy dùng launcher" v={vn(t['launcherMachines'])} sub="máy khác nhau" />
              <Tile k="Lượt đăng nhập" v={vn((t['loginsWeb'] ?? 0) + (t['loginsLauncher'] ?? 0))} sub={`web ${vn(t['loginsWeb'])} · launcher ${vn(t['loginsLauncher'])} · lần đầu ${vn(t['newUsers'])}`} />
              <Tile k="Tài khoản đang dùng" v={vn(t['active'])} sub="web hoặc launcher, khác nhau" />
            </Tiles>
          )}
          <p className={s.note}>Tải file cài đặt: proxy trước web lưu cache file cài nên phần lớn lượt tải không tới server, số "từ server" luôn thấp hơn thật;
            xem <b>Bấm tải</b> (nút trên trang tải) và <b>Cài mới</b> (launcher mở lần đầu, từ bản 1.0.33).</p>
        </CardBody>
      </Card>
      <Card className={s.gap}>
        <CardHead title="Biểu đồ" sub="rê chuột lên biểu đồ để xem số" />
        <CardBody>
          <div ref={charts} className={s.charts}>
            {d && TR_CHARTS.map((c) => (
              <OneChart key={c.title} c={c} d={d} hover={hover?.i ?? null} label={label}
                onHover={(i, e) => setHover(i === null || !e ? null : { i, x: e.clientX, y: e.clientY })} />
            ))}
            {hp && d && (
              <ChartTip at={hover} box={charts.current}>
                <b>{d.unit === 'hour' ? `${trDay(a)} ${hp.label}` : trDay(hp.label)}</b>
                {TR_CHARTS.map((c) => <TipRow key={c.title} k={c.title} v={c.series.map(([k]) => vn(hp[k] as number)).join(' / ')} />)}
              </ChartTip>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function OneChart({ c, d, hover, label, onHover }: {
  c: (typeof TR_CHARTS)[number]; d: TrafficView; hover: number | null; label: (p: { label: string }) => string; onHover: Parameters<typeof LineChart>[0]['onHover'];
}) {
  const [box, w] = useWidth<HTMLDivElement>();
  const n = d.points.length;
  const pts: Point[] = d.points.map((p, j) => ({ x: j, ...Object.fromEntries(c.series.map(([k]) => [k, p[k] ?? 0])) }));
  const every = Math.max(1, Math.ceil(n / 7));
  const ticks = d.points.flatMap((p, j) => (j % every === 0 || j === n - 1 ? [{ x: j, label: label(p), anchor: (j === 0 ? 'start' : j === n - 1 ? 'end' : 'middle') as 'start' | 'middle' | 'end' }] : []));
  return (
    <div ref={box}>
      <LineChart title={c.title} unit={`${c.unit} / ${d.unit === 'hour' ? 'giờ' : 'ngày'}`} series={c.series.map(([key, l], i) => ({ key, label: l, color: COLORS[i] as string }))}
        points={pts} domain={[0, Math.max(0, n - 1)]} width={Math.max(300, w)} height={170} left={34} fmt={(v) => vn(Math.round(v))} ticks={ticks} hover={hover} onHover={onHover} />
    </div>
  );
}
