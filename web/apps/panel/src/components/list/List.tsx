import type { ReactNode } from 'react';
import { Button, TextInput } from '@isle/ui';
import s from './List.module.css';

/** A list's search box (the magnifier inside it) and, beside it, its filters. */
export function ListTools({ q, onQ, placeholder, children }: { q: string; onQ: (v: string) => void; placeholder: string; children?: ReactNode }) {
  return (
    <div className={s.toolbar}>
      <div className={s.search}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
        <TextInput type="search" value={q} placeholder={placeholder} autoComplete="off" aria-label={placeholder} onChange={(e) => onQ(e.target.value)} />
      </div>
      {children}
    </div>
  );
}

/** A few filters side by side (the panel's .seg): one is on. */
export function Seg<V extends string>({ value, options, onChange, label }: {
  value: V; options: ReadonlyArray<readonly [V, string]>; onChange: (v: V) => void; label: string;
}) {
  return (
    <div className={s.seg} role="group" aria-label={label}>
      {options.map(([v, l]) => <button key={v} type="button" className={v === value ? s.on : ''} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

/** "Hiển thị 21-40 / 95 người chơi · trang 2/5", ‹ 1 … 3 4 5 … 9 ›. Nothing when the list is empty. */
export function Pager({ total, page, limit, unit, onPage }: { total: number; page: number; limit: number; unit: string; onPage: (p: number) => void }) {
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / limit));
  const cur = Math.min(Math.max(1, page), pages);
  const from = (cur - 1) * limit + 1;
  const to = Math.min(cur * limit, total);
  const around = [...new Set([1, cur - 2, cur - 1, cur, cur + 1, cur + 2, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  return (
    <nav className={s.pager} aria-label={`Trang của danh sách ${unit}`}>
      <span className={s.count}>Hiển thị {from}-{to} / {total} {unit} · trang {cur}/{pages}</span>
      <Button variant="ghost" small disabled={cur <= 1} aria-label="Trang trước" onClick={() => onPage(cur - 1)}>‹</Button>
      {around.map((p, i) => (
        <span key={p} className={s.item}>{i > 0 && p - around[i - 1]! > 1 && <span className={s.gap}>…</span>}
          <Button variant="ghost" small className={p === cur ? s.on : undefined} aria-current={p === cur ? 'page' : undefined} onClick={() => onPage(p)}>{p}</Button></span>
      ))}
      <Button variant="ghost" small disabled={cur >= pages} aria-label="Trang sau" onClick={() => onPage(cur + 1)}>›</Button>
    </nav>
  );
}

/** One page of a list (page kept within bounds when the list shrinks). */
export function pageOf<T>(rows: T[], page: number, limit: number): { rows: T[]; page: number } {
  const pages = Math.max(1, Math.ceil(rows.length / limit));
  const p = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((p - 1) * limit, p * limit), page: p };
}

export type SortDir = 'asc' | 'desc';
/** A column header that sorts: ↕, then ▲ / ▼ when it is the one sorting. */
export function SortTh({ col, sort, onSort, children, title, className }: {
  col: string; sort: { col: string | null; dir: SortDir }; onSort: (col: string) => void; children: ReactNode; title?: string; className?: string;
}) {
  const on = sort.col === col;
  return (
    <th className={`${s.sortable}${on ? ` ${s.sorted}` : ''}${className ? ` ${className}` : ''}`} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined} title={title}>
      <button type="button" onClick={() => onSort(col)}>{children} <span className={s.ico}>{on ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button>
    </th>
  );
}

/** The count in a card's head ("12 người chơi"). */
export function Pill({ children }: { children: ReactNode }) {
  return <span className={s.pill}>{children}</span>;
}
