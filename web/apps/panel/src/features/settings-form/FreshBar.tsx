import { Button } from '@isle/ui';
import styles from './Bars.module.css';

/** "Có thay đổi mới từ máy chủ": the copy on the server changed while this page was open. */
export function FreshBar({ show, dirty, onReload }: { show: boolean; dirty: boolean; onReload: () => void }) {
  if (!show) return null;
  return (
    <div className={styles.fresh} role="status">
      <span>Có thay đổi mới từ máy chủ.</span>
      {dirty && <span className={styles.muted}>Lưu hoặc bỏ thay đổi của bạn trước khi tải lại.</span>}
      <Button small onClick={onReload}>{dirty ? 'Bỏ thay đổi và tải lại' : 'Tải lại'}</Button>
    </div>
  );
}
