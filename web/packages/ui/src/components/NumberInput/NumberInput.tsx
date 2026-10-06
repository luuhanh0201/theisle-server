import { useEffect, useState } from 'react';
import styles from './NumberInput.module.css';

/**
 * The system's number box (never the browser's spinner, AGENTS.md "UI"): − / + step it, the
 * typed value is kept as text while typing and clamped to min..max when the box is left.
 * `onChange` gets a number (NaN never: an empty or broken entry goes back to the last value).
 */
export function NumberInput({ id, value, onChange, min, max, step = 1, disabled = false, 'aria-label': ariaLabel }: {
  id?: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
  disabled?: boolean; 'aria-label'?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const clamp = (v: number): number => {
    let n = v;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    // Keep the step's decimals, not float noise (0.1 + 0.2).
    const decimals = (String(step).split('.')[1] ?? '').length;
    return Number(n.toFixed(decimals));
  };
  const commit = (raw: string): void => {
    const n = Number(raw.replace(',', '.'));
    if (raw.trim() === '' || !Number.isFinite(n)) { setText(String(value)); return; }
    const c = clamp(n);
    setText(String(c));
    if (c !== value) onChange(c);
  };
  const bump = (dir: 1 | -1): void => { const c = clamp(value + dir * step); if (c !== value) onChange(c); };
  return (
    <span className={`${styles.nf}${disabled ? ` ${styles.disabled}` : ''}`}>
      <button type="button" className={styles.b} tabIndex={-1} aria-label="Giảm" disabled={disabled || (min !== undefined && value <= min)} onClick={() => bump(-1)}>−</button>
      <input id={id} type="text" inputMode="decimal" aria-label={ariaLabel} value={text} disabled={disabled}
        onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'ArrowUp') { e.preventDefault(); bump(1); }
          if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1); }
        }} />
      <button type="button" className={styles.b} tabIndex={-1} aria-label="Tăng" disabled={disabled || (max !== undefined && value >= max)} onClick={() => bump(1)}>+</button>
    </span>
  );
}
