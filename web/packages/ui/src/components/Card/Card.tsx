import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

/** A panel card: a raised surface. Put a CardHead and / or a CardBody in it. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={`${styles.card}${className ? ` ${className}` : ''}`} {...rest} />;
}

/** The card's title row: a heading (one line), a note beside it, anything on the right. */
export function CardHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className={styles.head}>
      <h2>{title}</h2>
      {sub !== undefined && <span className={styles.sub}>{sub}</span>}
      {children}
    </div>
  );
}

/** The card's content; `stack` lays its children out in a column with a gap (a settings form). */
export function CardBody({ stack = false, className, ...rest }: HTMLAttributes<HTMLDivElement> & { stack?: boolean }) {
  return <div className={[styles.body, stack ? styles.stack : '', className ?? ''].filter(Boolean).join(' ')} {...rest} />;
}
