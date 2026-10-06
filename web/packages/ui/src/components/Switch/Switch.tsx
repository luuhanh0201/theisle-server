import type { ReactNode } from 'react';
import styles from './Switch.module.css';

/** An on / off switch (never a tick box for on / off), with its label beside it. */
export function Switch({ id, checked, onChange, label, disabled = false }:
  { id?: string; checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={styles.wrap}>
      <input id={id} type="checkbox" role="switch" className={styles.sw} checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} />
      {label !== undefined && <span>{label}</span>}
    </label>
  );
}
