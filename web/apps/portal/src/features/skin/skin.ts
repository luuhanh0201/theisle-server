import { DEFAULT_COLORS, REGIONS, hex, linearOf, type LinearColor } from '@portal/skin-editor';

/** Skin effects a player may set (pawn.SkinEffects), 0-1; they dry / fade in game. */
export const EFFECTS: ReadonlyArray<readonly [string, string]> = [['Wet', 'Ướt'], ['Mud', 'Bùn'], ['Blood', 'Máu'], ['Dirt', 'Bẩn'], ['Dust', 'Bụi'], ['Duckweed', 'Bèo']];
/**
 * Glow ("brighter than white") is made by admins only now (panel → Vật phẩm → Skin: a skin
 * item a player is given, then wears): the bridge takes 0-1 from this editor. Kept at 1.
 */
export const GLOW_MAX = 1;

/** The editor as it stands: colours "#rrggbb" per region, pattern, theme, variation, effects in % (0-100). */
export interface EditorState {
  colors: Record<string, string>;
  pattern: number; theme: number; variation: number; glow: number;
  fxOn: boolean; fx: Record<string, number>;
}

/** The skin the editor sends, previews and codes (app.js editorSkin): effects 0-1, or null when off. */
export interface EditorSkin {
  colors: Record<string, string>;
  pattern: number; theme: number; variation: number; glow: number;
  effects: Record<string, number> | null;
}

