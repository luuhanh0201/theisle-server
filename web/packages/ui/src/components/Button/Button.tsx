import type { ComponentProps } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'soft' | 'ghost' | 'danger' | 'dangerSolid';

/**
 * The panel's buttons: primary (gradient, a save), soft (an action), ghost (secondary), danger.
 * `type` defaults to "button": a button in a form never submits by accident.
 */
export function Button({ variant = 'primary', small = false, className, type = 'button', ...rest }:
  ComponentProps<'button'> & { variant?: Variant; small?: boolean }) {
  const cls = [styles.btn, styles[variant], small ? styles.sm : '', className ?? ''].filter(Boolean).join(' ');
  return <button type={type} className={cls} {...rest} />;
}
