import { unitsOf } from '../../lib/map';
import type { Pt } from './data';

/** An AI zone as /api/ai-zones keeps it (bridge/src/ai-zones.ts): game units (cm), X/Y as the game has them. */
export interface AiZone {
  id: string; name: string; enabled: boolean; x: number; y: number; radiusM: number; shape: 'circle' | 'ellipse' | 'polygon';
  radius2M?: number; angleDeg?: number; poly?: Pt[]; species: string[]; min: number; max: number; perTurnMin: number; perTurnMax: number;
  everySec: number; spacingM: number; growthMin: number; growthMax: number; smallOnly?: boolean; water?: boolean; prison?: boolean;
}
export const ZONE_DEFAULT: Omit<AiZone, 'id' | 'name' | 'x' | 'y'> = {
  shape: 'circle', radiusM: 300, species: ['Boar', 'Deer'], min: 3, max: 10, perTurnMin: 1, perTurnMax: 3, everySec: 60, spacingM: 40, growthMin: 0.75, growthMax: 1, enabled: true,
};

// A circle stays a circle; an ellipse and a polygon are drawn and tested as an outline (as zone-shape.ts).
const ELLIPSE_SIDES = 36;
export const toMap = ([x, y]: Pt): Pt => unitsOf({ x, y });
export function zoneOutline(zn: AiZone): Pt[] | null {
  if (zn.shape === 'polygon' && (zn.poly?.length ?? 0) >= 3) return zn.poly as Pt[];
  if (zn.shape === 'ellipse') {
    const a = zn.radiusM * 100, b = (zn.radius2M ?? zn.radiusM) * 100, t = ((zn.angleDeg ?? 0) * Math.PI) / 180;
    return Array.from({ length: ELLIPSE_SIDES }, (_, i): Pt => {
      const u = (i / ELLIPSE_SIDES) * Math.PI * 2, ex = a * Math.cos(u), ey = b * Math.sin(u);
      return [zn.x + ex * Math.cos(t) - ey * Math.sin(t), zn.y + ex * Math.sin(t) + ey * Math.cos(t)];
    });
  }
  return null;
}
export function inPolyGame(poly: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as Pt, [xj, yj] = poly[j] as Pt;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Is the game point (x, y) inside the zone, as the mod decides. */
export function zoneHas(zn: AiZone, x: number, y: number): boolean {
  const o = zoneOutline(zn);
  return o ? inPolyGame(o, x, y) : Math.hypot(x - zn.x, y - zn.y) <= zn.radiusM * 100;
}
export const centreOf = (poly: Pt[]): Pt => [Math.round(poly.reduce((s, p) => s + p[0], 0) / poly.length), Math.round(poly.reduce((s, p) => s + p[1], 0) / poly.length)];
export const reachM = (zn: AiZone): number => { const o = zoneOutline(zn); return o ? Math.ceil(Math.max(...o.map(([x, y]) => Math.hypot(x - zn.x, y - zn.y))) / 100) : zn.radiusM; };
/** The zone as a map feature to draw / hit. */
export function aiZoneShape(zn: AiZone): { kind: 'poly' | 'circle'; at: Pt; pts?: Pt[][]; r?: [number, number] } {
  const o = zoneOutline(zn);
  return o ? { kind: 'poly', at: unitsOf({ x: zn.x, y: zn.y }), pts: [o.map(toMap)] }
    : { kind: 'circle', at: unitsOf({ x: zn.x, y: zn.y }), r: [zn.radiusM / 10, zn.radiusM / 10] };
}
/** "bán kính 300 m" / "bầu dục 400 × 100 m" / "đa giác 6 điểm" */
export function zoneSize(zn: AiZone): string {
  if (zn.shape === 'ellipse') return `bầu dục ${zn.radiusM} × ${zn.radius2M} m`;
  if (zn.shape === 'polygon') return `đa giác ${zn.poly?.length ?? 0} điểm · rộng ~${reachM(zn) * 2} m`;
  return `bán kính ${zn.radiusM} m`;
}
/** The selected zone's handles, in game units. */
export function zoneHandles(zn: AiZone): Array<{ key: string; at: Pt }> {
  if (zn.shape === 'polygon' && zn.poly) return zn.poly.map((p, i) => ({ key: `v${i}`, at: p }));
  if (zn.shape === 'ellipse') {
    const t = ((zn.angleDeg ?? 0) * Math.PI) / 180, a = zn.radiusM * 100, b = (zn.radius2M ?? zn.radiusM) * 100;
    return [{ key: 'a', at: [zn.x + a * Math.cos(t), zn.y + a * Math.sin(t)] }, { key: 'b', at: [zn.x - b * Math.sin(t), zn.y + b * Math.cos(t)] }];
  }
  return [{ key: 'r', at: [zn.x, zn.y + zn.radiusM * 100] }];
}
/** A drag on a handle: the new size / corner, from the pointer's game point. */
export function dragHandle(zn: AiZone, key: string, gx: number, gy: number): void {
  const dx = gx - zn.x, dy = gy - zn.y;
  const m = (v: number): number => Math.min(5000, Math.max(50, Math.round(v / 100 / 10) * 10));
  if (key === 'r') zn.radiusM = m(Math.hypot(dx, dy));
  else if (key === 'a') { zn.radiusM = m(Math.hypot(dx, dy)); zn.angleDeg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI); }
  else if (key === 'b') { const t = ((zn.angleDeg ?? 0) * Math.PI) / 180; zn.radius2M = m(Math.abs(-Math.sin(t) * dx + Math.cos(t) * dy)); }
  else if (key.startsWith('v') && zn.poly) zn.poly[Number(key.slice(1))] = [Math.round(gx), Math.round(gy)];
}
/** Switch a zone's shape, keeping it about the same place and size. */
export function setZoneShape(zn: AiZone, shape: AiZone['shape']): void {
  if (zn.shape === shape) return;
  const reach = Math.max(50, Math.round(reachM(zn) / 10) * 10);
  if (shape === 'polygon') {
    // Start from the current outline, 8 corners, to be dragged into place (or drawn anew).
    const o = zoneOutline(zn) ?? Array.from({ length: 8 }, (_, i): Pt => [zn.x + zn.radiusM * 100 * Math.cos((i * Math.PI) / 4), zn.y + zn.radiusM * 100 * Math.sin((i * Math.PI) / 4)]);
    const step = Math.max(1, Math.floor(o.length / 8));
    zn.poly = o.filter((_, i) => i % step === 0).slice(0, 12).map(([x, y]): Pt => [Math.round(x), Math.round(y)]);
    delete zn.radius2M; delete zn.angleDeg;
  } else if (shape === 'ellipse') {
    zn.radiusM = reach; zn.radius2M = Math.max(50, Math.round(reach / 2 / 10) * 10); zn.angleDeg = 0;
    delete zn.poly;
  } else {
    zn.radiusM = reach;
    delete zn.poly; delete zn.radius2M; delete zn.angleDeg;
  }
  zn.shape = shape;
}
