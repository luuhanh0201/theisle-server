import type { ReactNode } from 'react';
import styles from './Checkbox.module.css';

/** A tick box for choosing several things (on / off is a Switch), as ui-inputs.js draws it. */
export function Checkbox({ id, checked, onChange, label, disabled = false }:
  { id?: string; checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={styles.wrap}>
      <input id={id} type="checkbox" className={styles.box} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label !== undefined && <span>{label}</span>}
    </label>
  );
}

/** Tick boxes in tiles, several per row (a list of species, of commands…). */
export function CheckGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}
