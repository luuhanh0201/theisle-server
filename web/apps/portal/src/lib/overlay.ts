import type { QueryClient } from '@tanstack/react-query';
import type { PlayerMe } from '@isle/api';
import { loadWaypoints } from '@portal/map';
import { parseTab } from '../app/router';
import { portalGet } from './http';
import { gameMode, launcher } from './launcher';
import { getMap, loadAi, loadAiZones, loadHeat, mapData, mapIfMade, setFriendSpots } from './mapService';
import { ME } from './queries';

/*
 * Xóm Gáy Launcher's overlay (app.js before React), for the whole visit, whatever page is shown and also in
 * game mode: the same data this page has, handed over each second (overlayGame: your dino, the AI, the zones,
 * where players are, escaped inmates, your friends, the map's target); the mini map widget drawn from this
 * page's map (map.js paintMini) and sent as a picture; the big map (key M) fed while it is open. Nothing in
 * a browser: every call is the launcher's.
 */

interface OverlayWidgetMap { enabled?: boolean; scale?: number; radius?: number; rotate?: string; shape?: string; show?: Record<string, boolean> }
interface OverlaySettings { enabled?: boolean; widgets?: { map?: OverlayWidgetMap } }
interface OverlayLauncher {
  overlayGet?: () => { settings?: OverlaySettings; sizes?: { map?: [number, number] } } | null;
  overlayGame?: (g: unknown) => void;
  overlayMiniFrame?: (f: { image: Uint8Array; type: string; meta?: MiniMeta }) => Promise<unknown> | unknown;
  /** 1.0.39+: the widget moves and turns a v2 picture after your dino itself (launcher/src/minimap.js). */
  overlayMiniV2?: boolean;
  onOverlayChanged?: (cb: (s: OverlaySettings | null) => void) => void;
  onBigMap?: (cb: (open: boolean) => void) => void;
}
/** A v2 mini map picture: where its middle is in the world (cm), its scale, its size, the friends layer on. */
interface MiniMeta { v: 2; cx: number; cy: number; pxPerM: number; w: number; h: number; friends: boolean }
const L = (): OverlayLauncher | null => (launcher() as OverlayLauncher | undefined) ?? null;

let me: PlayerMe | null = null;
let overlaySettings: OverlaySettings | null = null;
let miniMapOn = false;
let miniMapAi = false;
let bigMapOpen = false;
let miniSize: [number, number] | null = null;

/** The map page shown and seen: it reads the AI, zones, heat and friends itself (MapCard, Friends). */
const mapShown = (): boolean => parseTab(location.hash) === 'map' && !document.hidden;

function readOverlayAi(settings: OverlaySettings | null): void {
  if (settings) overlaySettings = settings;
  const got = L()?.overlayGet?.();
  if (Array.isArray(got?.sizes?.map)) miniSize = got.sizes.map;
  const m = overlaySettings?.widgets?.map;
  const gm = gameMode().now();
  // The mini map shown at all: escaped inmates are drawn on it whatever the AI setting.
  miniMapOn = Boolean(overlaySettings?.enabled && m?.enabled && (!gm.on || gm.keep['map']));
  miniMapAi = Boolean(miniMapOn && m?.show && m.show['ai'] !== false);
}

/** What the overlay's widgets show, each second (app.js pushOverlayGame). */
export function pushOverlayGame(p: PlayerMe | null): void {
  const l = L();
  if (!l?.overlayGame) return;
  const dino = p?.dino ?? null;
  const d = mapData();
  const map = mapIfMade();
  l.overlayGame({
    // Whose account the launcher is on: the widgets say it when no dino shows.
    player: p ? { name: p.name ?? null, online: p.online === true } : null,
    dino: dino ? {
      species: dino.species, growth: dino.growth, vitals: dino.vitals, max: dino.max,
      position: dino.position, trail: dino.trail, prime: dino.prime,
    } : null,
    ai: d.ai, fish: d.fish, aiZones: d.aiZones, heat: d.heat, escapees: d.escapees,
    // Your friends in game (Kết bạn): null when the feature is not open to you.
    friends: d.friends,
    // The point set on the map: the mini map draws a line to it.
    target: map ? map.getTarget() : loadWaypoints().target,
  });
}

