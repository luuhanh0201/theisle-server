import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import styles from './Select.module.css';

export interface SelectOption<V extends string> { value: V; label: string; sub?: string }

/**
 * The system's select box (never the browser's own, AGENTS.md "UI"): a button showing the choice,
 * a list under it. Arrows move, Enter / Space pick, Esc or a click outside closes.
 */
export function Select<V extends string>({ id, value, options, onChange, disabled = false, 'aria-label': ariaLabel }: {
  id?: string; value: V; options: ReadonlyArray<SelectOption<V>>; onChange: (v: V) => void; disabled?: boolean; 'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();
  const chosen = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent): void => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const show = (): void => { setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); };
  const pick = (i: number): void => {
    const o = options[i];
    setOpen(false);
    if (o !== undefined && o.value !== value) onChange(o.value);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className={styles.wrap} ref={wrap}>
      <button id={id} type="button" className={styles.btn} disabled={disabled} aria-label={ariaLabel}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKey}>
        <span className={styles.val}>{chosen?.label ?? ''}</span>
        <svg className={styles.arrow} viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <ul className={styles.pop} role="listbox" id={listId}>
          {options.map((o, i) => (
            <li key={o.value} id={`${listId}-${i}`} role="option" aria-selected={o.value === value}
              className={`${styles.opt}${i === active ? ` ${styles.active}` : ''}`}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
              {o.label}{o.sub !== undefined && <span className={styles.sub}>{o.sub}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
