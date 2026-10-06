import type { HTMLAttributes } from 'react';
import styles from './Hint.module.css';

/** A small muted explanation under a field or at the top of a form. */
export function Hint({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`${styles.hint}${className ? ` ${className}` : ''}`} {...rest} />;
}

/** A setting's or a file's technical name, in monospace. */
export function Mono({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={`${styles.mono}${className ? ` ${className}` : ''}`} {...rest} />;
}
