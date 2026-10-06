import { Button } from '@isle/ui';
import { useDrafts } from './drafts';
import styles from './Bars.module.css';

/** At the bottom: this page has unsaved changes (Lưu), and which other pages do. */
export function UnsavedBar({ here }: { here: string }) {
  const drafts = useDrafts();
  if (drafts.length === 0) return null;
  const mine = drafts.find(([, d]) => d.href === here)?.[1];
  const others = drafts.filter(([, d]) => d !== mine).map(([, d]) => d);
  return (
    <div className={styles.unsaved}>
      {mine && <><span>Trang này có thay đổi <b>chưa lưu</b>.</span><Button small onClick={mine.save}>Lưu</Button></>}
      {others.length > 0 && (
        <span className={styles.muted}>{mine ? 'Còn' : 'Có thay đổi chưa lưu ở'}: {others.map((d, i) => (
          <span key={d.href}>{i > 0 && ', '}<a href={d.href}>{d.label}</a></span>
        ))}</span>
      )}
    </div>
  );
}
