import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { Button } from '../Button/Button';
import { Icon } from '../Icon/Icon';
import styles from './Dialog.module.css';

/**
 * A confirm / ask dialog (never the browser's confirm()): a title, a body, OK and Huỷ. Esc or a
 * click outside closes it; `error` shows under the body (a failed action stays open).
 */
export function Dialog({ open, title, children, okLabel, onOk, onClose, danger = false, busy = false, error = null }: {
  open: boolean; title: ReactNode; children?: ReactNode; okLabel: string; onOk: () => void; onClose: () => void;
  danger?: boolean; busy?: boolean; error?: string | null;
}) {
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    // A text box in the body takes the focus itself; otherwise OK has it.
    if (!document.activeElement?.closest('[role="dialog"]')) okRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const submit = (e: FormEvent): void => { e.preventDefault(); if (!busy) onOk(); };
  return (
    <div className={styles.back} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className={styles.modal} role="dialog" aria-modal="true" onSubmit={submit}>
        <h3>{danger && <Icon name="warn" />}{title}</h3>
        {children !== undefined && <div className={styles.body}>{children}</div>}
        <div className={styles.err}>{error ?? ''}</div>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button ref={okRef} type="submit" variant={danger ? 'dangerSolid' : 'primary'} disabled={busy}>{okLabel}</Button>
        </div>
      </form>
    </div>
  );
}
