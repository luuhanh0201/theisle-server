/**
 * The Gateway map for the panel's live map, from VulnonaMAP
 * (https://vulnona.com/game/map/, by Coco.N).
 *
 * Its author says the point data is "collective intelligence" whose use is up
 * to the user, and asks for a link back (the panel shows one). The base image
 * is a composite of in-game screenshots; its copyright is the game
 * developer's, as that page says.
 *
 * Coordinates: VulnonaMAP works in the game's world units / 1000 (the same
 * divide it applies to a pasted in-game location). Its X runs top → bottom on
 * the image and its Y left → right ("axis_X H"), between the map's #cfg
 * min/max. The game SHOWS a location as "Y, X, Z" (a pawn at world x 148697,
 * y 349211 reads "349,211.187, 148,696.686, …" in game — checked on the live
 * server), so VulnonaMAP's X is the world Y and its Y the world X:
 *   left = (x/1000 - minY) / (maxY - minY) * imageWidth
 *   top  = (y/1000 - minX) / (maxX - minX) * imageHeight
 *
 * The file format (data_1.txt: places and zones, data_2.txt: roads and food):
 *   #cfg <key> <value>           map bounds and axis
 *   dir <name> … dirEnd <name>   folders, nested
 *   <type> <class> <name> [css]  a record header, then one "x,y,…" line per point,
 *                                ended by "#---"
 */

export type Pt = [number, number];

export interface MapBounds { minX: number; maxX: number; minY: number; maxY: number }

export type MapLayer =
  | 'area' | 'water' | 'landmark' | 'cave' | 'mud' | 'air' | 'migration' | 'patrol'
  | 'sanctuary' | 'road' | 'animal' | 'plant' | 'mineral';

export interface MapFeature {
  layer: MapLayer;
  /** label: text at a point; point: a marker; circle: an ellipse; poly: closed rings; path: open lines. */
  kind: 'label' | 'point' | 'circle' | 'poly' | 'path';
  name: string;
  /** Text to draw for a label (the source's HTML reduced to lines). */
  text?: string;
  size?: 'large' | 'small';
  at?: Pt;
  /** Circle radii along X and Y, in map units, and rotation in degrees. */
  r?: Pt;
  rot?: number;
  /** poly/path: one array per ring or sub-path. */
  pts?: Pt[][];
  /** Single points inside a path worth a marker: cave exits, updrafts (with their hours). */
  marks?: Array<{ at: Pt; what: 'exit' | 'updraft'; hours?: string }>;
  /** Food: the source's last check of the spot (YYYY-MM-DD). */
  checked?: string;
  /** Migration: a mass-migration zone. */
  mass?: boolean;
  /** Food: the folder it sits in ("Fruits", "Animal (terrestrial)"…). */
  group?: string;
}

export interface ParsedMap { bounds: MapBounds; features: MapFeature[] }

const FOOD_GROUP_LAYER: Record<string, MapLayer> = {
  'Animal (terrestrial)': 'animal',
  'Animal (aquatic)': 'animal',
  Earthworks: 'mineral',
};

/** "<l>Site C14</l>(Derelict Base)" → "Site C14 (Derelict Base)"; <br> → a new line. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/&amp;/g, '&')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '')
    .join('\n');
}

function num(s: string | undefined): number | null {
  if (s === undefined || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "[05] :mmz" → "MZ 05"; ":Port Swere:B3" → "Port Swere"; plain names stay. */
function cleanName(name: string, layer: MapLayer): string {
  const zone = /^\[(\d+)\]/.exec(name);
  if (zone && (layer === 'migration' || layer === 'patrol' || layer === 'sanctuary')) {
    const prefix = layer === 'migration' ? 'MZ' : layer === 'patrol' ? 'PZ' : 'Sanctuary';
    return `${prefix} ${zone[1]}`;
  }
  return name.split(':').map((s) => s.trim()).filter((s) => s !== '')[0] ?? name;
}

