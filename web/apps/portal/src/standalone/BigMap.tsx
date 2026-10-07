import { useEffect, useRef, useState } from 'react';
import { Slider } from '@isle/ui';
import { createMap, LOOK_DEFAULT, type MapApi } from '@portal/map';

/** The launcher's calls for the big map (launcher/src/preload.js). */
interface BigMapLauncher {
  keyLabel?: (k: string) => string;
  bigMapClose?: () => void;
  bigMapTyping?: (on: boolean) => void;
  onBigMap?: (cb: (open: boolean) => void) => void;
  onOverlayGame?: (cb: (g: unknown) => void) => void;
  overlayGameGet?: () => unknown;
}
const L = (): BigMapLauncher | undefined => (window as unknown as { isleLauncher?: BigMapLauncher }).isleLauncher;

// How see-through: the island and the veil over the game, kept in this browser.
export const LOOK_KEY = 'isle-bigmap-look.v1';
export function loadLook(): { map: number; dim: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(LOOK_KEY) ?? 'null') as { map?: unknown; dim?: unknown } | null;
    return { map: Number.isFinite(raw?.map) ? raw?.map as number : LOOK_DEFAULT.map, dim: Number.isFinite(raw?.dim) ? raw?.dim as number : LOOK_DEFAULT.dim };
  } catch {
    return { ...LOOK_DEFAULT };
  }
}

/** What the player page hands the overlay each second, onto the map (bigmap.js feed). */
export function feed(map: MapApi, g: unknown): void {
  if (!g || typeof g !== 'object') return;
  const d = g as Record<string, unknown>;
  map.update(d['dino'] ?? null);
  map.setAi((d['ai'] as unknown[] | undefined) ?? []);
  map.setFish((d['fish'] as unknown[] | undefined) ?? []);
  map.setEscapees((d['escapees'] as unknown[] | undefined) ?? []);
  map.setFriends(Array.isArray(d['friends']) ? d['friends'] as never : null);
  if (Array.isArray(d['aiZones'])) map.setAiZones(d['aiZones']);
  if (d['heat'] !== undefined) map.setHeat(d['heat']);
}

// A text box with the focus (a target's name): the map key types there instead of closing the map.
const typing = (): boolean => {
  const el = document.activeElement as HTMLElement | null;
  return Boolean(el && ((el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range') || el.tagName === 'TEXTAREA' || el.isContentEditable));
};

/**
 * bigmap.html in React: the big map over the game. The launcher opens it on its key (M) in a see-through window.
 * The map is map.js (drag, zoom, layers, a target, saved points), fed with what the player page sends the overlay each
 * second; layers, target and trail are kept in this site's storage, so the map page and the mini map follow.
 */
export function BigMap() {
  const box = useRef<HTMLDivElement>(null);
  const [look, setLook] = useState(loadLook);
  const mapRef = useRef<MapApi | null>(null);
  const close = (): void => { L()?.bigMapClose?.(); };

  useEffect(() => {
    const root = box.current;
    if (!root || mapRef.current) return undefined;
    const l = L();
    // A tap off the island's picture closes the map (owner, 2026-10-05), it no longer drops a target there.
    const map = createMap(root, { overlay: true, onOutsideTap: () => l?.bigMapClose?.() });
    mapRef.current = map;
    map.setLook(loadLook());
    const focusin = (): void => l?.bigMapTyping?.(typing());
    const focusout = (): void => { setTimeout(() => l?.bigMapTyping?.(typing()), 0); };
    const keydown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (typing()) { (document.activeElement as HTMLElement | null)?.blur(); return; }
      l?.bigMapClose?.();
    };
    document.addEventListener('focusin', focusin);
    document.addEventListener('focusout', focusout);
    document.addEventListener('keydown', keydown);
    // Each time it opens: the whole island in the middle of the screen again, also once the window has gone full
    // screen (it opens smaller first), until you move or zoom the map yourself.
    let untouched = true;
    l?.onBigMap?.((open) => { if (open) { untouched = true; map.resetView(); } });
    const resize = (): void => { if (untouched) map.resetView(); };
    window.addEventListener('resize', resize);
    const touched = (): void => { untouched = false; };
    root.addEventListener('pointerdown', touched, { passive: true });
    root.addEventListener('wheel', touched, { passive: true });
    if (l?.onOverlayGame) {
      l.onOverlayGame((g) => feed(map, g));
      feed(map, l.overlayGameGet?.());
    } else {
      // Opened in a browser: the map, nothing live (that comes from the launcher).
      map.update(null);
    }
    return () => {
      document.removeEventListener('focusin', focusin);
      document.removeEventListener('focusout', focusout);
      document.removeEventListener('keydown', keydown);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const change = (field: 'map' | 'dim', pct: number): void => {
    const next = { ...look, [field]: pct / 100 };
    setLook(next);
    mapRef.current?.setLook(next);
    try { localStorage.setItem(LOOK_KEY, JSON.stringify(next)); } catch { /* not remembered */ }
  };
  const label = L()?.keyLabel;
  return (
    <>
      <div className="bm-bar">
        <span><b>🗺️ Bản đồ</b> <span className="muted" id="bm-key">{label ? `· ${label('bigmap')} hoặc Esc để đóng` : '· M để đóng'}</span></span>
        <label>Bản đồ <Slider id="bm-map" min={20} max={100} step={5} value={Math.round(look.map * 100)} onChange={(v) => change('map', v)} /></label>
        <label>Nền tối <Slider id="bm-dim" min={0} max={90} step={5} value={Math.round(look.dim * 100)} onChange={(v) => change('dim', v)} /></label>
        <button type="button" id="bm-close" title="Đóng (Esc)" onClick={close}>✕ Đóng</button>
      </div>
      <div id="map" ref={box} />
    </>
  );
}
