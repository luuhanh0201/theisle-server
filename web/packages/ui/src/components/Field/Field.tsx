import type { ReactNode } from 'react';
import styles from './Field.module.css';

/** Settings laid out in columns; each Field's label, input and hint line up with its row's. */
export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}

/**
 * One setting: its name and the setting's key under it, the input, a hint. `htmlFor` ties the
 * label to the input's id.
 */
export function Field({ label, keyName, hint, htmlFor, children }:
  { label: ReactNode; keyName?: string; hint?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor}>{label}{keyName && <span className={styles.key}>{keyName}</span>}</label>
      <div className={styles.control}>{children}</div>
      {hint ? <div className={styles.hint}>{hint}</div> : <div />}
    </div>
  );
}