function layerOf(type: string, cls: string, css: string[], dirs: string[]): MapLayer | null {
  if (type === 'food') return null; // decided by folder, below
  if (cls === 'area') return 'area';
  if (cls === 'water') return 'water';
  if (cls === 'land') return 'landmark';
  if (cls === 'cave') return 'cave';
  if (cls === 'sky') return 'air';
  if (cls === 'road') return 'road';
  if (cls === 'extra') {
    if (css.includes('mz')) return 'migration';
    if (css.includes('pz')) return 'patrol';
    if (css.includes('sanc')) return 'sanctuary';
    if (css.includes('mud') || dirs.includes('Mud')) return 'mud';
  }
  return null;
}

interface RawRecord { type: string; cls: string; name: string; css: string[]; dirs: string[]; lines: string[][] }

function toFeature(rec: RawRecord): MapFeature | null {
  const { type, cls, css, dirs, lines } = rec;
  const size = css.includes('large') ? 'large' : css.includes('small') ? 'small' : undefined;
  // Author notes ("[Now can't enter here]", flagged dev) are not places.
  if (css.includes('dev')) return null;

  if (type === 'food') {
    const [first] = lines;
    const x = num(first?.[0]); const y = num(first?.[1]);
    if (x === null || y === null) return null;
    const folder = dirs.map((d) => d.replace(/^-\s*|\s*-$/g, '')).find((d) => d in FOOD_GROUP_LAYER)
      ?? dirs.map((d) => d.replace(/^-\s*|\s*-$/g, '')).filter((d) => d !== 'Foods & Items' && d !== cls).pop()
      ?? 'Other';
    const checked = /^up(\d{4})\/(\d{2})\/(\d{2})/.exec(first?.[2] ?? '');
    return {
      layer: FOOD_GROUP_LAYER[folder] ?? 'plant', kind: 'point', name: cls, group: folder, at: [x, y],
      ...(checked ? { checked: `${checked[1]}-${checked[2]}-${checked[3]}` } : {}),
    };
  }

  const layer = layerOf(type, cls, css, dirs);
  if (layer === null) return null;
  const name = cleanName(rec.name, layer);

  if (type === 'text') {
    const [first] = lines;
    const x = num(first?.[0]); const y = num(first?.[1]);
    if (x === null || y === null) return null;
    const text = plainText(first?.slice(2).join(',').replace(/,[-\d.]+,[-\d.]+,?$/, '').replace(/,$/, '') ?? name);
    return { layer, kind: 'label', name, text: text || name, at: [x, y], ...(size ? { size } : {}) };
  }

  if (type === 'circle') {
    const [first] = lines;
    const v = (first ?? []).map(num);
    const [x, y, rx, ry, rot] = v;
    if (x == null || y == null || rx == null) return null;
    return {
      layer, kind: 'circle', name, at: [x, y], r: [rx, ry ?? rx], rot: rot ?? 0,
      ...(layer === 'migration' && css.includes('mmz') ? { mass: true } : {}),
    };
  }

  if (type === 'line' || type === 'path') {
    const subs: Pt[][] = [];
    const marks: NonNullable<MapFeature['marks']> = [];
    let cur: Pt[] = [];
    for (const l of lines) {
      const x = num(l[0]); const y = num(l[1]);
      if (x === null || y === null) continue;
      const flags = l.slice(2).map((f) => f.trim());
      if (flags[0] === 'M' && cur.length > 0) { subs.push(cur); cur = []; }
      cur.push([x, y]);
      if (flags.includes('exit')) marks.push({ at: [x, y], what: 'exit' });
      if (flags.includes('up')) {
        const hours = flags.find((f) => /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(f));
        marks.push({ at: [x, y], what: 'updraft', ...(hours ? { hours } : {}) });
      }
    }
    if (cur.length > 0) subs.push(cur);
    const drawn = subs.filter((s) => s.length > 1);
    if (drawn.length === 0 && marks.length === 0) return null;
    // A "line" that ends where it starts is a zone outline.
    const closed = type === 'line' && drawn.length === 1 && drawn[0]!.length > 2
      && drawn[0]![0]![0] === drawn[0]![drawn[0]!.length - 1]![0]
      && drawn[0]![0]![1] === drawn[0]![drawn[0]!.length - 1]![1];
    const zone = layer === 'migration' || layer === 'patrol' || layer === 'sanctuary';
    return {
      layer, kind: closed || (zone && type === 'line') ? 'poly' : 'path', name, pts: drawn,
      ...(marks.length ? { marks } : {}),
      ...(layer === 'migration' && css.includes('mmz') ? { mass: true } : {}),
      ...(css.includes('bold') ? { size: 'large' as const } : {}),
    };
  }
  return null;
}

