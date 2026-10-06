import { useSyncExternalStore } from 'react';

/** The site's pages, as #addresses (the same as before React: #home, #game, … #overlay). */
export const TABS = ['home', 'game', 'gara', 'map', 'ranking', 'skin', 'bag', 'shop', 'voice', 'overlay'] as const;
export type Tab = (typeof TABS)[number];
export const isTab = (x: string): x is Tab => (TABS as readonly string[]).includes(x);

/** #gara → 'gara'; anything else → 'home' (as app.js switchTab). */
export function parseTab(hash: string): Tab {
  const key = hash.replace(/^#\/?/, '');
  return isTab(key) ? key : 'home';
}

const subscribe = (cb: () => void): (() => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

/** The page shown now, redrawn on every change of the address. */
export function useTab(): Tab {
  return parseTab(useSyncExternalStore(subscribe, () => location.hash, () => ''));
}

/** Go to a page (a nav button, data-switch-tab before React). */
export function goTo(tab: Tab): void {
  if (location.hash !== `#${tab}`) location.hash = tab;
}
