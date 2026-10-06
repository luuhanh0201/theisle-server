import { isNum, num, pct } from '../../lib/format';
import s from './dino.module.css';

/** A bar with its number: health-like (red when low), or growth (its gradient, a %). */
export function Meter({ value, max, kind = 'hp' }: { value: number | null | undefined; max: number; kind?: 'hp' | 'grow' }) {
  if (!isNum(value)) return <span className={s.muted}>-</span>;
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  const cls = kind === 'grow' ? s.grow : w < 30 ? s.low : w < 60 ? s.mid : '';
  return (
    <div className={s.meter}>
      <div className={s.track}><div className={`${s.fill}${cls ? ` ${cls}` : ''}`} style={{ width: `${w}%` }} /></div>
      <span className={s.n}>{kind === 'grow' ? pct(value) : num(value)}</span>
    </div>
  );
}

/** One vital: its name with a coloured dot, value / max (%), a bar; growth as a share. */
export function VitalItem({ label, cur, max, color, growth = false, emptyTip = 'Chưa có dữ liệu snapshot' }: {
  label: string; cur: number | null | undefined; max?: number | null; color: string; growth?: boolean; emptyTip?: string;
}) {
  if (!isNum(cur)) {
    return (
      <div className={s.vitalItem} title={`${label}: ${emptyTip}`}>
        <div className={s.vitalHead}>
          <span className={s.vitalName} title={label}><i className={s.vitalDot} style={{ background: color }} />{label}</span>
          <span className={s.vitalVals}><span className={s.vitalCur}>–</span></span>
        </div>
        <div className={s.vitalTrack}><div className={s.vitalFill} style={{ width: '0%', background: color }} /></div>
      </div>
    );
  }
  let ratio: number, curText: string, maxText: string, pctText: string, low = false;
  if (growth) {
    ratio = Math.max(0, Math.min(1, cur));
    curText = `${(cur * 100).toFixed(1)}%`; maxText = '100%'; pctText = `${cur.toFixed(2)}/1.00`;
  } else {
    const m = isNum(max) && max > 0 ? max : cur > 100 ? cur : 100;
    ratio = Math.max(0, Math.min(1, cur / m));
    curText = Math.round(cur).toLocaleString('vi-VN'); maxText = Math.round(m).toLocaleString('vi-VN'); pctText = `${Math.round(ratio * 100)}%`;
    low = ratio < 0.25;
  }
  const tip = `${label}: ${curText} / ${maxText} (${pctText})`;
  return (
    <div className={`${s.vitalItem}${low ? ` ${s.vitalLow}` : ''}`} title={tip}>
      <div className={s.vitalHead}>
        <span className={s.vitalName} title={label}><i className={s.vitalDot} style={{ background: color }} />{label}</span>
        <span className={s.vitalVals} title={tip}><span className={s.vitalCur}>{curText}</span> / {maxText} <span className={`${s.vitalPct} ${s.muted}`}>({pctText})</span></span>
      </div>
      <div className={s.vitalTrack}><div className={s.vitalFill} style={{ width: `${Math.round(ratio * 1000) / 10}%`, background: color }} /></div>
    </div>
  );
}