/** Parse one VulnonaMAP data file. Bounds come from its #cfg lines (null if it has none). */
export function parseVulnona(text: string): { bounds: MapBounds | null; features: MapFeature[] } {
  const cfg: Record<string, string> = {};
  const dirs: string[] = [];
  const features: MapFeature[] = [];
  let rec: RawRecord | null = null;
  const flush = (): void => {
    if (rec !== null) {
      const f = toFeature(rec);
      if (f !== null) features.push(f);
    }
    rec = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (line === '') continue;
    if (line.startsWith('#cfg')) {
      const [, key, value] = line.split('\t').filter((s) => s !== '');
      if (key !== undefined && value !== undefined) cfg[key] = value;
      continue;
    }
    if (line.startsWith('#')) { flush(); continue; }
    const cols = line.split('\t');
    const head = cols[0] ?? '';
    if (head === 'dir') { flush(); dirs.push(cols[1] ?? ''); continue; }
    if (head === 'dirEnd') { flush(); dirs.pop(); continue; }
    if (/^(text|circle|line|path|food)$/.test(head)) {
      flush();
      const rest = cols.slice(1).filter((s) => s !== '');
      rec = {
        type: head, cls: rest[0] ?? '', name: rest[1] ?? rest[0] ?? '',
        css: (rest[2] ?? '').split(/\s+/).filter((s) => s !== ''), dirs: [...dirs], lines: [],
      };
      continue;
    }
    if (rec !== null && /^-?[\d.]+,/.test(line)) (rec as RawRecord).lines.push(line.split(','));
    // Anything else ("layer …", unknown record types) is not drawn.
  }
  flush();

  const b = [num(cfg['min_X']), num(cfg['max_X']), num(cfg['min_Y']), num(cfg['max_Y'])];
  const bounds = b.every((v) => v !== null) && cfg['axis_X'] === 'H'
    ? { minX: b[0]!, maxX: b[1]!, minY: b[2]!, maxY: b[3]! } : null;
  return { bounds, features };
}

/** Both data files → one map; the bounds must come from one of them. */
export function parseGateway(...texts: string[]): ParsedMap {
  let bounds: MapBounds | null = null;
  const features: MapFeature[] = [];
  for (const t of texts) {
    const p = parseVulnona(t);
    bounds ??= p.bounds;
    features.push(...p.features);
  }
  if (bounds === null) throw new Error('no #cfg bounds with axis_X H in the map data');
  return { bounds, features };
}

/** The current Evrima Gateway entry of VulnonaMAP's dat.txt (✅ = current). */
export function currentGateway(dat: string): { id: string; name: string; updated: string } | null {
  for (const line of dat.split(/\r?\n/)) {
    const cols = line.split('\t').filter((s) => s !== '');
    if (cols[0] !== 'map' || cols[1] !== 'E' || cols[2] !== 'TI') continue;
    if (!/^Gateway/.test(cols[3] ?? '') || !(cols[5] ?? '').includes('✅')) continue;
    if (!/^[A-Za-z0-9_.]+$/.test(cols[3] ?? '')) continue;
    return { id: cols[3] as string, name: cols[4] ?? '', updated: (cols[6] ?? '').replace(/\./g, '-') };
  }
  return null;
}