/** A skin put into the editor: colours linear (the game's) or "#rrggbb" (a code, a saved skin, a palette). */
export interface SkinIn {
  colors?: Record<string, LinearColor | string | undefined>;
  pattern?: number; patternIndex?: number; theme?: number; themeIndex?: number;
  variation?: number; glow?: number; effects?: Record<string, number> | null;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** What the editor starts with: a real Carnotaurus skin from this server, so the preview looks like a dino at once. */
export function initialState(): EditorState {
  return {
    colors: Object.fromEntries(REGIONS.map(([id]) => [id, hex(DEFAULT_COLORS[id])])),
    pattern: 0, theme: 0, variation: 0, glow: 1,
    fxOn: false, fx: Object.fromEntries(EFFECTS.map(([id]) => [id, 0])),
  };
}

/** The editor's skin now, each value clamped as the site before React read it. */
export function editorSkin(st: EditorState): EditorSkin {
  return {
    colors: { ...st.colors },
    pattern: clamp(Math.round(Number(st.pattern) || 0), 0, 2),
    theme: clamp(Math.round(Number(st.theme) || 0), 0, 20),
    variation: clamp(Math.round(Number(st.variation) || 0), 0, 20),
    glow: clamp(Number(st.glow) || 1, 1, GLOW_MAX),
    effects: st.fxOn ? Object.fromEntries(EFFECTS.map(([id]) => [id, clamp((Number(st.fx[id]) || 0) / 100, 0, 1)])) : null,
  };
}

/** Put a skin into the editor (app.js applySkin): only what the skin carries changes. */
export function applySkin(st: EditorState, skin: SkinIn): EditorState {
  const next: EditorState = { ...st, colors: { ...st.colors }, fx: { ...st.fx } };
  for (const [id] of REGIONS) {
    const c = skin.colors?.[id];
    if (!c) continue;
    next.colors[id] = typeof c === 'string' ? c : hex(c);
  }
  const pattern = skin.pattern ?? skin.patternIndex;
  const theme = skin.theme ?? skin.themeIndex;
  if (typeof pattern === 'number') next.pattern = pattern;
  if (typeof theme === 'number') next.theme = theme;
  if (typeof skin.variation === 'number') next.variation = Math.round(skin.variation);
  if (typeof skin.glow === 'number') next.glow = clamp(Number(skin.glow) || 1, 1, GLOW_MAX);
  if (skin.effects && typeof skin.effects === 'object') {
    next.fxOn = true;
    for (const [id] of EFFECTS) next.fx[id] = Math.round((Number(skin.effects[id]) || 0) * 100);
  }
  return next;
}

/** POST /api/skin's body: linear colours; effects and "keep" only in lab (not released yet). */
export function skinBody(sk: EditorSkin, lab: boolean, keep: boolean): Record<string, unknown> {
  const colors: Record<string, LinearColor> = {};
  if (lab) {
    const k = (v: number): number => Math.min(GLOW_MAX, Math.round(v * sk.glow * 10000) / 10000);
    for (const [id] of REGIONS) { const c = linearOf(sk.colors[id] ?? '#ffffff'); colors[id] = { r: k(c.r), g: k(c.g), b: k(c.b) }; }
  } else {
    for (const [id] of REGIONS) colors[id] = linearOf(sk.colors[id] ?? '#ffffff');
  }
  return {
    pattern: sk.pattern, theme: sk.theme, variation: sk.variation, colors,
    ...(lab ? { ...(sk.effects ? { effects: sk.effects } : {}), keep } : {}),
  };
}

const b64url = (s: string): string => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A skin code: "XG1." + base64url of { p, t, v, c: { Body: "rrggbb", … } }, short enough to paste in chat. */
export function skinCode(sk: EditorSkin): string {
  const c: Record<string, string> = {};
  for (const [id] of REGIONS) c[id] = (sk.colors[id] ?? '').replace('#', '');
  const extra: Record<string, unknown> = {};
  if (sk.glow > 1) extra['g'] = Math.round(sk.glow * 10) / 10;
  if (sk.effects) extra['e'] = Object.fromEntries(Object.entries(sk.effects).map(([id, v]) => [id, Math.round(v * 100)]));
  return `XG1.${b64url(JSON.stringify({ p: sk.pattern, t: sk.theme, v: sk.variation, c, ...extra }))}`;
}

/** A code back to a skin ("#rrggbb" colours), or null when it is not one. */
export function parseSkinCode(text: unknown): SkinIn & { colors: Record<string, string>; pattern: number; theme: number; variation: number; glow: number } | null {
  const m = /^XG1\.([A-Za-z0-9_-]+)$/.exec(String(text ?? '').trim());
  if (!m?.[1]) return null;
  try {
    const d = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))) as { p?: unknown; t?: unknown; v?: unknown; g?: unknown; c?: Record<string, unknown>; e?: Record<string, unknown> };
    const colors: Record<string, string> = {};
    for (const [id] of REGIONS) {
      const v = d.c?.[id];
      if (typeof v === 'string' && /^[0-9a-f]{6}$/i.test(v)) colors[id] = `#${v.toLowerCase()}`;
    }
    if (Object.keys(colors).length === 0) return null;
    const effects = d.e && typeof d.e === 'object'
      ? Object.fromEntries(EFFECTS.map(([id]) => [id, clamp(Number(d.e?.[id]) || 0, 0, 100) / 100])) : null;
    return { colors, pattern: Number(d.p) || 0, theme: Number(d.t) || 0, variation: Number(d.v) || 0, glow: Number(d.g) || 1, ...(effects ? { effects } : {}) };
  } catch {
    return null;
  }
}

/** Saved skins: this browser only (the same key as before React; localStorage may be off: then nothing is kept). */
export const SKINS_KEY = 'xg.skins.v1';
export interface SavedSkin { name: string; code: string }
export function loadSaved(): SavedSkin[] {
  try { const v: unknown = JSON.parse(localStorage.getItem(SKINS_KEY) ?? '[]'); return Array.isArray(v) ? v as SavedSkin[] : []; } catch { return []; }
}
export function storeSaved(list: SavedSkin[]): void {
  try { localStorage.setItem(SKINS_KEY, JSON.stringify(list.slice(0, 30))); } catch { /* private window: not kept */ }
}
/** Save under `name` (a same name is replaced), newest first. */
export function withSaved(list: SavedSkin[], name: string, code: string): SavedSkin[] {
  return [{ name, code }, ...list.filter((it) => it.name !== name)];
}

/** "BP_Tyrannosaurus_C" → "Tyrannosaurus" (the kept colours' chips). */
export const speciesLabel = (raw: string): string => raw.replace(/^BP_/, '').replace(/_C$/, '');
