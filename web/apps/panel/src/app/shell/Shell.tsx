import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import styles from './Shell.module.css';

/** The page: the sidebar (a top bar on a narrow screen) and the page's content. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.app}>
      <Sidebar />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
