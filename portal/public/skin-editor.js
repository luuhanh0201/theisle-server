// The skin colour editor, shared: the players' Skin Studio (app.js) and the
// admin panel's Vật phẩm → Skin (bridge public/index.html, served from here).
// One region list, a colour picker and a hex code per region, and the themed
// palettes; the panel adds a light per region (darker / brighter than a player
// can pick), the only difference (owner's call, 2026-10-02: the panel's own
// editor drifted from the players' colours).
//
// Colours in the editor are "#rrggbb" (sRGB, what the pickers show); the game
// holds linear values (linearOf / hex convert).

/** The 10 skin regions (pawn.CustomizerData <Region>Color), in the order players know them. */
export const REGIONS = [
  ['Body', 'Thân'],
  ['Flank', 'Hông'],
  ['Underbelly', 'Bụng'],
  ['Markings', 'Hoa văn'],
  ['MaleDisplay', 'Màu phô trương (đực)'],
  ['Detail1', 'Chi tiết'],
  ['Eyes', 'Mắt'],
  ['Teeth', 'Răng'],
  ['Mouth', 'Miệng'],
  ['Claws', 'Móng'],
];

// 20 themed palettes: the 10 regions in REGIONS order, sRGB hex.
export const PRESETS = [
  ['Rừng rậm', '#3f5a36 #2c4027 #8a8f62 #1c2616 #c9a227 #26301f #d9a21b #e8dcc0 #9c5a55 #2a2a24'],
  ['Sa mạc', '#c49a6c #a67c52 #e6cfa8 #7a5230 #d2691e #5c4033 #e0b03a #efe6cf #b56b62 #3b3128'],
  ['Hắc ám', '#1d1f22 #121315 #3a3d42 #050505 #8b0000 #2b2b2b #ff3b30 #d8d2c4 #5a2323 #111111'],
  ['Bạch tạng', '#ece8e1 #d9d2c7 #f7f4ef #c7bfb3 #f2a0a8 #b8aea0 #e5484d #fbf7ee #e08a8f #cfc6b8'],
  ['Dung nham', '#2a1d1a #3d2620 #6b3a2a #120c0b #ff4500 #ff8c00 #ffb000 #e6d8c3 #7a2b1f #1a1414'],
  ['Đầm lầy', '#4a5a3a #3a4a2e #7d7a52 #262e1d #9acd32 #2f3a24 #c8b400 #ddd4b8 #8a5a4a #2d2b22'],
  ['Băng giá', '#b8d4e3 #8fb3c9 #e8f1f5 #4f7891 #3fa9f5 #6a8fa6 #7fdbff #f4f8fa #9bb7c9 #3c4f5c'],
  ['Hoàng hôn', '#d9774a #b3533a #f2c38b #6e2c2a #ff2d55 #8c3b2e #ffcc33 #f1e3cc #c8615a #3a2420'],
  ['Đại dương', '#2d5f7a #1f4459 #a9c7cf #0f2633 #00c2d1 #173848 #4de1ff #e6eef0 #7a9aa3 #14242c'],
  ['Hổ vằn', '#d9822b #b8641a #f2e1c4 #1a1310 #ff6a00 #2b1d14 #ffcf3a #f0e6d2 #b8584f #231a15'],
  ['Báo đốm', '#d8b26a #bf9550 #f3e6c4 #3a2a18 #e3a33c #5a4128 #c9d23a #f1e8d4 #b76a5f #2e241a'],
  ['Ngựa vằn', '#efefef #d6d6d6 #fafafa #111111 #2f6fff #333333 #3a86ff #f5f2ea #c47d80 #1a1a1a'],
  ['Rừng thu', '#8a4b24 #6d3a1c #d6a86b #3f2412 #e25822 #5a3a20 #f2a23c #eadcc2 #a4533f #2e1f14'],
  ['Hoàng gia', '#3b2a6b #2a1e4f #a693c9 #150f2b #d4af37 #5b4a8a #e3c565 #f0e9d8 #8c5a8c #1d1830'],
  ['Ngọc bích', '#2f7d5b #215c43 #a8d5bd #0f3325 #19e68c #1d4a37 #7dffb3 #e9f3ec #7aa693 #14261e'],
  ['Bờ biển', '#d8cdb6 #bdb095 #f1ebdf #8a7d63 #43b0f1 #6f6550 #5fb4ff #f7f3ea #c99a8f #4a4234'],
  ['Huyết long', '#6e1414 #4d0e0e #b85c5c #1f0505 #ff1a1a #3a0a0a #ffdd00 #e8d7c9 #9e2b2b #140606'],
  ['Thép xám', '#5d6570 #454c55 #9aa3ad #262a30 #5ac8fa #3a4048 #a0e9ff #e3e6ea #8a8f99 #1e2126'],
  ['Độc tố', '#2b2b2b #1c1c1c #7fff00 #0a0a0a #bfff00 #39ff14 #adff2f #e0e8d0 #4f7f2f #121212'],
  ['Hoàng thổ', '#7a6248 #5f4c37 #b8a489 #3b2f22 #b5651d #4a3c2d #d19a2a #e8dcc6 #a0685c #2c241b'],
].map(([name, list]) => {
  const hexes = list.split(' ');
  return { name, colors: Object.fromEntries(REGIONS.map(([id], i) => [id, hexes[i]])) };
});

