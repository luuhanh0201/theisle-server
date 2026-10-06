import { useSyncExternalStore } from 'react';
import { toGame, unitsOf, type MapData } from '../../lib/map';
import { LAYER, LAYERS, type AiLive, type AiPawn, type Feature, type Flora, type MapPlayer, type Pt } from './data';
import { centreOf, setZoneShape, ZONE_DEFAULT, zoneHas, type AiZone } from './zones';

/**
 * The live map's state, shared by the canvas (draw.ts, MapView) and the side panels, as the panel
 * before React kept it (lm: the map, az: the AI zones being edited, gd: the small-dinos rule).
 * Mutated in place like there; `changed()` redraws the canvas and the panels that read it.
 */
export const lm = {
  data: null as (Omit<MapData, 'features'> & { features: Feature[] }) | null, img: null as HTMLImageElement | null, failed: null as string | null,
  water: [] as Array<{ kind: string; at: Pt; r: number }>, waterTint: null as HTMLCanvasElement | null,
  players: [] as MapPlayer[], ai: null as AiLive | null,
  // steamId -> the dot glides to each new position (live file, 1 s) instead of jumping.
  pos: new Map<string, { from: Pt; to: Pt; t0: number }>(),
  view: null as { s: number; ox: number; oy: number } | null, fit: 1, size: '', touched: false,
  on: new Set(LAYERS.filter((l) => l[3]).map((l) => l[0])),
  hover: null as Hit | null, flash: null as { feature?: Feature; food?: string; until: number } | null,
  pointers: new Map<number, Pt>(), drag: null as { x: number; y: number; ox: number; oy: number; moved: boolean } | null, pinch: null as { d: number; s: number } | null,
  // steamId -> trail points up to this time (unix s, the bridge's clock) are hidden: "xóa vệt".
  cleared: {} as Record<string, number>,
  path: null as LifePath | null,
  pendingFit: null as Pt[] | null, pin: null as { at: Pt } | null,
  flora: null as Flora | null, floraZones: [] as Array<{ sp: Flora['spawners'][number]; ring: Pt[] }>,
  canvas: null as HTMLCanvasElement | null,
};
/** GET /api/player/<id>/path/<spawnedAt>: a whole life's path. */
export interface LifePath { steamId: string; species: string; spawnedAt: number; end: string | null; points: Array<{ x: number; y: number; t: number }> }
export type Hit = { player?: MapPlayer; ai?: AiPawn; azone?: AiZone; plant?: Flora['plants'][number]; fzone?: Flora['spawners'][number]; f?: Feature; mark?: NonNullable<Feature['marks']>[number] };

export interface AiZonesView {
  enabled: boolean; globalMax: number; zones: AiZone[]; ignoreOccupants?: string[]; playables?: string[]; groundPoints: number;
  species: Array<{ key: string; label: string; kind: string; cls: string }>; points?: Record<string, number>;
  status: { t: number; stale: boolean; total: number | null; cap: number | null; zones?: Record<string, { count?: number; limit?: number; occupied?: boolean; nextTurn?: number; lastError?: string }> } | null;
}
export interface ZonesDraft { enabled: boolean; globalMax: number; zones: AiZone[]; ignoreOccupants: string[] }
export const az = {
  data: null as AiZonesView | null, draft: null as ZonesDraft | null, status: null as AiZonesView['status'], points: {} as Record<string, number>,
  speciesLabel: {} as Record<string, string>, speciesCls: {} as Record<string, string>,
  sel: null as string | null, placing: null as string | null, dirty: false,
  drag: null as { mode: 'move' | 'handle'; key?: string; zn: AiZone; off?: Pt; moved: boolean } | null,
  drawing: null as { id: string; pts: Pt[]; hover: Pt | null } | null,
};
export interface GuardView { enabled: boolean; graceSec: number; everySec: number; pct: number; defaultMax: number; maxBySpecies: Record<string, number>; sanctuaries: string[]; species: string[]; knownSanctuaries: string[] }
export type GuardDraft = Pick<GuardView, 'enabled' | 'graceSec' | 'everySec' | 'pct' | 'defaultMax' | 'maxBySpecies' | 'sanctuaries'>;
export const gd = { data: null as GuardView | null, draft: null as GuardDraft | null, dirty: false };

