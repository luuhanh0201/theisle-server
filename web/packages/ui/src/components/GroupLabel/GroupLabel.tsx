import type { ReactNode } from 'react';
import styles from './GroupLabel.module.css';

/** A small upper-case heading over a group of rows. */
export function GroupLabel({ children }: { children: ReactNode }) {
  return <div className={styles.label}>{children}</div>;
}
