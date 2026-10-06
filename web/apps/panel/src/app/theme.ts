import { useCallback, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'theme';   // the panel before React reads the same key: one choice for both

function stored(): Theme {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

/** Light or dark, kept in this browser; applied to <html data-theme>. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = stored();
    document.documentElement.dataset.theme = t;
    return t;
  });
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem(KEY, next); } catch { /* a private window: not remembered */ }
      return next;
    });
  }, []);
  return [theme, toggle];
}