// --- redraw and re-render ------------------------------------------------------------
let version = 0;
const listeners = new Set<() => void>();
let drawer: (() => void) | null = null;
let raf = 0;
/** The canvas draws with this (MapView sets it). */
export function setDrawer(fn: (() => void) | null): void { drawer = fn; }
export function requestDraw(): void {
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawer?.(); });
}
/** Something the panels show changed: redraw the map and them. */
export function changed(): void {
  version++;
  for (const l of listeners) l();
  requestDraw();
}
/** Re-render on every change of the map's state. */
export function useMapState(): number {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => version);
}

// --- remembered per browser: the layers, the trails hidden ----------------------------------
try {
  const saved = JSON.parse(localStorage.getItem('mapTrailCleared') ?? 'null') as unknown;
  if (saved && typeof saved === 'object') lm.cleared = saved as Record<string, number>;
} catch { /* nothing saved */ }
// What each browser switched on is remembered, with the layers it knew then: a layer added since
// shows as its default instead of silently off.
try {
  const v4 = JSON.parse(localStorage.getItem('mapLayers.v4') ?? 'null') as { on?: string[]; known?: string[] } | null;
  const v3 = v4 ? null : (JSON.parse(localStorage.getItem('mapLayers.v3') ?? 'null') as string[] | null);
  const saved = v4?.on ?? v3;
  // v3 was written before the live plant layers existed.
  const known = new Set(v4?.known ?? (v3 ? LAYERS.map((l) => l[0]).filter((id) => id !== 'migrlive' && id !== 'flora') : []));
  if (Array.isArray(saved)) {
    lm.on = new Set(saved.filter((id) => LAYER[id]));
    for (const [id, , , def] of LAYERS) if (!known.has(id) && def) lm.on.add(id);
  }
} catch { /* nothing saved, or storage blocked: defaults */ }
export function saveLayers(): void {
  try { localStorage.setItem('mapLayers.v4', JSON.stringify({ on: [...lm.on], known: LAYERS.map((l) => l[0]) })); } catch { /* not remembered */ }
}
export function setLayer(id: string, on: boolean): void {
  if (on) lm.on.add(id); else lm.on.delete(id);
  saveLayers();
  changed();
}
export function turnOn(layer: string): void {
  if (lm.on.has(layer)) return;
  lm.on.add(layer);
  saveLayers();
  changed();
}
export const visibleTrail = (p: MapPlayer): MapPlayer['trail'] => p.trail.filter((pt) => pt.t > (lm.cleared[p.steamId] ?? 0));
/** Hide what the trail has so far; new movement keeps drawing. */
export function clearTrail(p: MapPlayer): void {
  const last = p.trail[p.trail.length - 1];
  if (last) lm.cleared[p.steamId] = last.t;
  try { localStorage.setItem('mapTrailCleared', JSON.stringify(lm.cleared)); } catch { /* not remembered */ }
  changed();
}

