import type { ReactNode } from 'react';
import styles from './PageHead.module.css';

/** A page's title (one line) and what the page is for; anything on the right. */
export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className={styles.head}>
      <div><h1>{title}</h1>{sub !== undefined && <p>{sub}</p>}</div>
      {children !== undefined && <div className={styles.right}>{children}</div>}
    </div>
  );
}
