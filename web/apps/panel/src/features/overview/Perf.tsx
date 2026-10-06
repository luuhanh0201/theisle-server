import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJson } from '@isle/api';
import { Card, CardBody, CardHead } from '@isle/ui';
import { ChartEmpty, ChartTip, LineChart, Tile, Tiles, TipRow, useWidth, type Point, type Series } from '../../components/chart/LineChart';
import { Seg } from '../../components/list/List';
import { dateTime } from '../../lib/format';
import s from './Overview.module.css';

/** GET /api/metrics (bridge/src/metrics.ts): a sample every 10 s, the latest, and how it behaved by player count. */
export interface Sample { t: number; online: number | null; fps: number | null; fpsMin?: number | null; ai: number | null; cpu: number | null; gameCpu: number | null;
  gameRss: number | null; memUsed: number | null; memTotal?: number | null; swapUsed: number | null }
interface CapRow { band: string; minutes: number; fpsAvg: number | null; fpsLow: number | null; gameCpuAvg: number | null; gameRssMax: number | null; memUsedMax: number | null; swapUsedMax: number | null; aiAvg: number | null }
interface Metrics { now: Sample | null; cores: number; rangeS: number; points: Sample[]; capacity?: CapRow[] }
type Range = '1h' | '6h' | '24h' | '7d';

/** Evrima's server ticks at ~30; below 20 players notice rubber-banding, below 12 it is bad. */
export function fpsState(fps: number | null | undefined): { label: string; color: string; icon: string } {
  if (typeof fps !== 'number') return { label: 'Chưa có số liệu', color: 'var(--muted)', icon: '·' };
  if (fps >= 25) return { label: 'Mượt', color: 'var(--status-good)', icon: '✓' };
  if (fps >= 15) return { label: 'Hơi giật', color: 'var(--status-warning)', icon: '⚠' };
  return { label: 'Giật', color: 'var(--status-critical)', icon: '✕' };
}
export const gb = (mb: number | null | undefined): string => (typeof mb === 'number' ? (mb / 1024).toFixed(mb >= 10240 ? 0 : 1) : '–');
export const n1 = (v: number | null | undefined): string => (typeof v === 'number' ? (Math.round(v * 10) / 10).toLocaleString('vi-VN') : '–');
/** The x labels: four times across the range (with the day past 24 h). */
function timeTicks(t0: number, t1: number, long: boolean): Array<{ x: number; label: string; anchor: 'start' | 'middle' | 'end' }> {
  return [0, 1 / 3, 2 / 3, 1].map((f) => {
    const t = t0 + (t1 - t0) * f;
    const d = new Date(t * 1000);
    const hm = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
    return { x: t, label: long ? `${d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} ${hm}` : hm, anchor: f === 0 ? 'start' : f === 1 ? 'end' : 'middle' };
  });
}

