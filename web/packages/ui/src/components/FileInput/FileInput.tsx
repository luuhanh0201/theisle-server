import { useRef } from 'react';
import styles from './FileInput.module.css';

/**
 * A file chooser in the panel's colours (the panel before React styled input[type=file]'s button):
 * the native input does the picking, its button and the chosen name are drawn here.
 */
export function FileInput({ id, accept, file, onChange, disabled = false, 'aria-label': ariaLabel }: {
  id?: string; accept?: string; file: File | null; onChange: (f: File | null) => void; disabled?: boolean; 'aria-label'?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className={`${styles.wrap}${disabled ? ` ${styles.disabled}` : ''}`}>
      <input ref={ref} id={id} type="file" accept={accept} className={styles.native} disabled={disabled} aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      <button type="button" className={styles.btn} disabled={disabled} tabIndex={-1} aria-hidden="true" onClick={() => ref.current?.click()}>Chọn file</button>
      <span className={styles.name}>{file ? file.name : 'Chưa chọn file'}</span>
    </span>
  );
}
