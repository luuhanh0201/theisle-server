import type { ComponentProps } from 'react';
import styles from './TextArea.module.css';

/** A text area in the panel's style (the TextInput of longer texts), resizable up and down only. */
export function TextArea({ className, rows = 2, ...rest }: ComponentProps<'textarea'>) {
  return <textarea rows={rows} className={`${styles.area}${className ? ` ${className}` : ''}`} {...rest} />;
}
