import type { ReactNode } from 'react';
import styles from './Checkbox.module.css';

/** The system's tick box (one of a set: species, rights), with its label. On / off alone is a Switch. */
export function Checkbox({ id, checked, onChange, label, disabled = false }:
  { id?: string; checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={styles.wrap}>
      <input id={id} type="checkbox" className={styles.box} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Tick boxes in a grid of tiles (the panel's .check-grid). */
export function CheckGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}
