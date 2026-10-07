import { useSyncExternalStore } from 'react';

/**
 * Xóm Gáy Launcher's bridge into this page (launcher/src/preload.js, `window.isleLauncher`), typed.
 * Absent in a browser. Its on*() calls cannot be undone, so each is subscribed once here and handed
 * to React through a small store.
 */
export interface UpdateState {
  phase: 'dev' | 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error' | string;
  current?: string; version?: string; percent?: number; error?: string;
}
export interface GameMode { on: boolean; keep: Record<string, boolean> }

export interface IsleLauncher {
  version?: string;
  platform?: string;
  updateGet?: () => UpdateState | null;
  updateCheck?: () => void;
  updateInstall?: () => void;
  onUpdate?: (cb: (st: UpdateState) => void) => void;
  playGame?: () => void;
  gameModeGet?: () => GameMode;
  gameModeSet?: (on: boolean) => void;
  gameModeKeep?: (keep: Record<string, boolean>) => void;
  onGameMode?: (cb: (st: GameMode) => void) => void;
  overlayGet?: () => unknown;
  overlayGame?: (game: unknown) => void;
  onOverlayChanged?: (cb: (s: unknown) => void) => void;
  overlayMiniFrame?: (frame: unknown) => void;
  onBigMap?: (cb: (open: boolean) => void) => void;
  [key: string]: unknown;
}

declare global {
  interface Window { isleLauncher?: IsleLauncher }
}

export const launcher = (): IsleLauncher | undefined => window.isleLauncher;
export const inLauncher = (): boolean => Boolean(window.isleLauncher);

/** A value the launcher pushes (game mode, update state): read once, then kept up to date. */
function pushed<T>(get: () => T, on: ((cb: (v: T) => void) => void) | undefined): { use: () => T; now: () => T; listen: (cb: (v: T) => void) => () => void } {
  let value = get();
  const subs = new Set<() => void>();
  on?.((v) => { value = v; for (const s of subs) s(); });
  const subscribe = (cb: () => void): (() => void) => { subs.add(cb); return () => subs.delete(cb); };
  // One launcher listener for the whole page (app.js registered each once): others listen here.
  return { use: () => useSyncExternalStore(subscribe, () => value, () => value), now: () => value, listen: (cb) => subscribe(() => cb(value)) };
}

let gm: ReturnType<typeof pushed<GameMode>> | null = null;
let upd: ReturnType<typeof pushed<UpdateState | null>> | null = null;

/** Game mode (main.js): the launcher out of the way while playing; in the background the page does not draw. */
export function gameMode(): ReturnType<typeof pushed<GameMode>> {
  gm ??= pushed(() => launcher()?.gameModeGet?.() ?? { on: false, keep: {} }, launcher()?.onGameMode?.bind(launcher()));
  return gm;
}
export const useGameMode = (): GameMode => gameMode().use();

/** The launcher's update (1.0.7+): checking, downloading, ready to install. */
export function updateState(): ReturnType<typeof pushed<UpdateState | null>> {
  upd ??= pushed(() => launcher()?.updateGet?.() ?? null, launcher()?.onUpdate?.bind(launcher()));
  return upd;
}
export const useUpdateState = (): UpdateState | null => updateState().use();

/** The update button: install when ready, else look for one now. */
export function updateAction(): void {
  const l = launcher();
  const st = l?.updateGet?.();
  if (st && st.phase === 'ready') l?.updateInstall?.();
  else l?.updateCheck?.();
}

/** The update button's text and state, as before React (app.js). '' = hidden (a dev build). */
export function updateLabel(st: UpdateState): { text: string; disabled: boolean; ready: boolean; title: string } {
  const text = ({
    dev: '', idle: '⟳ Kiểm tra cập nhật', checking: 'Đang kiểm tra…', latest: '✓ Bản mới nhất · kiểm tra lại',
    downloading: `Đang tải v${st.version}… ${st.percent ?? 0}%`, ready: `⬆ Cập nhật lên v${st.version}`,
    error: '⚠ Không kiểm tra được · thử lại',
  } as Record<string, string>)[st.phase] ?? '⟳ Kiểm tra cập nhật';
  return {
    text,
    disabled: st.phase === 'checking' || st.phase === 'downloading',
    ready: st.phase === 'ready',
    title: st.phase === 'ready' ? 'Launcher sẽ tắt, cài bản mới rồi tự mở lại (voice ngắt vài giây)'
      : st.phase === 'error' ? `Lỗi: ${st.error || 'không rõ'}` : `Đang dùng v${st.current}`,
  };
}

/** In the launcher, its window behind the game (not focused) or in the tray. */
export const inBackground = (): boolean => inLauncher() && (document.hidden || !document.hasFocus());

/**
 * Which look inside the launcher (owner, 2026-10-07): its own (app/launcher/, the launcher's design: a bar on top,
 * Trang chủ / Trò chơi / Overlay HUD) or the web site's. The same pages and calls either way; the choice is kept in
 * this browser (`isle_ui`: 'web' for the web look), the launcher's own by default. Always the web look in a browser.
 */
export const UI_KEY = 'isle_ui';
export function launcherUi(): boolean {
  if (!inLauncher()) return false;
  try { return localStorage.getItem(UI_KEY) !== 'web'; } catch { return true; }
}
/** Switch the look (the page is drawn again from the start). */
export function setLauncherUi(on: boolean): void {
  try { localStorage.setItem(UI_KEY, on ? 'launcher' : 'web'); } catch { /* this visit only: nothing to keep */ }
  location.reload();
}