// What an editor starts with: a real Carnotaurus skin from this server (the game's linear colours).
export const DEFAULT_COLORS = {
  Body: { r: 0.347, g: 0.22, b: 0.156 }, Flank: { r: 0.195, g: 0.109, b: 0.091 },
  Underbelly: { r: 0.397, g: 0.314, b: 0.266 }, Markings: { r: 0.056, g: 0.045, b: 0.037 },
  Detail1: { r: 0.02, g: 0.017, b: 0.015 }, Eyes: { r: 0.25, g: 0.12, b: 0.02 },
  MaleDisplay: { r: 0.342, g: 0.1, b: 0.06 }, Teeth: { r: 0.62, g: 0.55, b: 0.42 },
  Mouth: { r: 0.4, g: 0.223, b: 0.179 }, Claws: { r: 0.05, g: 0.041, b: 0.033 },
};

/** The game's linear colour → "#rrggbb" (sRGB; above 1 shown as 1). */
export function hex(c) {
  if (!c) return '#ffffff';
  const ch = (v) => {
    const x = Math.min(1, Math.max(0, Number(v) || 0));
    const s = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(s * 255).toString(16).padStart(2, '0');
  };
  return `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`;
}

/** "#rrggbb" (sRGB, what the pickers show) → the game's linear colour. */
export function linearOf(hexText) {
  const n = parseInt(String(hexText).replace('#', ''), 16);
  const ch = (v) => { const x = v / 255; return Math.round((x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4) * 10000) / 10000; };
  return { r: ch((n >> 16) & 255), g: ch((n >> 8) & 255), b: ch(n & 255) };
}

// --- the light per region (the panel only) --------------------------------------
export const LIGHT_MIN = 0.05;
export const LIGHT_MAX = 4;
// Logarithmic: the same drag doubles or halves; 0 = × 1.
const toSlider = (f) => Math.log(f);
const fromSlider = (v) => Math.round(Math.exp(Number(v)) * 100) / 100;
export const lightText = (f) => (Math.abs(f - 1) < 0.005 ? ['thường', ''] : f < 1 ? [`tối ×${f.toFixed(2)}`, 'dark'] : [`sáng ×${f.toFixed(2)}`, 'bright']);
/** A slider value → its factor; the ends are the exact limits (its 0.01 steps stop just short). */
function sliderFactor(el) {
  const v = Number(el.value);
  if (v >= Number(el.max) - 0.011) return LIGHT_MAX;
  if (v <= Number(el.min) + 0.011) return LIGHT_MIN;
  return Math.min(LIGHT_MAX, Math.max(LIGHT_MIN, fromSlider(v)));
}