// The launcher's mini map widget: this page's map (map.js paintMini), the very layers, target and trail set on
// the map page or the big map, drawn at the widget's size and sent as a picture each second.
// Launcher 1.0.39+ (overlayMiniV2): a v2 picture instead, north up and wider than the widget (MINI_V2_ROOM), without
// your arrow, with its middle in the world; the widget moves and turns it after your dino between two positions
// (owner, 2026-10-08: the mini map jumped once a second). It is made again only when something on it changed, or
// your dino got near its edge (half its spare room): no more pictures encoded than before.
let miniCanvas: HTMLCanvasElement | null = null;
let miniBusy = false;
// Standing still, nothing new around: the picture sent is still right, drawn again only every MINI_SAME_MS.
// Below the widget's MINI_FRESH_MS (4 s, launcher 1.0.38): with 5 s it gave up the picture for its own drawing
// for a second, every 5 s, the mini map flashing between two looks while you stood still.
let miniKey = '';
let miniSentAt = 0;
const MINI_SAME_MS = 3000;
/** How much wider than the widget a v2 picture is: north up, turned by the widget, its corners must still fill it. */
const MINI_V2_ROOM = { heading: 1.5, north: 1.2 } as const;
function sendMiniFrame(): void {
  const l = L();
  const m = overlaySettings?.widgets?.map;
  const map = mapIfMade();
  if (!l?.overlayMiniFrame || !miniMapOn || !map || !m || miniBusy) return;
  const [width, height] = miniSize ?? [260 * (m.scale ?? 100) / 100, 260 * (m.scale ?? 100) / 100];
  const p = me?.dino?.position;
  const d = mapData();
  const v2 = l.overlayMiniV2 === true;
  const radiusM = m.radius ?? 500;
  const room = m.rotate === 'heading' ? MINI_V2_ROOM.heading : MINI_V2_ROOM.north;
  // v2: a new picture once your dino is half the spare room from its middle (the widget turns it: no heading here).
  const spareCm = radiusM * 100 * (room - (m.rotate === 'heading' ? Math.SQRT2 : 1));
  const where = !p ? null : v2 ? [Math.round(p.x / (spareCm / 2)), Math.round(p.y / (spareCm / 2))]
    : [Math.round(p.x / 50), Math.round(p.y / 50), Math.round((p.yaw ?? 0) / 2)];
  const round = (list: unknown[] | null | undefined): number[][] => ((list ?? []) as Array<{ x: number; y: number }>).map((a) => [Math.round(a.x / 100), Math.round(a.y / 100)]);
  let layers = '';
  try { layers = localStorage.getItem('portalMapLayers.v2') ?? ''; } catch { /* defaults */ }
  const key = JSON.stringify([v2, width, height, m.radius, m.rotate, layers, map.getTarget(), where,
    round(d.ai), round(d.fish), round(d.escapees), round(d.friends as unknown[] | null), d.aiZones?.length ?? 0,
    (d.heat as { t?: number } | null)?.t ?? 0, me?.dino?.trail?.length ?? 0]);
  if (key === miniKey && Date.now() - miniSentAt < MINI_SAME_MS) return;
  miniKey = key;
  miniSentAt = Date.now();
  miniCanvas ??= document.createElement('canvas');
  const k = v2 ? room : 1;
  const drawn = map.paintMini(miniCanvas, { width: width * k, height: height * k, dpr: window.devicePixelRatio || 1, radiusM: radiusM * k,
    rotate: m.rotate ?? 'north', shape: m.shape ?? 'circle', plain: v2, room: k }) as boolean | { cx: number; cy: number; friends: boolean };
  if (!drawn) return;
  const meta: MiniMeta | undefined = v2 && typeof drawn === 'object'
    ? { v: 2, cx: drawn.cx, cy: drawn.cy, pxPerM: (Math.min(width, height) / 2) / radiusM, w: width * k, h: height * k, friends: drawn.friends }
    : undefined;
  miniBusy = true;
  miniCanvas.toBlob((blob) => {
    if (!blob) { miniBusy = false; return; }
    void blob.arrayBuffer()
      .then((buf) => l.overlayMiniFrame?.({ image: new Uint8Array(buf), type: blob.type, ...(meta ? { meta } : {}) }))
      .catch(() => undefined)
      .finally(() => { miniBusy = false; });
  }, 'image/webp', 0.85);
}

