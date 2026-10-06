// The live map's layers and names (the panel before React, index.html "live map"). Map units =
// game world units / 1000, in the order the game SHOWS a location ("349,211.187, 148,696.686" =
// world Y, X): map X (down the image) is world Y, map Y (to the right) is world X.

/** [id, label, colour, on by default]. */
export const LAYERS: ReadonlyArray<readonly [string, string, string, boolean]> = [
  ['ai', 'AI đang có (live)', '#ef4444', true],
  ['fish', 'Cá (live)', '#22d3ee', true],
  ['aizone', 'Vùng AI (admin đặt)', '#fb923c', true],
  ['trails', 'Vệt di chuyển', '#f8fafc', true],
  ['migration', 'Vùng di cư MZ (tên vùng)', '#22c55e', true],
  ['migrlive', 'Khóm cây & di cư (đang diễn ra)', '#16a34a', true],
  ['sanctuary', 'Sanctuary', '#e879f9', true],
  ['patrol', 'Vùng tuần tra (PZ)', '#f97316', false],
  ['area', 'Khu vực', '#f8fafc', true],
  ['water', 'Nguồn nước', '#38bdf8', true],
  ['landmark', 'Địa danh & căn cứ', '#fbbf24', true],
  ['cave', 'Hang & đường hầm', '#c4b5fd', false],
  ['mud', 'Bãi bùn (wallow)', '#d97706', false],
  ['air', 'Luồng khí (loài bay)', '#7dd3fc', false],
  ['road', 'Đường mòn', '#e7e5e4', false],
  ['flora', 'Thực vật: (α) (β) (γ)', '#84cc16', true],
  ['mineral', 'Đá muối, gastro, nghêu (tham khảo)', '#e2e8f0', false],
];
export const LAYER: Record<string, { label: string; color: string; on: boolean }> = Object.fromEntries(LAYERS.map(([id, label, color, on]) => [id, { label, color, on }]));
/** Version of map/water-areas.json + water-mask.png (scripts/build-water-areas.py). */
export const WATER_V = '2026-10-04c';
export const ZONE_VN: Record<string, string> = { migration: 'Vùng di cư', patrol: 'Vùng tuần tra', sanctuary: 'Sanctuary', mud: 'Bãi bùn' };
export const FOOD_VN: Record<string, string> = {
  Boar: 'Lợn rừng', Chicken: 'Gà', Deer: 'Hươu', Goat: 'Dê', Rabbit: 'Thỏ', Fish: 'Cá', Crab: 'Cua', Frog: 'Ếch',
  Turtle: 'Rùa', Banana: 'Chuối', Coconut: 'Dừa', Jackfruit: 'Mít', Mango: 'Xoài', Melon: 'Dưa', Orange: 'Cam',
  Papaya: 'Đu đủ', Pumpkin: 'Bí ngô', Cashew: 'Hạt điều', Potato: 'Khoai tây', Radish: 'Củ cải',
  SaltRock: 'Đá muối (salt lick)', ClamRock: 'Đá nghêu',
};
/** The game's ambient fish (StatsLogger lists them with f: true), as World → Cá names them. */
const FISH_VN: Record<string, string> = { Catfish: 'Cá trê', Coalecanth: 'Cá vây tay', Forktail: 'Forktail', Hoplo: 'Hoplo', Longear: 'Cá thái dương', Muskel: 'Muskel' };
export const fishName = (c: string): string => { const k = String(c).replace(/^BP_/, '').replace(/_C$/, ''); return FISH_VN[k] ?? k; };
export const foodName = (n: string): string => (FOOD_VN[n] ? `${FOOD_VN[n]} · ${n}` : n);

/** α carbs · β proteins · γ lipids, as the game marks them; nothing written = no nutrients. */
export const NUTRI: ReadonlyArray<readonly [string, string, string]> = [['cp', 'α', '#fbbf24'], ['pp', 'β', '#f472b6'], ['lp', 'γ', '#38bdf8']];
export interface Plant { x: number; y: number; c: string; s?: string; n?: boolean; cp?: number; pp?: number; lp?: number; eaten?: boolean }
export interface Spawner { id: string; x: number; y: number; mass?: boolean; active?: boolean; migration?: boolean; patrol?: boolean; nesting?: boolean; juvenile?: boolean;
  amount?: number | null; multiplier?: number | null; shape?: { spline?: Array<[number, number]> } }
export interface Flora { t: number; stale?: boolean; plants: Plant[]; fruits: Plant[]; spawners: Spawner[] }
/** "(α)", "(βγ)", or "" when it gives no nutrients. */
export function nutriMark(p: Plant): string {
  if (p.n === false) return '';
  const got = NUTRI.filter(([k]) => ((p as unknown as Record<string, number | undefined>)[k] ?? 0) > 0).map(([, sym]) => sym).join('');
  return got ? `(${got})` : '';
}
export function nutriColor(p: Plant): string {
  if (p.n === false) return '#94a3b8';
  const got = NUTRI.filter(([k]) => ((p as unknown as Record<string, number | undefined>)[k] ?? 0) > 0);
  return got.length === 1 ? (got[0] as readonly [string, string, string])[2] : got.length > 1 ? '#a3e635' : '#94a3b8';
}
/** "BP_FruitMangoStatic_C" → "Mango (quả)", "BP_MangoTreeStaticSpawner_C" → "Mango (cây)". */
export function plantName(c: string): string {
  let n = String(c).replace(/^BP_/, '').replace(/_C$/, '');
  const fruit = /^Fruit/.test(n) || (/Static$/.test(n) && !/Spawner$/.test(n));
  const tree = /Spawner$/.test(n);
  n = n.replace(/^Fruit/, '').replace(/(Tree)?(Static)?Spawner$/, '').replace(/Static$/, '').replace(/(\D)(\d+)$/, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
  return `${n}${fruit ? ' (quả)' : tree ? ' (cây)' : ''}`;
}
export function floraZoneState(sp: Spawner): [string, string] {
  if (sp.mass) return ['Đại di cư', '#facc15'];
  if (sp.active) return ['Đang di cư', '#22c55e'];
  if (sp.migration) return ['Vùng di cư (đang nghỉ)', '#94a3b8'];
  return ['Vùng cây thường', '#38bdf8'];
}
export const hexA = (hex: string, a: number): string => hex + Math.round(a * 255).toString(16).padStart(2, '0');

/** The map's features (VulnonaMAP, bridge/src/vulnona.ts) as drawn here. */
export type Pt = [number, number];
export interface Feature {
  layer: string; kind: string; name: string; text?: string; at?: Pt; size?: string; pts?: Pt[][]; r?: [number, number]; rot?: number; mass?: boolean;
  marks?: Array<{ at: Pt; what: string; hours?: string }>; group?: string; checked?: string;
}
/** A player as GET /api/map gives them (with the live file's position, heading, health). */
export interface MapPlayer {
  steamId: string; name: string | null; species: string | null; growth: number | null; loc: { x: number; y: number; z?: number }; yaw?: number | null;
  health?: number | null; maxHealth?: number; trail: Array<{ x: number; y: number; t: number }>; prison?: { escaped: boolean; remainingSec: number } | null;
}
/** The AI alive on the server (StatsLogger): a pawn each, fish marked f. */
export interface AiLive { t: number; stale: boolean; count: number; fish?: number; dead?: number; aiAlive: number | null; list: Array<{ c: string; x: number; y: number; z?: number; hp?: number; f?: boolean }> }
export type AiPawn = AiLive['list'][number];
