import type { InputHTMLAttributes } from 'react';
import styles from './TextInput.module.css';

/** A text box in the panel's style (text, password, search: never number / date, see NumberInput). */
export function TextInput({ className, type = 'text', ...rest }: InputHTMLAttributes<HTMLInputElement> & { type?: 'text' | 'password' | 'search' | 'url' }) {
  return <input type={type} className={`${styles.input}${className ? ` ${className}` : ''}`} {...rest} />;
}
