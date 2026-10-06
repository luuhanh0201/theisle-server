import type { ReactNode } from 'react';
import { Card, CardBody } from '@isle/ui';
import { isNum } from '../../../lib/format';
import { maximaAtGrowth, type StatPoint } from './logic';
import c from './Creator.module.css';

/** GET /api/species-stats (bridge/src/species-stats.ts + species-lab.ts): the maxima read on this server. */
export interface SpeciesStats {
  species: string;
  points: StatPoint[];
  at?: { exact?: boolean; from: number; to: number; max: Record<string, number> } | null;
  lab?: { points: StatPoint[]; at?: { exact?: boolean; from: number; to: number; max: Record<string, number> } | null; measured?: string } | null;
  prime?: { growth: number; readings: number; max: Record<string, number> } | null;
}

const fmt = (v: number | undefined): string => (isNum(v) ? Math.round(v).toLocaleString('vi-VN') : '-');
const STAT_ROWS: ReadonlyArray<[string, string]> = [['health', 'Máu tối đa'], ['stamina', 'Thể lực tối đa'], ['hunger', 'Dạ dày tối đa'],
  ['thirst', 'Nước tối đa'], ['oxygen', 'Oxy tối đa'], ['blood', 'Huyết tối đa']];

/** How much prime added on this species here (health), for the "👑 prime ~…" figures; null when not known. */
function primeFactor(data: SpeciesStats): number | null {
  const pm = data.prime;
  if (!pm || !isNum(pm.max['health'])) return null;
  const base = maximaAtGrowth(data.points, pm.growth);
  return base && isNum(base['health']) && base['health'] > 0 ? pm.max['health']! / base['health'] : null;
}

/** The line under the growth slider: the usual maxima at this growth (the lab's numbers first). */
export function GrowthStats({ data, growth, prime }: { data: SpeciesStats | null; growth: number; prime: boolean }) {
  const max = data ? maximaAtGrowth(data.lab ? data.lab.points : data.points, growth / 100) : null;
  if (!data) return <div className={c.growthStats} />;
  if (!max) return <div className={c.growthStats}><span>Chưa có số đo của loài này ở server.</span></div>;
  const factor = prime ? primeFactor(data) : null;
  const cell = (label: string, v: number | undefined) => (isNum(v) ? <span key={label}>{label} <b>{fmt(v)}</b></span> : null);
  return (
    <div className={c.growthStats}>
      {cell('❤ Máu', max['health'])}{cell('⚡ Thể lực', max['stamina'])}{cell('🍖 Dạ dày', max['hunger'])}{cell('💧 Nước', max['thirst'])}
      {factor && <span className={c.pr}>👑 prime ~<b>{fmt((max['health'] ?? 0) * factor)}</b> máu · <b>{fmt((max['hunger'] ?? 0) * factor)}</b> dạ dày</span>}
    </div>
  );
}

/** "Thông số dự kiến": what the dino will have when taken out, at this growth. */
export function ExpectedCard({ data, growth, prime, fill }: { data: SpeciesStats | null; growth: number; prime: boolean; fill: string }) {
  if (!data) return null;
  const g = growth / 100;
  const lab = data.lab && data.lab.at ? data.lab : null;
  const at = lab ? lab.at! : data.at ?? null;
  if (!at) {
    return (
      <Card className={c.expected}><CardBody>
        <div className={c.groupLabel}>Thông số dự kiến</div>
        <div className={c.muted} style={{ fontSize: '12.5px' }}>Chưa có số đo nào của loài này trên server, thông số sẽ là của game khi người chơi lấy ra.</div>
      </CardBody></Card>
    );
  }
  const p = (x: number): string => `${Math.round(x * 100)}%`;
  const where = at.exact ? `đo trực tiếp ở ${p(at.from === at.to ? at.from : g)}`
    : at.from === at.to ? `gần nhất đã đo: ${p(at.from)} (chưa có số đo ở ${p(g)})` : `ước tính giữa hai mức đã đo ${p(at.from)} và ${p(at.to)}`;
  const source = lab
    ? `Số gốc của game khi đặt growth, đúng số dino có khi lấy ra từ gara (đo trên server test ${lab.measured ?? ''}, ${where}). Dino người chơi có thể cao hơn nhờ đột biến, prime.`
    : `Số tối đa game báo cho loài này trên server (${where}).`;
  let primeNote: ReactNode = null;
  let factor: number | null = null;
  if (prime) {
    const pm = data.prime;
    if (pm && isNum(pm.max['health'])) {
      const base = (data.points.find((x) => Math.abs(x.growth - pm.growth) < 0.011) ?? data.points[data.points.length - 1])?.max;
      factor = base && isNum(base['health']) && base['health'] > 0 ? pm.max['health']! / base['health'] : null;
      primeNote = <>👑 Prime trên server này: máu và dạ dày tối đa <b>tăng dần</b> khi dino giữ trạng thái prime,
        cao nhất đã thấy <b>{fmt(pm.max['health'])} máu</b>{factor ? ` (×${factor.toFixed(2).replace('.', ',')})` : ''} ở growth {p(pm.growth)} ({pm.readings} lần đọc).
        Lấy ra từ gara là có ngay chỉ số prime.</>;
    } else {
      primeNote = '👑 Chưa từng thấy dino prime của loài này trên server, chưa biết prime tăng bao nhiêu.';
    }
  }
  return (
    <Card className={c.expected}><CardBody className={c.expectedBody}>
      <div className={c.groupLabel}>Thông số dự kiến ở growth {p(g)}</div>
      <div className={c.kv}>
        {STAT_ROWS.filter(([k]) => isNum(at.max[k])).map(([k, label]) => (
          <div key={k}><div className={c.kvLbl}>{label}</div>
            <div className={c.kvVal}>{fmt(at.max[k])}{factor && (k === 'health' || k === 'hunger') && <span className={c.muted} style={{ fontSize: '11.5px', fontWeight: 600 }}> → tới {fmt(at.max[k]! * factor)} khi prime lâu</span>}</div></div>
        ))}
      </div>
      <div className={c.muted} style={{ fontSize: 12 }}>{source} Khi lấy ra: {fill}.</div>
      {primeNote && <div style={{ fontSize: '12.5px' }}>{primeNote}</div>}
    </CardBody></Card>
  );
}
