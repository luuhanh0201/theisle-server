import { useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import s from './Chart.module.css';

/** The smallest round step (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10ⁿ) at or above v. */
export function niceCeil(v: number): number {
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * e).find((c) => c >= v) ?? 10 * e;
}

/** The width of an element, followed (the charts are drawn at their real width, as before React). */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export interface Series { key: string; label: string; color: string }
export type Point = { x: number } & Record<string, number | null | undefined>;

/**
 * One small line chart (the panel's .perf-chart): a round top, three grid lines with their values,
 * the x labels given, an optional dashed reference line, 2 px lines (broken where `gap` says the
 * data stopped), a legend for two series, a crosshair with dots at `hover` (an index of points).
 * `onHover` gets the index nearest the pointer (null when it leaves) and the pointer event.
 */
export function LineChart({ title, unit, series, points, domain, width, height, left = 44, yFloor = 1, pad = 1, max, refLine, fmt, ticks, gap, hover, onHover }: {
  title: string; unit: ReactNode; series: Series[]; points: Point[]; domain: [number, number]; width: number; height: number; left?: number; yFloor?: number; pad?: number;
  max?: number; refLine?: { value: number; label: string }; fmt: (v: number) => string; ticks: Array<{ x: number; label: string; anchor: 'start' | 'middle' | 'end' }>;
  gap?: number; hover: number | null; onHover: (i: number | null, e: PointerEvent<SVGRectElement> | null) => void;
}) {
  const W = width, H = height, L = left, R = 10, T = 10, B = 22;
  const [x0, x1] = domain;
  const vals = points.flatMap((p) => series.map((sr) => p[sr.key])).filter((v): v is number => typeof v === 'number');
  const yMax = niceCeil(Math.max(max ?? 0, refLine?.value ?? 0, ...vals, yFloor) * pad);
  const x = (v: number): number => L + (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0)) * (W - L - R);
  const y = (v: number): number => T + (1 - v / yMax) * (H - T - B);
  const path = (key: string): string => {
    let d = '';
    let prev: number | null = null;
    for (const p of points) {
      const v = p[key];
      if (typeof v !== 'number') { prev = null; continue; }
      d += `${prev !== null && (gap === undefined || p.x - prev <= gap) ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(v).toFixed(1)}`;
      prev = p.x;
    }
    return d;
  };
  const near = (e: PointerEvent<SVGRectElement>): number | null => {
    if (points.length === 0) return null;
    const box = e.currentTarget.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - box.left) / (box.width || 1)));
    const at = x0 + f * (x1 - x0);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs((points[i] as Point).x - at) < Math.abs((points[best] as Point).x - at)) best = i;
    return best;
  };
  const hp = hover !== null ? points[hover] : undefined;
  return (
    <div className={s.chart}>
      <h3>{title} <span className={s.unit}>{unit}</span>
        {series.length > 1 && series.map((sr) => <span key={sr.key} className={s.legend}><i style={{ background: sr.color }} />{sr.label}</span>)}</h3>
      {W > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} role="img" aria-label={title}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}><line className={s.grid} x1={L} x2={W - R} y1={y(yMax * f)} y2={y(yMax * f)} />
              <text className={s.axis} x={L - 6} y={y(yMax * f) + 3.5} textAnchor="end">{fmt(yMax * f)}</text></g>
          ))}
          {refLine && <><line className={s.ref} x1={L} x2={W - R} y1={y(refLine.value)} y2={y(refLine.value)} />
            <text className={s.refLabel} x={W - R} y={y(refLine.value) - 4} textAnchor="end">{refLine.label}</text></>}
          {series.map((sr) => <path key={sr.key} d={path(sr.key)} fill="none" stroke={sr.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
          {ticks.map((t, i) => <text key={i} className={s.axis} x={x(t.x)} y={H - 5} textAnchor={t.anchor}>{t.label}</text>)}
          {hp && <>
            <line className={s.cross} x1={x(hp.x)} x2={x(hp.x)} y1={T} y2={H - B} />
            {series.map((sr) => (typeof hp[sr.key] === 'number' ? <circle key={sr.key} cx={x(hp.x)} cy={y(hp[sr.key] as number)} r={4} fill={sr.color} stroke="var(--surface)" strokeWidth={2} /> : null))}
          </>}
          <rect x={L} y={T} width={Math.max(0, W - L - R)} height={H - T - B} fill="transparent" onPointerMove={(e) => onHover(near(e), e)} onPointerLeave={() => onHover(null, null)} />
        </svg>
      )}
    </div>
  );
}

/** The hover box beside the pointer, inside its chart block (position: relative). */
export function ChartTip({ at, box, children }: { at: { x: number; y: number } | null; box: HTMLElement | null; children: ReactNode }) {
  if (!at || !box) return null;
  const r = box.getBoundingClientRect();
  return <div className={s.tip} style={{ left: Math.max(0, Math.min(r.width - 240, at.x - r.left + 14)), top: Math.max(0, at.y - r.top + 14) }}>{children}</div>;
}

/** A number tile (the panel's .tile in .perf-tiles): a label, a value, a line under it. */
export function Tile({ k, v, sub }: { k: ReactNode; v: ReactNode; sub?: ReactNode }) {
  return <div className={s.tile}><div className={s.k}>{k}</div><div className={s.v}>{v}</div>{sub !== undefined && sub !== null && <div className={s.sub}>{sub}</div>}</div>;
}

export const Tiles = ({ children }: { children: ReactNode }) => <div className={s.tiles}>{children}</div>;
export const TipRow = ({ k, v }: { k: ReactNode; v: ReactNode }) => <div className={s.tipRow}><span>{k}</span><b>{v}</b></div>;
export const ChartEmpty = ({ children }: { children: ReactNode }) => <div className={s.empty}>{children}</div>;
