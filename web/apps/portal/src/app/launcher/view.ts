import { useTab, type Tab } from '../router';

/** A page of the launcher's look: one of the site's (#home…). Luật & Dinh Dưỡng is not in it (owner, 2026-10-07). */
export type LxView = Tab;
const hashNow = (): string => location.hash.replace(/^#\/?/, '');
export function useLxView(): LxView {
  return useTab();
}
export const goView = (v: LxView): void => { if (hashNow() !== v) location.hash = v; };

/** The three parts on top (the launcher's design, 2026-10-07): Trang chủ (+ Voice), Trò chơi, Overlay HUD. */
export type LxGroup = 'home' | 'play' | 'overlay';
export const groupOf = (v: LxView): LxGroup => (v === 'home' || v === 'voice' ? 'home' : v === 'overlay' ? 'overlay' : 'play');
/** Trò chơi's first page: Live Monitor, the first of its menu (owner, 2026-10-07). */
export const firstPlay = (): LxView => 'game';

