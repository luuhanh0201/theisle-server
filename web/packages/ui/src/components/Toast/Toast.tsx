import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import styles from './Toast.module.css';

type Kind = 'ok' | 'err';
interface ToastItem { id: number; text: string; kind: Kind }
type ShowToast = (text: string, kind?: Kind) => void;

const ToastContext = createContext<ShowToast | null>(null);
let nextId = 0;

/** Short messages at the bottom right, gone after `ms` (6 s, as the panel before React). */
export function ToastProvider({ children, ms = 6000 }: { children: ReactNode; ms?: number }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback<ShowToast>((text, kind = 'ok') => {
    const id = ++nextId;
    setItems((list) => [...list, { id, text, kind }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), ms);
  }, [ms]);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.wrap} role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`${styles.toast} ${styles[t.kind]}`}>{t.text}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

/** toast('Đã lưu') / toast('Lỗi…', 'err'), from inside a ToastProvider. */
export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (show === null) throw new Error('useToast: no ToastProvider above');
  return show;
}
