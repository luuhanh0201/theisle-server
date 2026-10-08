import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { popupHost } from '../popupHost';
import styles from './SuggestInput.module.css';

export interface Suggestion { value: string; label?: string }

/**
 * A text box with the system's suggestion list (never the browser's datalist look): the matches of
 * what is typed, under the box; arrows + Enter or a click take one.
 */
export function SuggestInput({ value, onChange, suggestions, className, ...rest }:
  Omit<ComponentProps<'input'>, 'value' | 'onChange'> & { value: string; onChange: (v: string) => void; suggestions: ReadonlyArray<Suggestion> }) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const q = value.trim().toLowerCase();
  const items = (q ? suggestions.filter((s) => s.value.toLowerCase().includes(q) || (s.label ?? '').toLowerCase().includes(q)) : suggestions)
    .filter((s) => s.value !== value).slice(0, 30);
  useEffect(() => {
    if (!open) return undefined;
    const place = (): void => { const r = box.current?.getBoundingClientRect(); if (r) setPos({ left: r.left, top: r.bottom + 4, width: r.width }); };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);
  const take = (s: Suggestion | undefined): void => { if (!s) return; onChange(s.value); setOpen(false); };
  return (
    <>
      <input ref={box} {...rest} className={`${styles.input}${className ? ` ${className}` : ''}`} value={value} autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true); setOn(0); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!open || items.length === 0) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setOn((i) => Math.min(items.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setOn((i) => Math.max(0, i - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); take(items[on]); }
          else if (e.key === 'Escape') setOpen(false);
        }} />
      {open && pos && items.length > 0 && createPortal(
        <div className={styles.pop} role="listbox" style={{ left: pos.left, top: pos.top, width: pos.width }}>
          {items.map((s, i) => (
            <div key={s.value} role="option" aria-selected={i === on} className={`${styles.opt}${i === on ? ` ${styles.on}` : ''}`}
              onMouseDown={(e) => { e.preventDefault(); take(s); }} onMouseEnter={() => setOn(i)}>
              <span>{s.value}</span>{s.label && <small>{s.label}</small>}
            </div>
          ))}
        </div>, popupHost(box.current))}
    </>
  );
}