/** Hiệu năng server: tiles, four charts on one time axis with one crosshair, the table, the capacity by player count. */
export function Perf() {
  const [range, setRange] = useState<Range>('6h');
  const d = useQuery({ queryKey: ['/api/metrics', range], queryFn: () => getJson<Metrics>(`/api/metrics?range=${range}`), refetchInterval: 10_000 });
  const m = d.data;
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [wrap, w] = useWidth<HTMLDivElement>();
  const now = m?.now?.t ?? Math.floor(Date.now() / 1000);
  const t0 = now - (m?.rangeS ?? 0);
  const hp = hover && m ? m.points[hover.i] : undefined;
  const chart = (id: string, title: string, unit: string, series: Series[], opts: { max?: number; ref?: { value: number; label: string }; fmt?: (v: number) => string; div?: number }) => {
    const div = opts.div ?? 1;
    const pts: Point[] = (m?.points ?? []).map((p) => ({ x: p.t, ...Object.fromEntries(series.map((sr) => { const v = (p as unknown as Record<string, number | null>)[sr.key]; return [sr.key, typeof v === 'number' ? v / div : null]; })) }));
    return (
      <LineChart key={id} title={title} unit={unit} series={series} points={pts} domain={[t0, now]} width={Math.max(280, w)} height={150} pad={1.05} max={opts.max} refLine={opts.ref}
        fmt={opts.fmt ?? n1} ticks={timeTicks(t0, now, (m?.rangeS ?? 0) > 86400)} gap={Math.max(60, ((m?.rangeS ?? 0) / 360) * 3)}
        hover={hover?.i ?? null} onHover={(i, e) => setHover(i === null || !e ? null : { i, x: e.clientX, y: e.clientY })} />
    );
  };
  const st = m?.now ? fpsState(m.now.fps) : null;
  const memTotal = m?.now?.memTotal ?? null;
  const rows = m?.capacity ?? [];
  const worst = rows.filter((r) => typeof r.fpsLow === 'number' && r.fpsLow < 20 && r.minutes >= 10);
  return (
    <>
      <Card>
        <CardHead title="Hiệu năng server" sub="ServerFPS (tick của game), CPU và RAM theo thời gian, đo mỗi 10 giây, giữ 7 ngày">
          <span className={s.pushRight}><Seg label="Khoảng thời gian" value={range} onChange={setRange} options={[['1h', '1 giờ'], ['6h', '6 giờ'], ['24h', '24 giờ'], ['7d', '7 ngày']]} /></span>
        </CardHead>
        <CardBody>
          {d.isError && !m ? <ChartEmpty>Chưa đọc được số liệu hiệu năng (bridge chưa có /api/metrics?).</ChartEmpty> : m && <>
            {!m.now ? <ChartEmpty>Chưa có mẫu nào, bridge đo 10 giây một lần.</ChartEmpty> : (
              <Tiles>
                <Tile k="ServerFPS (tick game)" v={n1(m.now.fps)} sub={st && <span className={s.state} style={{ color: st.color }}><i style={{ background: st.color }} />{st.icon} {st.label}</span>} />
                <Tile k="Người online" v={m.now.online ?? '–'} sub={m.now.ai !== null && m.now.ai !== undefined ? `AI đang có: ${m.now.ai}` : undefined} />
                <Tile k="CPU game" v={<>{n1(m.now.gameCpu)}<small>% 1 nhân</small></>} sub={`Cả máy: ${n1(m.now.cpu)}% · ${m.cores} nhân`} />
                <Tile k="RAM game" v={<>{gb(m.now.gameRss)}<small>GB</small></>} />
                <Tile k="RAM máy" v={<>{gb(m.now.memUsed)}<small>/ {gb(m.now.memTotal)} GB</small></>}
                  sub={m.now.memTotal && typeof m.now.memUsed === 'number' ? `${Math.round((m.now.memUsed / m.now.memTotal) * 100)}% đã dùng` : undefined} />
                <Tile k="Swap" v={<>{gb(m.now.swapUsed)}<small>GB</small></>}
                  sub={(m.now.swapUsed ?? 0) > 256 ? <span className={s.state} style={{ color: 'var(--status-warning)' }}><i style={{ background: 'var(--status-warning)' }} />⚠ Đang dùng swap, sẽ lag</span> : undefined} />
              </Tiles>
            )}
            <div ref={box} className={s.charts}>
              <div ref={wrap}>
                {m.points.length === 0 ? <ChartEmpty>Chưa có số liệu trong khoảng này, bridge vừa bắt đầu đo, quay lại sau vài phút.</ChartEmpty> : <>
                  {chart('fps', 'ServerFPS', 'khung/giây (trung bình mỗi điểm)', [{ key: 'fps', label: 'ServerFPS', color: 'var(--series-1)' }], { max: 30, ref: { value: 20, label: 'dưới 20: người chơi thấy giật' } })}
                  {chart('online', 'Người online', 'người', [{ key: 'online', label: 'Người online', color: 'var(--series-1)' }], { fmt: (v) => String(Math.round(v)) })}
                  {chart('cpu', 'CPU của game', '% một nhân, luồng game là giới hạn', [{ key: 'gameCpu', label: 'CPU game', color: 'var(--series-1)' }], { max: 100, ref: { value: 100, label: '100% = 1 nhân đầy' } })}
                  {chart('ram', 'RAM', 'GB', [{ key: 'gameRss', label: 'Game', color: 'var(--series-1)' }, { key: 'memUsed', label: 'Cả máy', color: 'var(--series-2)' }],
                    { div: 1024, ref: memTotal ? { value: memTotal / 1024, label: `tổng ${gb(memTotal)} GB` } : undefined })}
                </>}
              </div>
              {hp && (
                <ChartTip at={hover} box={box.current}>
                  <div className={s.muted} style={{ marginBottom: 2 }}>{dateTime(hp.t)}</div>
                  <TipRow k={<span className={s.muted}>ServerFPS</span>} v={n1(hp.fps) + (typeof hp.fpsMin === 'number' && hp.fpsMin !== hp.fps ? ` (thấp ${n1(hp.fpsMin)})` : '')} />
                  <TipRow k={<span className={s.muted}>Online</span>} v={hp.online ?? '–'} />
                  <TipRow k={<span className={s.muted}>CPU game</span>} v={`${n1(hp.gameCpu)}%`} />
                  <TipRow k={<span className={s.muted}>RAM game</span>} v={`${gb(hp.gameRss)} GB`} />
                  <TipRow k={<span className={s.muted}>RAM máy</span>} v={`${gb(hp.memUsed)} GB`} />
                </ChartTip>
              )}
            </div>
            <details className={s.details}><summary>Xem số liệu dạng bảng</summary>
              <div className={s.tableBox}><table className={s.table}>
                <thead><tr><th>Thời gian</th><th>Online</th><th>FPS</th><th>FPS thấp nhất</th><th>CPU game %</th><th>RAM game GB</th><th>RAM máy GB</th><th>Swap GB</th></tr></thead>
                <tbody>{[...m.points].reverse().map((p) => (
                  <tr key={p.t}><td className={s.muted}>{dateTime(p.t)}</td><td>{p.online ?? '–'}</td><td>{n1(p.fps)}</td><td>{n1(p.fpsMin)}</td><td>{n1(p.gameCpu)}</td><td>{gb(p.gameRss)}</td><td>{gb(p.memUsed)}</td><td>{gb(p.swapUsed)}</td></tr>
                ))}</tbody>
              </table></div>
            </details>
          </>}
        </CardBody>
      </Card>
      <Card className={s.gap18}>
        <CardHead title="Sức chứa theo số người online" sub="server đã chạy thế nào ở từng mức người chơi (7 ngày gần nhất), FPS thấp là mức 5 % tệ nhất" />
        <CardBody>
          <div className={s.tableBox}><table className={s.table}>
            <thead><tr><th>Người online</th><th>Thời gian đo</th><th>FPS TB</th><th>FPS thấp (5%)</th><th>CPU game TB</th><th>RAM game cao nhất</th><th>RAM máy cao nhất</th><th>Swap cao nhất</th><th>AI TB</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={9} className={s.emptyCell}>Chưa có số liệu</td></tr>}
              {rows.map((r) => { const f = fpsState(r.fpsLow); return (
                <tr key={r.band}><td><b>{r.band}</b></td><td className={s.muted}>{r.minutes} phút</td><td>{n1(r.fpsAvg)}</td>
                  <td><span style={{ color: f.color }}>{f.icon}</span> {n1(r.fpsLow)} <span className={s.muted}>{f.label}</span></td>
                  <td>{n1(r.gameCpuAvg)}%</td><td>{gb(r.gameRssMax)} GB</td><td>{gb(r.memUsedMax)} GB</td><td>{gb(r.swapUsedMax)} GB</td><td>{n1(r.aiAvg)}</td></tr>
              ); })}
            </tbody>
          </table></div>
          <p className={s.hint}>{worst.length ? `FPS bắt đầu tụt dưới 20 từ mức ${worst[0]!.band} người, đó là sức chứa thực tế hiện tại của máy.`
            : 'Chưa thấy mức người chơi nào làm FPS tụt dưới 20 (cần đủ thời gian đo ở mỗi mức, ít nhất 10 phút).'}</p>
        </CardBody>
      </Card>
    </>
  );
}
