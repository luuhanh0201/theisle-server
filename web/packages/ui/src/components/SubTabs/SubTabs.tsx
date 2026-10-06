import styles from './SubTabs.module.css';

export interface SubTab { id: string; label: string; href: string; dot?: boolean }

/** The row of a page's sub-pages; `dot` marks one with unsaved changes. */
export function SubTabs({ tabs, active, label }: { tabs: SubTab[]; active: string; label: string }) {
  return (
    <nav className={styles.subtabs} aria-label={label}>
      {tabs.map((t) => (
        <a key={t.id} href={t.href} className={t.id === active ? styles.on : undefined} aria-current={t.id === active ? 'page' : undefined}>
          {t.label}{t.dot && <span className={styles.dot} title="Có thay đổi chưa lưu" />}
        </a>
      ))}
    </nav>
  );
}
