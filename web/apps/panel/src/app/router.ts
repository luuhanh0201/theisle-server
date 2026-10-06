import { useSyncExternalStore } from 'react';
import { MOVED, SUBS, isTab, subAllowed, type Access, type TabId } from './nav';

/** #mods/tele → { tab: 'mods', sub: 'tele' }; an old address (MOVED) lands where the page is now. */
export function parseHash(hash: string): { tab: TabId; sub: string | null } {
  let key = decodeURIComponent(hash.replace(/^#\/?/, ''));
  key = MOVED[key] ?? key;
  const [tab = '', sub = null] = key.split('/');
  return isTab(tab) ? { tab, sub } : { tab: 'overview', sub: null };
}

/**
 * The sub-page to show: the one asked for when it exists and is allowed, else the first allowed.
 * A sub-page may carry a part after a colon (#server/cfg:spawn, the Game.ini group): kept as asked.
 */
export function pickSub(a: Access, tab: TabId, asked: string | null): string | null {
  const subs = SUBS[tab];
  if (subs === undefined) return null;
  const id = asked?.split(':')[0] ?? null;
  if (asked !== null && id !== null && subs.some(([x]) => x === id) && subAllowed(a, tab, id)) return asked;
  return subs.find(([id]) => subAllowed(a, tab, id))?.[0] ?? subs[0]?.[0] ?? null;
}

const subscribe = (cb: () => void): (() => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

/** Where the panel is now (the address after #), redrawn on every change. */
export function useHashRoute(): { tab: TabId; sub: string | null } {
  const hash = useSyncExternalStore(subscribe, () => location.hash, () => '');
  return parseHash(hash);
}

export const hrefOf = (tab: TabId, sub?: string | null): string => `#${tab}${sub ? `/${sub}` : ''}`;
