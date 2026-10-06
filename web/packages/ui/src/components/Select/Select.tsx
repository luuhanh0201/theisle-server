import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import styles from './Select.module.css';

export interface SelectOption<V extends string = string> { value: V; label: string; sub?: string; group?: string; disabled?: boolean }

const SEARCH_FROM = 12;

/**
 * The system's select box (as ui-select.js draws it, never the browser's own): a button showing
 * the choice, a list under it (fixed to the window), a search box from 12 choices. Keyboard:
 * Enter / Space / arrows open; arrows, Home, End move; Enter picks; Esc / Tab close.
 */
export function Select<V extends string>({ id, value, options, onChange, placeholder = 'Chọn…', disabled = false, 'aria-label': ariaLabel, chosen = false }: {
  id?: string; value: V | null; options: ReadonlyArray<SelectOption<V>>; onChange: (v: V) => void; placeholder?: string;
  disabled?: boolean; 'aria-label'?: string; chosen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value) ?? null;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => `${o.label} ${o.sub ?? ''} ${o.group ?? ''}`.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const place = (): void => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up = below < 220 && above > below;
    const maxHeight = Math.max(160, Math.min(360, up ? above : below));
    setPos({ left: Math.min(r.left, window.innerWidth - Math.max(220, r.width) - 8), top: up ? r.top - maxHeight - 4 : r.bottom + 4, width: r.width, maxHeight });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e: Event): void => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || document.getElementById(listId)?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event): void => { if (!document.getElementById(listId)?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', place); };
  }, [open, listId]);

  const openList = (): void => {
    if (disabled) return;
    setQuery('');
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const pick = (o: SelectOption<V> | undefined): void => {
    if (!o || o.disabled) return;
    setOpen(false);
    btn.current?.focus();
    if (o.value !== value) onChange(o.value);
  };
  const move = (to: number): void => {
    if (shown.length === 0) return;
    let i = Math.max(0, Math.min(shown.length - 1, to));
    const step = to >= active ? 1 : -1;
    while (shown[i]?.disabled && i + step >= 0 && i + step < shown.length) i += step;
    setActive(i);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); openList(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(active - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(shown.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(shown[active]); }
  };

  let lastGroup: string | undefined;
  return (
    <>
      <button ref={btn} id={id} type="button" className={`${styles.btn}${chosen ? ` ${styles.chosen}` : ''}`} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openList())} onKeyDown={onKey}>
        <span className={`${styles.val}${current ? '' : ` ${styles.ph}`}`}>{current?.label ?? placeholder}</span>
        <svg className={styles.arrow} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
      </button>
      {open && pos && createPortal(
        <div id={listId} className={styles.pop} style={{ left: pos.left, top: pos.top, minWidth: Math.max(220, pos.width), maxHeight: pos.maxHeight }}>
          {options.length >= SEARCH_FROM && (
            <input className={styles.search} autoFocus placeholder="Tìm…" value={query} aria-label="Tìm"
              onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKey} />
          )}
          <div className={styles.list} role="listbox" aria-label={ariaLabel}>
            {shown.length === 0 && <div className={styles.empty}>Không có lựa chọn nào khớp.</div>}
            {shown.map((o, i) => {
              const head = o.group !== undefined && o.group !== lastGroup ? <div className={styles.group}>{o.group}</div> : null;
              lastGroup = o.group;
              return (
                <div key={o.value}>
                  {head}
                  <div role="option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined}
                    className={`${styles.opt}${i === active ? ` ${styles.active}` : ''}${o.group !== undefined ? ` ${styles.inGroup}` : ''}`}
                    onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}>
                    <span>{o.label}</span>{o.sub && <span className={styles.sub}>{o.sub}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>, document.body)}
    </>
  );
}
