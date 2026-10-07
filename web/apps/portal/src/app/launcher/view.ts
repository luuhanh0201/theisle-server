import { useSyncExternalStore } from 'react';
import type { PlayerMe } from '@isle/api';
import { useTab, type Tab } from '../router';

/** A page of the launcher's look: one of the site's (#home…) or Luật & Dinh Dưỡng (#rules, the web's Trang chủ part). */
export type LxView = Tab | 'rules';
const hashNow = (): string => location.hash.replace(/^#\/?/, '');
const subscribe = (cb: () => void): (() => void) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); };
export function useLxView(): LxView {
  const tab = useTab();
  const raw = useSyncExternalStore(subscribe, hashNow, () => '');
  return raw === 'rules' ? 'rules' : tab;
}
export const goView = (v: LxView): void => { if (hashNow() !== v) location.hash = v; };

/** The three parts on top (the launcher's design, 2026-10-07): Trang chủ (+ Voice 3D), Trò chơi, Overlay HUD. */
export type LxGroup = 'home' | 'play' | 'overlay';
export const groupOf = (v: LxView): LxGroup => (v === 'home' || v === 'voice' ? 'home' : v === 'overlay' ? 'overlay' : 'play');
/** Trò chơi's first page: the bag when it is open to them, else the garage. */
export const firstPlay = (me: PlayerMe | null | undefined): LxView => (me?.bag ? 'bag' : 'gara');