// --- projection: map units <-> image px <-> screen px -------------------------------
export function toImgPt([x, y]: Pt): Pt {
  const b = (lm.data as MapData).bounds, img = lm.img as HTMLImageElement;
  return [((y - b.minY) / (b.maxY - b.minY)) * img.naturalWidth, ((x - b.minX) / (b.maxX - b.minX)) * img.naturalHeight];
}
export function scr(p: Pt): Pt {
  const [ix, iy] = toImgPt(p);
  const v = lm.view as { s: number; ox: number; oy: number };
  return [v.ox + ix * v.s, v.oy + iy * v.s];
}
export function fromScr(sx: number, sy: number): Pt {
  const b = (lm.data as MapData).bounds, img = lm.img as HTMLImageElement, v = lm.view as { s: number; ox: number; oy: number };
  const ix = (sx - v.ox) / v.s, iy = (sy - v.oy) / v.s;
  return [(iy / img.naturalHeight) * (b.maxX - b.minX) + b.minX, (ix / img.naturalWidth) * (b.maxY - b.minY) + b.minY];
}
/** Radius in map units along X / Y → screen px. */
export const rX = (r: number): number => (r / ((lm.data as MapData).bounds.maxX - (lm.data as MapData).bounds.minX)) * (lm.img as HTMLImageElement).naturalHeight * (lm.view?.s ?? 1);
export const rY = (r: number): number => (r / ((lm.data as MapData).bounds.maxY - (lm.data as MapData).bounds.minY)) * (lm.img as HTMLImageElement).naturalWidth * (lm.view?.s ?? 1);
export function centerOf(f: Pick<Feature, 'at' | 'pts'>): Pt {
  if (f.at) return f.at;
  const all = (f.pts ?? []).flat();
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

const TWEEN_MS = 900;
/** Where a player's dot is drawn now (between its last two known positions). */
export function shownPos(p: MapPlayer): Pt {
  const e = lm.pos.get(p.steamId);
  if (!e) return unitsOf(p.loc);
  const k = Math.min(1, (performance.now() - e.t0) / TWEEN_MS);
  return [e.from[0] + (e.to[0] - e.from[0]) * k, e.from[1] + (e.to[1] - e.from[1]) * k];
}
export function moveTo(p: MapPlayer): void {
  const to = unitsOf(p.loc);
  const e = lm.pos.get(p.steamId);
  if (e && e.to[0] === to[0] && e.to[1] === to[1]) return;
  // A jump (teleport, respawn) is not glided across the map.
  const from = e ? shownPos(p) : to;
  const far = Math.hypot(to[0] - from[0], to[1] - from[1]) > 60;   // 60 map units = 600 m
  lm.pos.set(p.steamId, { from: far ? to : from, to, t0: performance.now() });
}
export const tweening = (): boolean => [...lm.pos.values()].some((e) => performance.now() - e.t0 < TWEEN_MS);

// --- the view: fit, zoom, fly ------------------------------------------------------------
export function fitView(cw: number, ch: number): void {
  const img = lm.img as HTMLImageElement;
  lm.fit = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
  lm.view = { s: lm.fit, ox: (cw - img.naturalWidth * lm.fit) / 2, oy: (ch - img.naturalHeight * lm.fit) / 2 };
}
export function zoomAt(sx: number, sy: number, k: number): void {
  const v = lm.view;
  if (!v) return;
  const s = Math.min(lm.fit * 24, Math.max(lm.fit * 0.8, v.s * k));
  v.ox = sx - (sx - v.ox) * (s / v.s);
  v.oy = sy - (sy - v.oy) * (s / v.s);
  v.s = s;
  lm.touched = true;
  requestDraw();
}
export function flyTo(pt: Pt, zoom = 4): void {
  if (!lm.view || !lm.canvas) return;
  lm.view.s = Math.max(lm.view.s, lm.fit * zoom);
  const [ix, iy] = toImgPt(pt);
  lm.view.ox = lm.canvas.clientWidth / 2 - ix * lm.view.s;
  lm.view.oy = lm.canvas.clientHeight / 2 - iy * lm.view.s;
  lm.touched = true;
  requestDraw();
}
export function fitToPoints(pts: Pt[]): void {
  const canvas = lm.canvas;
  // Not drawn yet (canvas unsized): the first draw sizes it, then fits.
  if (!canvas?.clientWidth || !lm.img || !lm.view || lm.size === '') { lm.pendingFit = pts; requestDraw(); return; }
  const img = pts.map(toImgPt);
  const xs = img.map((p) => p[0]), ys = img.map((p) => p[1]);
  const w = Math.max(40, Math.max(...xs) - Math.min(...xs)), h = Math.max(40, Math.max(...ys) - Math.min(...ys));
  const s = Math.min(lm.fit * 12, Math.max(lm.fit, Math.min(canvas.clientWidth / (w * 1.3), canvas.clientHeight / (h * 1.3))));
  lm.view.s = s;
  lm.view.ox = canvas.clientWidth / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * s;
  lm.view.oy = canvas.clientHeight / 2 - ((Math.min(...ys) + Math.max(...ys)) / 2) * s;
  lm.touched = true;
  requestDraw();
}

// --- the AI zones being edited ------------------------------------------------------------
/** The AI zone an AI counts for, as the mod counts: a species of the zone, inside it. */
export function aiZoneOf(a: { c: string; x: number; y: number }): AiZone | null {
  const d = az.draft;
  if (!d || !d.enabled) return null;
  const cls = String(a.c ?? '').split('.').pop();
  for (const zn of d.zones) {
    if (!zn.enabled || !zn.species.some((k) => az.speciesCls[k] === cls)) continue;
    if (zoneHas(zn, a.x, a.y)) return zn;
  }
  return null;
}
/** A sanctuary of the map guarded now (shown on the map, as saved or being edited). */
export const guardedSanctuary = (name: string): boolean => gd.draft?.enabled === true && gd.draft.sanctuaries.includes(name);
export const selectedZone = (): AiZone | undefined => az.draft?.zones.find((z) => z.id === az.sel);
export function markAz(): void { az.dirty = true; changed(); }
export function selectAiZone(id: string | null): void { az.sel = id; az.placing = null; changed(); }
export function placeAiZone(x: number, y: number): void {
  if (!az.draft) return;
  if (az.placing === 'new') {
    const id = Math.random().toString(36).slice(2, 10);
    az.draft.zones.push({ id, name: `Vùng ${az.draft.zones.length + 1}`, x, y, ...structuredClone(ZONE_DEFAULT) });
    az.sel = id;
  } else {
    const zn = az.draft.zones.find((z) => z.id === az.placing);
    if (zn) { zn.x = x; zn.y = y; }
    if (az.placing) delete az.points[az.placing];
  }
  az.placing = null;
  markAz();
}
export function shapeZone(zn: AiZone, shape: AiZone['shape']): void {
  az.drawing = null;
  setZoneShape(zn, shape);
  delete az.points[zn.id];
  markAz();
}
// Drawing a polygon: click corners on the map; click the first one (or Enter) to close.
export function startPolyDraw(zn: AiZone): void { az.drawing = { id: zn.id, pts: [], hover: null }; az.placing = null; changed(); }
export function cancelDraw(): void { az.drawing = null; az.placing = null; changed(); }
export function finishPolyDraw(): void {
  const d = az.drawing;
  if (!d || !az.draft) return;
  const zn = az.draft.zones.find((z) => z.id === d.id);
  az.drawing = null;
  if (zn && d.pts.length >= 3) {
    zn.shape = 'polygon';
    zn.poly = d.pts;
    [zn.x, zn.y] = centreOf(zn.poly);
    delete zn.radius2M; delete zn.angleDeg;
    delete az.points[zn.id];
    markAz();
  } else changed();
}
export function addPolyCorner(sx: number, sy: number): void {
  const d = az.drawing;
  if (!d) return;
  if (d.pts.length >= 3) {
    const [fx, fy] = scr(toMap(d.pts[0] as Pt));
    if (Math.hypot(sx - fx, sy - fy) <= 12) { finishPolyDraw(); return; }
  }
  if (d.pts.length >= 40) return;
  d.pts.push(toGame(fromScr(sx, sy)));
  changed();
}
const toMap = ([x, y]: Pt): Pt => unitsOf({ x, y });
