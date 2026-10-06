import { getJson } from '@isle/api';

/**
 * The island map shared by every page that draws it (Bản đồ, a death's scene): the reference map
 * (bridge/public/map/gateway.json + its image, from cli-fetch-map.js) and its projection, as the
 * panel before React did it. Map units = [game Y, game X] / 1000; the image spans `bounds`.
 */
export interface MapFeature { layer: string; kind: string; name?: string; text?: string; at?: [number, number]; size?: string; [k: string]: unknown }
export interface MapData {
  map: string; name: string; updated: string; image: string;
  source: { name: string; author: string; url: string; note?: string };
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  features: MapFeature[];
}
export interface LoadedMap { data: MapData; img: HTMLImageElement }

/** The layer of the reference map's AI spots: the server's own AI is drawn instead. */
export const STATIC_AI_LAYER = 'animal';

let loading: Promise<LoadedMap> | null = null;
/** The map, loaded once per page (the image decoded); fails when the bridge has none yet. */
export function loadMap(): Promise<LoadedMap> {
  loading ??= (async () => {
    const data = await getJson<MapData>('/map/gateway.json');
    // Plants come from the server itself (Flora mod), not from the reference map.
    data.features = data.features.filter((f) => f.layer !== STATIC_AI_LAYER && f.layer !== 'plant');
    const img = new Image();
    img.src = `/map/${encodeURIComponent(data.image)}?v=${encodeURIComponent(data.updated)}`;
    await img.decode();
    return { data, img };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

/** A game location (cm) in map units. */
export const unitsOf = (loc: { x: number; y: number }): [number, number] => [loc.y / 1000, loc.x / 1000];

/** Map units → image px. */
export function toImg(m: LoadedMap, [x, y]: [number, number]): [number, number] {
  const b = m.data.bounds;
  return [(y - b.minY) / (b.maxY - b.minY) * m.img.naturalWidth, (x - b.minX) / (b.maxX - b.minX) * m.img.naturalHeight];
}

/** Image px per metre on the ground (the image is near enough square per unit). */
export function pxPerMetre(m: LoadedMap): number {
  const b = m.data.bounds;
  return (1 / 10) / (b.maxY - b.minY) * m.img.naturalWidth;
}

/** A label on the map: outlined so it reads on any ground; "\n" breaks lines. */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, { font, color, align = 'center' }: { font: string; color: string; align?: CanvasTextAlign }): void {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const lines = String(text).split('\n');
  const lh = parseInt(/(\d+)px/.exec(font)?.[1] ?? '12', 10) * 1.15;
  lines.forEach((line, i) => {
    const ly = y + (i - (lines.length - 1) / 2) * lh;
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(2,6,23,.78)'; ctx.strokeText(line, x, ly);
    ctx.fillStyle = color; ctx.fillText(line, x, ly);
  });
}