// --- the look (the Skin Studio's own), injected once ------------------------------
const STYLE = `
.se-regions { display: flex; flex-direction: column; gap: 2px; padding: 6px; background: var(--bg-surface, var(--surface-2, #0e1526));
  border: 1px solid var(--border, rgba(255,255,255,.08)); border-radius: 12px; }
.se-region { display: flex; flex-direction: column; gap: 4px; padding: 5px 8px; border-radius: 8px; }
.se-region:hover { background: rgba(255,255,255,.04); }
.se-region.off { opacity: .45; }
.se-region .se-row { display: flex; align-items: center; gap: 10px; cursor: pointer; margin: 0; }
.se-pick { -webkit-appearance: none; -moz-appearance: none; appearance: none; width: 26px; height: 26px; flex-shrink: 0; padding: 0;
  border: 2px solid rgba(255,255,255,.15); border-radius: 7px; cursor: pointer; background: none; overflow: hidden; }
.se-pick::-webkit-color-swatch-wrapper { padding: 0; }
.se-pick::-webkit-color-swatch { border: none; border-radius: 5px; }
.se-pick::-moz-color-swatch { border: none; border-radius: 5px; }
.se-name { flex: 1; font-size: 13px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text, #f1f5f9); }
.se-hex { width: 84px !important; flex-shrink: 0; background: rgba(2,6,23,.5) !important; border: 1px solid var(--border, rgba(255,255,255,.08)) !important;
  border-radius: 6px !important; color: var(--text-muted, var(--muted, #8b9bb4)) !important; padding: 4px 7px !important; font: 12px ui-monospace, monospace !important; box-shadow: none !important; }
.se-hex:focus { outline: none; border-color: rgba(52,211,153,.55) !important; color: inherit !important; }
.se-hex.bad { border-color: rgba(248,113,113,.7) !important; }
.se-light { display: grid; grid-template-columns: minmax(0, 1fr) 82px; gap: 8px; align-items: center; padding-left: 36px; }
.se-light input[type=range] { width: 100%; margin: 0; min-width: 0; accent-color: #34d399; }
.se-light .v { font-size: 11.5px; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--text-muted, var(--muted, #8b9bb4)); }
.se-light .v.dark { color: #60a5fa; } .se-light .v.bright { color: #fbbf24; }
.se-presets { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
@media (max-width: 640px) { .se-presets { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.se-preset { display: flex; flex-direction: column; gap: 6px; padding: 7px; border-radius: 9px; border: 1px solid var(--border, rgba(255,255,255,.08));
  background: var(--bg-surface, var(--surface-2, #0e1526)); color: var(--text, #f1f5f9); font: inherit; cursor: pointer; text-align: left; min-width: 0; transition: transform .15s, border-color .15s; }
.se-preset:hover { border-color: rgba(52,211,153,.55); transform: translateY(-1px); }
.se-preset.on { border-color: #34d399; box-shadow: 0 0 0 1px #34d399 inset; }
.se-preset .se-stripe { display: flex; height: 16px; border-radius: 5px; overflow: hidden; }
.se-preset .se-stripe i { flex: 1; }
.se-preset span { font-size: 11.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;
function injectCss() {
  if (document.getElementById('skin-editor-css')) return;
  const s = document.createElement('style');
  s.id = 'skin-editor-css';
  s.textContent = STYLE;
  document.head.append(s);
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * The region list in `host`: a picker and a hex code per region (ids
 * `${prefix}picker-<Region>` / `${prefix}hex-<Region>`), with `light: true` a
 * slider under each (darker / brighter; double click: back to × 1).
 *   onChange()  after any change by the user
 * Returns { get() → { colors: { Region: "#rrggbb" }, light: { Region: factor≠1 } },
 *           set({ colors? light? }), colours "#rrggbb" or linear { r, g, b }, setDisabled(bool) }.
 */
export function mountRegions(host, { prefix = '', light = false, colors = {}, lights = {}, onChange = () => {} } = {}) {
  injectCss();
  const state = { light: { ...lights } };
  host.classList.add('se-regions');
  host.innerHTML = REGIONS.map(([id, label]) => `
    <div class="se-region" data-region="${id}">
      <label class="se-row">
        <input type="color" class="se-pick" id="${prefix}picker-${id}" aria-label="${esc(label)}">
        <span class="se-name">${esc(label)}</span>
        <input type="text" class="se-hex" id="${prefix}hex-${id}" maxlength="7" spellcheck="false" aria-label="${esc(label)} (mã hex)">
      </label>
      ${light ? `<div class="se-light"><input type="range" min="${toSlider(LIGHT_MIN)}" max="${toSlider(LIGHT_MAX)}" step="0.01" data-se-light="${id}"
        aria-label="Độ sáng ${esc(label)}" title="Kéo trái: tối hơn · phải: sáng hơn (phát sáng) · bấm đúp: về thường"><span class="v" data-se-v="${id}"></span></div>` : ''}
    </div>`).join('');
  const pick = (id) => host.querySelector(`#${CSS.escape(`${prefix}picker-${id}`)}`);
  const hexIn = (id) => host.querySelector(`#${CSS.escape(`${prefix}hex-${id}`)}`);
  const showLight = () => {
    if (!light) return;
    for (const el of host.querySelectorAll('[data-se-light]')) el.value = toSlider(state.light[el.dataset.seLight] ?? 1);
    for (const el of host.querySelectorAll('[data-se-v]')) {
      const [text, cls] = lightText(state.light[el.dataset.seV] ?? 1);
      el.textContent = text;
      el.className = `v ${cls}`;
    }
  };
  const api = {
    get() {
      return { colors: Object.fromEntries(REGIONS.map(([id]) => [id, pick(id).value])), light: { ...state.light } };
    },
    set({ colors: c, light: l } = {}) {
      for (const [id] of REGIONS) {
        const v = c?.[id];
        if (!v) continue;
        const col = typeof v === 'string' ? v : hex(v);
        pick(id).value = col;
        hexIn(id).value = col;
        hexIn(id).classList.remove('bad');
      }
      if (l) state.light = { ...l };
      showLight();
    },
    setDisabled(off) { for (const el of host.querySelectorAll('input')) el.disabled = off; },
  };
  for (const [id] of REGIONS) {
    const p = pick(id), h = hexIn(id);
    p.addEventListener('input', () => { h.value = p.value; h.classList.remove('bad'); onChange(); });
    // Typing a hex code: taken once it is a full colour.
    h.addEventListener('input', () => {
      const v = h.value.trim().toLowerCase();
      const m = /^#?([0-9a-f]{6})$/.exec(v);
      h.classList.toggle('bad', !m && v.length >= 6);
      if (m) { p.value = `#${m[1]}`; onChange(); }
    });
    h.addEventListener('blur', () => { h.value = p.value; h.classList.remove('bad'); });
  }
  if (light) {
    host.addEventListener('input', (e) => {
      const el = e.target.closest?.('[data-se-light]');
      if (!el) return;
      const f = sliderFactor(el);
      if (Math.abs(f - 1) < 0.005) delete state.light[el.dataset.seLight]; else state.light[el.dataset.seLight] = f;
      showLight();
      onChange();
    });
    host.addEventListener('dblclick', (e) => {
      const el = e.target.closest?.('[data-se-light]');
      if (!el) return;
      delete state.light[el.dataset.seLight];
      showLight();
      onChange();
    });
  }
  api.set({ colors: Object.fromEntries(REGIONS.map(([id]) => [id, colors[id] ?? DEFAULT_COLORS[id]])), light: state.light });
  return api;
}

/** The palettes in `host`: a tile with its first five colours; onPick(colors "#rrggbb" by region). */
export function mountPresets(host, onPick) {
  injectCss();
  host.classList.add('se-presets');
  host.innerHTML = PRESETS.map((p, i) => `
    <button type="button" class="se-preset" data-preset="${i}" title="${esc(p.name)}">
      <div class="se-stripe">${REGIONS.slice(0, 5).map(([id]) => `<i style="background:${p.colors[id]}"></i>`).join('')}</div>
      <span>${esc(p.name)}</span>
    </button>`).join('');
  host.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (!btn) return;
    const p = PRESETS[Number(btn.dataset.preset)];
    if (!p) return;
    onPick(p.colors);
    for (const t of host.children) t.classList.toggle('on', t === btn);
  });
}

/** A light factor as a slider, for a "whole dino" control kept outside the list (the panel's brightness). */
export const lightSlider = { min: toSlider(LIGHT_MIN), max: toSlider(LIGHT_MAX), toSlider, value: sliderFactor };