/** Your friends' spots for the mini map and the big map, while the map page is not the one reading them. */
let friendsLoading = false;
async function loadFriendSpots(): Promise<void> {
  const f = (me as { friends?: { locked?: unknown } | null } | null)?.friends;
  if (friendsLoading || !f || f.locked) return;
  friendsLoading = true;
  try {
    const d = await portalGet<{ friends: Array<{ name: string | null; pos?: { x: number; y: number; yaw?: number | null } | null }> }>('/api/friends').catch(() => null);
    if (d) setFriendSpots(d.friends.filter((x) => x.pos).map((x) => ({ name: x.name, x: (x.pos as { x: number }).x, y: (x.pos as { y: number }).y, yaw: x.pos?.yaw ?? null })));
  } finally {
    friendsLoading = false;
  }
}

let started = false;
/** Once per visit (main.tsx): follows /api/me, the overlay's settings and the big map; the timers below. */
export function startOverlay(qc: QueryClient): void {
  if (started) return;
  started = true;
  const l = L();
  // Each answer of /api/me (every second, also behind the game): the overlay's data, the mini map's picture.
  qc.getQueryCache().subscribe((e) => {
    if (e.type !== 'updated' || e.query.queryKey[0] !== ME || e.action.type !== 'success') return;
    me = (e.query.state.data as PlayerMe | null | undefined) ?? null;
    pushOverlayGame(me);
    // The launcher's mini map is drawn from this page's map, whatever page is shown and also in game mode.
    if (me && l?.overlayMiniFrame && (miniMapOn || bigMapOpen)) {
      getMap().map.update(me.dino);
      sendMiniFrame();
    }
  });
  if (!l) return;
  if (l.overlayGet) {
    readOverlayAi(l.overlayGet()?.settings ?? null);
    l.onOverlayChanged?.((saved) => readOverlayAi(saved));
    // Settings changed from the tray or the overlay card: look again now and then.
    setInterval(() => readOverlayAi(l.overlayGet?.()?.settings ?? null), 10_000);
  }
  // Game mode keeps (or not) the mini map; the overlay settings page shows what it keeps.
  gameMode().listen((st) => {
    readOverlayAi(null);
    window.dispatchEvent(new CustomEvent('isle-gamemode', { detail: st }));
  });
  l.onBigMap?.((open) => {
    bigMapOpen = open;
    if (open) { getMap(); void loadAiZones(); void loadHeat(); pushOverlayGame(me); }
  });
  // The live AI every 2 s while the mini map (or the big map) wants it; the map page reads it itself.
  setInterval(() => { if (me && mapIfMade() && !mapShown() && (miniMapAi || miniMapOn || bigMapOpen)) void loadAi(); }, 2000);
  setInterval(() => { if (bigMapOpen && !mapShown()) void loadAiZones(); }, 60_000);
  setInterval(() => { if (me && !mapShown() && (miniMapOn || bigMapOpen)) void loadHeat(); }, 60_000);
  setInterval(() => { if (!mapShown() && (miniMapOn || bigMapOpen)) void loadFriendSpots(); }, 2000);
}

/** Tests only. */
export function resetOverlayForTests(): void {
  started = false; me = null; overlaySettings = null; miniMapOn = false; miniMapAi = false; bigMapOpen = false; miniSize = null;
  miniKey = ''; miniSentAt = 0; miniBusy = false;
}
export const overlayStateForTests = (): { miniMapOn: boolean; miniMapAi: boolean; bigMapOpen: boolean } => ({ miniMapOn, miniMapAi, bigMapOpen });
