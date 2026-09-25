/**
 * Shapes of an AI zone (ai-zones.ts), in game units (cm), X and Y as the game
 * has them:
 *
 *   circle   centre (x, y), radiusM
 *   ellipse  centre, semi-axes radiusM (along angleDeg) and radius2M — a beach,
 *            a river bank
 *   polygon  its corners, `poly` [[x, y], …], 3–40 of them — any outline
 *
 * The mod, the panel and the players' map all need "is this point inside":
 * an ellipse is turned into a polygon (ELLIPSE_SIDES corners) so the three
 * only ever deal with circles and polygons. `boundRadiusCm` is the circle
 * around the whole shape, for a quick first test.
 */

export type ZoneShape = 'circle' | 'ellipse' | 'polygon';
export type Point2 = [number, number];

export interface ShapedZone {
  x: number;
  y: number;
  radiusM: number;
  shape?: ZoneShape;
  radius2M?: number;
  angleDeg?: number;
  poly?: Point2[];
}

export const ELLIPSE_SIDES = 36;

/** The shape as a polygon (game units), or null for a circle. */
export function zoneOutline(z: ShapedZone): Point2[] | null {
  if (z.shape === 'polygon' && z.poly && z.poly.length >= 3) return z.poly.map(([x, y]) => [x, y]);
  if (z.shape === 'ellipse') {
    const a = z.radiusM * 100;
    const b = (z.radius2M ?? z.radiusM) * 100;
    const t = ((z.angleDeg ?? 0) * Math.PI) / 180;
    const out: Point2[] = [];
    for (let i = 0; i < ELLIPSE_SIDES; i++) {
      const u = (i / ELLIPSE_SIDES) * Math.PI * 2;
      const ex = a * Math.cos(u);
      const ey = b * Math.sin(u);
      out.push([Math.round(z.x + ex * Math.cos(t) - ey * Math.sin(t)), Math.round(z.y + ex * Math.sin(t) + ey * Math.cos(t))]);
    }
    return out;
  }
  return null;
}

/** The circle around the whole shape (cm, from its centre). */
export function boundRadiusCm(z: ShapedZone): number {
  const outline = zoneOutline(z);
  if (!outline) return z.radiusM * 100;
  return Math.ceil(Math.max(...outline.map(([x, y]) => Math.hypot(x - z.x, y - z.y))));
}

export function pointInPoly(poly: Point2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as Point2;
    const [xj, yj] = poly[j] as Point2;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function insideZone(z: ShapedZone, x: number, y: number): boolean {
  const outline = zoneOutline(z);
  if (!outline) return Math.hypot(x - z.x, y - z.y) <= z.radiusM * 100;
  return pointInPoly(outline, x, y);
}

/** The corners' centre (their mean): where a polygon zone's label and handle sit. */
export function centreOf(poly: Point2[]): Point2 {
  const n = poly.length;
  return [Math.round(poly.reduce((s, p) => s + p[0], 0) / n), Math.round(poly.reduce((s, p) => s + p[1], 0) / n)];
}

/** Twice the signed area: ~0 means the corners are all on one line. */
export function polyArea(poly: Point2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j] as Point2)[0] * (poly[i] as Point2)[1] - (poly[i] as Point2)[0] * (poly[j] as Point2)[1];
  }
  return Math.abs(a) / 2;
}
