import type { ReactNode } from 'react';
import styles from './SectionTitle.module.css';

type Tone = 'accent' | 'chat' | 'kill' | 'dmg' | 'grow' | 'gar' | 'neutral';

/** A section's title: an emoji in a tinted square, the title (one line), a note. */
export function SectionTitle({ icon, title, sub, tone = 'chat', first = false }:
  { icon: string; title: ReactNode; sub?: ReactNode; tone?: Tone; first?: boolean }) {
  return (
    <div className={`${styles.title}${first ? ` ${styles.first}` : ''}`}>
      <span className={`${styles.ico} ${styles[tone]}`} aria-hidden="true">{icon}</span>
      <h2>{title}</h2>
      {sub !== undefined && <span className={styles.sub}>{sub}</span>}
    </div>
  );
}
