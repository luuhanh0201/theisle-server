import type { ComponentProps } from 'react';
import styles from './TextArea.module.css';

/** A multi-line text box in the panel's style. */
export function TextArea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={`${styles.area}${className ? ` ${className}` : ''}`} {...rest} />;
}
