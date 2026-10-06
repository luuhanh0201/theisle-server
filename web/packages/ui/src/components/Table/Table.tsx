import type { ComponentProps } from 'react';
import styles from './Table.module.css';

/**
 * A list as a table (the panel's .audit-table look): scrolls sideways inside its box on a narrow
 * screen. `cards`: on a phone each row becomes a card instead, every cell named by its
 * `data-label` (give each <td> one; a cell without it spans the card, e.g. the row's buttons).
 */
export function Table({ className, cards = false, ...rest }: ComponentProps<'table'> & { cards?: boolean }) {
  return <div className={styles.wrap}><table className={[styles.table, cards ? styles.cards : '', className ?? ''].filter(Boolean).join(' ')} {...rest} /></div>;
}
