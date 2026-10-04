// Your dino on the Gateway map: position and heading from /api/me (the bridge
// reads the game every second), your own recent trail, and the places players
// plan around (migration / patrol zones, sanctuaries, water, landmarks).
// Only YOUR dino: the portal never gets anyone else's position. The AI alive on
// the server and the game's fish are shown (the owner's choice), from /api/ai every 2 s.
//
// Base image and places: VulnonaMAP (Coco.N), fetched by the bridge
// (bridge/src/cli-fetch-map.ts) and shipped to public/map/. Map units = game
// world units / 1000, in the order the game SHOWS a location ("Y, X, Z"):
// map X (down the image) is world Y, map Y (right) is world X.

const LAYERS = [
  ['escape', 'Kẻ vượt ngục', '#f43f5e', true],
  ['heat', 'Mật độ người chơi', '#fb7185', true],
  ['ai', 'AI (live)', '#ef4444', true],
  ['fish', 'Cá (live)', '#22d3ee', true],
  ['aizone', 'Vùng AI', '#fb923c', true],
  ['migration', 'Vùng di cư', '#22c55e', true],
  ['sanctuary', 'Sanctuary', '#e879f9', true],
  ['patrol', 'Tuần tra', '#f97316', false],
  ['water', 'Nước', '#38bdf8', true],
  ['area', 'Khu vực', '#f8fafc', true],
  ['landmark', 'Địa danh', '#fbbf24', true],
  ['cave', 'Hang', '#c4b5fd', false],
  ['mud', 'Bùn', '#d97706', false],
  ['air', 'Luồng khí', '#7dd3fc', false],
  ['road', 'Đường mòn', '#e7e5e4', false],
  ['plant', 'Thực vật*', '#84cc16', false],
  ['mineral', 'Đá muối*', '#e2e8f0', false],
];
const LAYER = Object.fromEntries(LAYERS.map(([id, label, color, on]) => [id, { label, color, on }]));
/** Version of map/water-areas.json + water-mask.png (scripts/build-water-areas.py). */
const WATER_V = '2026-10-04c';
const ZONES = new Set(['migration', 'patrol', 'sanctuary', 'mud']);
// The game's fish by the names players use (as the admin map, World → Cá).
const FISH_VN = { Catfish: 'Cá trê', Coalecanth: 'Cá vây tay', Forktail: 'Forktail', Hoplo: 'Hoplo', Longear: 'Cá thái dương', Muskel: 'Muskel' };
const fishName = (s) => FISH_VN[s] ?? s ?? 'Cá';
const TWEEN_MS = 900;
const COLOR = '#34d399';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unitsOf = (p) => [p.y / 1000, p.x / 1000];
const hexA = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');
/** A white-on-transparent mask image, recoloured: a canvas the size of the image. */
function tintMask(img, color) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  return c;
}

/** The map picture where the land mask is (white = land), at half size: the island alone. */
function landCut(img, mask) {
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth / 2); c.height = Math.round(img.naturalHeight / 2);
  const x = c.getContext('2d');
  x.drawImage(mask, 0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-in';
  x.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// --- your trail: shown or hidden, cleared from a time on (this browser) -------------------
const TRAIL_KEY = 'isle-map-trail.v1';
function loadTrail() {
  try {
    const raw = JSON.parse(localStorage.getItem(TRAIL_KEY) ?? 'null');
    return { on: raw?.on !== false, clearedAt: Number.isFinite(raw?.clearedAt) ? raw.clearedAt : 0 };
  } catch {
    return { on: true, clearedAt: 0 };
  }
}
function saveTrail(t) {
  try { localStorage.setItem(TRAIL_KEY, JSON.stringify(t)); } catch { /* not remembered */ }
}

// --- waypoints ("điểm đến") ------------------------------------------------------------
// Tap the map to set where you are heading: a line from your dino points
// straight at it, here and on the launcher's mini map. Points can be saved
// with a name. Kept in this browser (localStorage), in world units like the
// dino's position.
const WP_KEY = 'isle-waypoints.v1';
const WP_MAX = 30;
export function loadWaypoints() {
  try {
    const raw = JSON.parse(localStorage.getItem(WP_KEY) ?? 'null');
    const ok = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
    return {
      target: ok(raw?.target) ? { x: raw.target.x, y: raw.target.y, name: String(raw.target.name ?? 'Điểm đến').slice(0, 40) } : null,
      saved: Array.isArray(raw?.saved) ? raw.saved.filter(ok).slice(0, WP_MAX).map((p) => ({ id: String(p.id), name: String(p.name).slice(0, 40), x: p.x, y: p.y })) : [],
    };
  } catch {
    return { target: null, saved: [] };
  }
}
function saveWaypoints(wp) {
  try { localStorage.setItem(WP_KEY, JSON.stringify(wp)); } catch { /* not remembered */ }
}
/** Metres between two world positions (cm), on the ground. */
export const distanceM = (a, b) => Math.hypot(b.x - a.x, b.y - a.y) / 100;
/** Compass bearing 0–360 (0 = north = up the map; world X east, Y south). */
export const bearingOf = (a, b) => (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI + 360) % 360;
const COMPASS = ['Bắc', 'Đông Bắc', 'Đông', 'Đông Nam', 'Nam', 'Tây Nam', 'Tây', 'Tây Bắc'];
export const compassName = (deg) => COMPASS[Math.round(deg / 45) % 8];
/** For the tests: which layers are on, as saved. */
export const loadLayersForTest = () => loadLayers();
export const saveLayersForTest = (on) => saveLayers(on);
export const fmtDistance = (m) => (m >= 1000 ? `${(m / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`);
const TARGET = '#facc15';
// Which layers are on: kept in this browser, shared by every map of the site (the launcher's map tab,
// its big map in game, the mini map drawn from them).
const LAYERS_KEY = 'portalMapLayers.v2';
// The layers there were when the choice was saved: one added since (the heat map) starts as its
// default, not "off" because it was not in an older choice.
const LAYERS_SEEN_KEY = 'portalMapLayers.seen';
function loadLayers() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null');
    if (Array.isArray(saved)) {
      const on = new Set(saved.filter((id) => LAYER[id]));
      const seenRaw = JSON.parse(localStorage.getItem(LAYERS_SEEN_KEY) ?? 'null');
      // Before this key: the layers up to the heat map.
      const seen = new Set(Array.isArray(seenRaw) ? seenRaw : LAYERS.map((l) => l[0]).filter((id) => id !== 'heat'));
      for (const [id, , , def] of LAYERS) if (def && !seen.has(id)) on.add(id);
      return on;
    }
  } catch { /* defaults */ }
  return new Set(LAYERS.filter((l) => l[3]).map((l) => l[0]));
}
function saveLayers(on) {
  try {
    localStorage.setItem(LAYERS_KEY, JSON.stringify([...on]));
    localStorage.setItem(LAYERS_SEEN_KEY, JSON.stringify(LAYERS.map((l) => l[0])));
  } catch { /* not remembered */ }
}
// The big map over the game (bigmap.html): the island at `map` opacity, its sea at SEA_SHARE of that,
// beyond the picture only the `dim` veil — the owner: "những nơi trống thì tự động mờ nhiều hơn".
const SEA_SHARE = 0.45;
export const LOOK_DEFAULT = { map: 0.85, dim: 0.35 };

/**
 * opts.overlay: the big map over the game — see-through (setLook), no page around it.
 */
export function createMap(root, opts = {}) {
  root.innerHTML = `<div class="map-wrap">
      <canvas></canvas>
      <div class="map-tools">
        <button type="button" class="map-tool-btn" data-z="in" title="Phóng to">+</button>
        <button type="button" class="map-tool-btn" data-z="out" title="Thu nhỏ">−</button>
        <button type="button" class="map-tool-btn on" data-z="follow" title="Bám theo dino">◎</button>
        <button type="button" class="map-tool-btn on" data-z="trail" title="Ẩn / hiện đường di chuyển" aria-pressed="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="3 3.2"><path d="M4 19c3-1 4-6 8-7s5-5 8-7"/></svg></button>
        <button type="button" class="map-tool-btn" data-z="clear" title="Xoá đường di chuyển (đường mới vẫn vẽ tiếp)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg></button>
      </div>
      <div class="map-msg">Đang tải bản đồ…</div>
      <div class="map-target" hidden>
        <div class="mt-info"><span class="mt-pin">📍</span><b class="mt-name"></b><span class="mt-dist"></span></div>
        <div class="mt-actions">
          <input class="mt-input" type="text" maxlength="40" placeholder="Tên điểm (vd. Hồ nước)" aria-label="Tên điểm">
          <button type="button" class="mt-save">Lưu điểm</button>
          <button type="button" class="mt-clear" title="Bỏ điểm đến">✕</button>
        </div>
      </div>
      <div class="map-hint">Bấm vào bản đồ để đặt điểm đến</div>
    </div>
    <div class="map-saved" hidden></div>
    <div class="map-chips"></div>
    <p class="muted map-note"></p>`;
  const canvas = root.querySelector('canvas');
  const msg = root.querySelector('.map-msg');
  const followBtn = root.querySelector('[data-z="follow"]');
  const st = {
    data: null, img: null, view: null, fit: 1, size: '', raf: 0,
    follow: true, me: null, from: null, to: null, t0: 0,
    zoomIn: true,        // the first position zooms in on the dino (4x the whole island)
    on: loadLayers(),
    pointers: new Map(), drag: null, pinch: null,
    ai: [],              // [{ s: species, x, y }] from /api/ai
    fish: [],            // the game's fish, [{ s, x, y }] from /api/ai .fish
    zones: [],           // AI zones the admins drew, from /api/ai-zones (the prison flagged)
    escapees: [],        // escaped inmates, [{ name, s, x, y, since }] from /api/ai .escapees
    heat: null,          // players per 500 m square, every 5 minutes: { t, cell, players, cells: [{ x, y, n }] }
    wp: loadWaypoints(), // { target, saved }
    trail: loadTrail(),  // { on, clearedAt }: shown or not; points up to clearedAt (unix s) hidden
    onTarget: null,      // told when the target changes (the launcher's overlay)
  };
  st.look = { ...LOOK_DEFAULT };
  // The big map over the game opens on the whole island, in the middle of the screen (the owner);
  // ◎ follows the dino from there.
  if (opts.overlay) { st.follow = false; st.zoomIn = false; followBtn.classList.remove('on'); }

  const toImg = ([x, y]) => {
    const b = st.data.bounds;
    return [(y - b.minY) / (b.maxY - b.minY) * st.img.naturalWidth, (x - b.minX) / (b.maxX - b.minX) * st.img.naturalHeight];
  };
  const scr = (p) => { const [ix, iy] = toImg(p); return [st.view.ox + ix * st.view.s, st.view.oy + iy * st.view.s]; };
  const rX = (r) => r / (st.data.bounds.maxX - st.data.bounds.minX) * st.img.naturalHeight * st.view.s;
  const rY = (r) => r / (st.data.bounds.maxY - st.data.bounds.minY) * st.img.naturalWidth * st.view.s;
  const draw = () => { if (!st.raf) st.raf = requestAnimationFrame(render); };
  /** Screen point → world position (cm), the inverse of scr(unitsOf(p)). */
  const toWorld = (sx, sy) => {
    const b = st.data.bounds;
    const ix = (sx - st.view.ox) / st.view.s; const iy = (sy - st.view.oy) / st.view.s;
    const mapY = ix / st.img.naturalWidth * (b.maxY - b.minY) + b.minY;
    const mapX = iy / st.img.naturalHeight * (b.maxX - b.minX) + b.minX;
    return { x: mapY * 1000, y: mapX * 1000 };
  };

  function shown() {
    if (!st.to) return null;
    const k = Math.min(1, (performance.now() - st.t0) / TWEEN_MS);
    return [st.from[0] + (st.to[0] - st.from[0]) * k, st.from[1] + (st.to[1] - st.from[1]) * k];
  }
  function center(pt, minZoom) {
    const [ix, iy] = toImg(pt);
    if (minZoom) st.view.s = Math.max(st.view.s, st.fit * minZoom);
    st.view.ox = canvas.clientWidth / 2 - ix * st.view.s;
    st.view.oy = canvas.clientHeight / 2 - iy * st.view.s;
  }
  function zoomAt(sx, sy, k) {
    const v = st.view;
    const s = Math.min(st.fit * 24, Math.max(st.fit * 0.8, v.s * k));
    v.ox = sx - (sx - v.ox) * (s / v.s); v.oy = sy - (sy - v.oy) * (s / v.s); v.s = s;
    draw();
  }
  function setFollow(on) {
    st.follow = on;
    followBtn.classList.toggle('on', on);
    if (on && shown()) { center(shown()); draw(); }
  }

  function text(ctx, t, x, y, font, color, align = 'center') {
    ctx.font = font; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const lines = String(t).split('\n');
    const lh = parseInt(font.match(/(\d+)px/)[1], 10) * 1.15;
    lines.forEach((l, i) => {
      const ly = y + (i - (lines.length - 1) / 2) * lh;
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(2,6,23,.78)'; ctx.strokeText(l, x, ly);
      ctx.fillStyle = color; ctx.fillText(l, x, ly);
    });
  }
  function trace(ctx, f) {
    ctx.beginPath();
    if (f.kind === 'circle') {
      const [cx, cy] = scr(f.at);
      ctx.ellipse(cx, cy, Math.max(1, rY(f.r[1])), Math.max(1, rX(f.r[0])), (f.rot ?? 0) * Math.PI / 180, 0, Math.PI * 2);
      return;
    }
    for (const ring of f.pts) {
      ring.forEach((p, i) => { const [x, y] = scr(p); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      if (f.kind === 'poly') ctx.closePath();
    }
  }
  function centerOf(f) {
    if (f.at) return f.at;
    const all = f.pts.flat();
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }

  function render() {
    st.raf = 0;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch || !st.data) return;
    const dpr = window.devicePixelRatio || 1;
    const size = `${cw}x${ch}x${dpr}`;
    if (size !== st.size) {
      st.size = size;
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      st.fit = Math.min(cw / st.img.naturalWidth, ch / st.img.naturalHeight);
      if (!st.view) {
        // The big map: a margin for its bar on top and its layer buttons below.
        const s0 = st.fit * (opts.overlay ? 0.82 : 1);
        st.view = { s: s0, ox: (cw - st.img.naturalWidth * s0) / 2, oy: (ch - st.img.naturalHeight * s0) / 2 };
      }
    }
    const pos = shown();
    if (pos && (st.follow || st.zoomIn)) { center(pos, st.zoomIn ? 4 : 0); st.zoomIn = false; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    paintScene(ctx, cw, ch, pos, st.fit);
    if (st.to && performance.now() - st.t0 < TWEEN_MS) draw();
  }

  /** Everything the map shows, at st.view, onto ctx (cw × ch, CSS pixels). `fit`: the whole-island scale. */
  function paintScene(ctx, cw, ch, pos, fit) {
    const { s, ox, oy } = st.view;
    const z = s / fit;
    ctx.imageSmoothingQuality = 'high';
    const iw = st.img.naturalWidth * s, ih = st.img.naturalHeight * s;
    if (opts.overlay) {
      // Over the game: a light veil everywhere, the sea faint, the island as set.
      ctx.fillStyle = `rgba(2,6,23,${st.look.dim})`; ctx.fillRect(0, 0, cw, ch);
      ctx.globalAlpha = st.look.map * (st.landCut ? SEA_SHARE : 1);
      ctx.drawImage(st.img, ox, oy, iw, ih);
      ctx.globalAlpha = st.look.map;
      if (st.landCut) ctx.drawImage(st.landCut, ox, oy, iw, ih);
      ctx.globalAlpha = 1;
    } else {
      ctx.drawImage(st.img, ox, oy, iw, ih);
    }

    // The water (Nước on), filled: every lake / river / pond pixel of the map painted over in the
    // layer's colour (owner: "tô đậm cả vùng nước"), a pond the image does not show as a filled dot.
    // Their names are drawn with the labels below, always shown while the layer is on.
    if (st.on.has('water')) {
      if (st.waterTint) {
        ctx.globalAlpha = 0.85;
        ctx.drawImage(st.waterTint, ox, oy, st.img.naturalWidth * s, st.img.naturalHeight * s);
        ctx.globalAlpha = 1;
      }
      for (const w of st.water ?? []) {
        if (w.kind !== 'circle') continue;
        trace(ctx, { kind: 'circle', at: w.at, r: [w.r * 0.6, w.r * 0.6] });
        ctx.fillStyle = hexA(LAYER.water.color, 0.75); ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(2,6,23,.6)'; ctx.stroke();
      }
    }

    const feats = st.data.features.filter((f) => st.on.has(f.layer) && (f.kind !== 'label'
      || f.layer === 'water'   // a water's name goes with its outline, at every zoom
      || (f.size === 'small' ? z >= 2.2 : f.layer === 'landmark' ? z >= 1.5 : true)));
    for (const f of feats) {
      if (!ZONES.has(f.layer)) continue;
      const c = LAYER[f.layer].color;
      trace(ctx, f);
      if (f.kind !== 'path') { ctx.fillStyle = hexA(c, 0.14); ctx.fill(); }
      ctx.setLineDash(f.mass ? [7, 5] : []); ctx.lineWidth = 1.5; ctx.strokeStyle = hexA(c, 0.9); ctx.stroke(); ctx.setLineDash([]);
      if (f.layer !== 'mud' && (f.layer === 'migration' || z >= 1.6)) {
        const [x, y] = scr(centerOf(f));
        text(ctx, f.name, x, y, '700 11px Inter, system-ui, sans-serif', c);
      }
    }
    for (const f of feats) {
      if (f.kind !== 'path' || ZONES.has(f.layer)) continue;
      const c = LAYER[f.layer].color;
      trace(ctx, f);
      ctx.setLineDash(f.layer === 'road' ? [4, 4] : []); ctx.lineWidth = f.layer === 'road' ? 1.3 : 2.2;
      ctx.strokeStyle = hexA(c, f.layer === 'road' ? 0.6 : 0.9); ctx.stroke(); ctx.setLineDash([]);
    }
    const pr = Math.max(2.2, Math.min(5, 1.6 * Math.sqrt(z)));
    for (const f of feats) {
      if (f.kind !== 'point') continue;
      const [x, y] = scr(f.at);
      if (x < -10 || y < -10 || x > cw + 10 || y > ch + 10) continue;
      ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI * 2); ctx.fillStyle = LAYER[f.layer].color; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(2,6,23,.85)'; ctx.stroke();
    }
    for (const f of feats) {
      if (f.kind !== 'label') continue;
      const [x, y] = scr(f.at);
      const c = LAYER[f.layer].color, big = f.size === 'large';
      if (f.layer === 'landmark') {
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
        text(ctx, f.text, x + 7, y, `600 ${big ? 12 : 11}px Inter, system-ui, sans-serif`, c, 'left');
      } else if (f.layer === 'water') {
        text(ctx, f.text, x, y, `italic 700 ${big ? 13 : 11.5}px Inter, system-ui, sans-serif`, '#e0f2fe');
      } else {
        text(ctx, f.text.toUpperCase(), x, y, `800 ${big ? 13 : 11}px Inter, system-ui, sans-serif`, hexA(c, 0.92));
      }
    }

    // Where players are (the heat map, a picture every 5 minutes, admins left out): a glow per 500 m
    // square, stronger for more players, the count in it — never who, nor where in the square.
    if (st.on.has('heat') && st.heat) {
      const r = Math.max(16, rY(st.heat.cell / 1000) * 0.85);
      for (const c of st.heat.cells) {
        const [x, y] = scr(unitsOf(c));
        if (x < -r || y < -r || x > cw + r || y > ch + r) continue;
        const a = Math.min(0.85, 0.32 + 0.13 * c.n);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(239,68,68,${a})`);
        g.addColorStop(0.55, `rgba(249,115,22,${(a * 0.55).toFixed(3)})`);
        g.addColorStop(1, 'rgba(250,204,21,0)');
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
        text(ctx, z >= 1.6 ? `${c.n} người` : String(c.n), x, y, '800 12px Inter, system-ui, sans-serif', '#fff1f2');
      }
    }

    // AI zones the admins drew: where the server keeps AI (name, which kinds).
    if (st.on.has('aizone')) {
      for (const zn of st.zones) {
        // A circle, or the outline the admin drew (ellipse / polygon, game units).
        const f = Array.isArray(zn.outline) && zn.outline.length >= 3
          ? { kind: 'poly', at: unitsOf(zn), pts: [zn.outline.map(([x, y]) => unitsOf({ x, y }))] }
          : { kind: 'circle', at: unitsOf(zn), r: [zn.radiusM / 10, zn.radiusM / 10] };
        // The prison (an admin zone ticked "Nhà tù"): purple, no AI in it.
        const c = zn.prison ? '#a855f7' : LAYER.aizone.color;
        trace(ctx, f);
        ctx.fillStyle = hexA(c, 0.14); ctx.fill();
        // A dark outline under a bright ring: the edge reads on any ground.
        ctx.lineWidth = 5.5; ctx.strokeStyle = 'rgba(2,6,23,.85)'; ctx.stroke();
        ctx.lineWidth = 2.5; ctx.strokeStyle = c; ctx.stroke();
        const [x, y] = scr(f.at);
        text(ctx, zn.prison ? `🔒 ${zn.name}` : zn.name, x, y - (z >= 1.8 && !zn.prison ? 7 : 0), '700 11.5px Inter, system-ui, sans-serif', zn.prison ? '#e9d5ff' : '#fed7aa');
        if (z >= 1.8 && !zn.prison) text(ctx, zn.species.join(', '), x, y + 8, '600 10px Inter, system-ui, sans-serif', '#ffedd5');
      }
    }

    // The game's fish alive now: a small fish-shaped mark (body + tail), as on the admin map.
    if (st.on.has('fish')) {
      const r = Math.max(2.5, Math.min(5, 2 * Math.sqrt(z)));
      for (const a of st.fish) {
        const [x, y] = scr(unitsOf(a));
        if (x < -10 || y < -10 || x > cw + 10 || y > ch + 10) continue;
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.5, r, 0, 0, Math.PI * 2);
        ctx.moveTo(x - r * 1.3, y);
        ctx.lineTo(x - r * 2.5, y - r * 0.9);
        ctx.lineTo(x - r * 2.5, y + r * 0.9);
        ctx.closePath();
        ctx.fillStyle = LAYER.fish.color; ctx.fill();
        ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(2,6,23,.9)'; ctx.stroke();
        if (z >= 4) text(ctx, fishName(a.s), x, y - r - 8, '600 10.5px Inter, system-ui, sans-serif', '#a5f3fc');
      }
    }

    // The AI alive on the server now, under your own dino.
    if (st.on.has('ai')) {
      const r = Math.max(3, Math.min(6, 2.4 * Math.sqrt(z)));
      for (const a of st.ai) {
        const [x, y] = scr(unitsOf(a));
        if (x < -10 || y < -10 || x > cw + 10 || y > ch + 10) continue;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = LAYER.ai.color; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(2,6,23,.9)'; ctx.stroke();
        if (z >= 3) text(ctx, a.s ?? 'AI', x, y - r - 8, '600 10.5px Inter, system-ui, sans-serif', '#fecaca');
      }
    }

    // Escaped inmates: everyone may hunt them (the prison, bridge prison.ts). Always labelled.
    if (st.on.has('escape')) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300);
      for (const a of st.escapees) {
        const [x, y] = scr(unitsOf(a));
        if (x < -20 || y < -20 || x > cw + 20 || y > ch + 20) continue;
        ctx.beginPath(); ctx.arc(x, y, 10 + 4 * pulse, 0, Math.PI * 2);
        ctx.fillStyle = hexA(LAYER.escape.color, 0.25); ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = LAYER.escape.color; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
        text(ctx, `Kẻ vượt ngục - ${a.name ?? '?'}`, x, y - 18, '800 12px Inter, system-ui, sans-serif', '#fecdd3');
      }
    }

    // Where you are heading: a line from the dino straight to it, and a pin.
    const tg = st.wp.target;
    if (tg) {
      const [tx, ty] = scr(unitsOf(tg));
      if (pos) {
        const [dx, dy] = scr(pos);
        ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(tx, ty); ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(2,6,23,.75)'; ctx.lineWidth = 6; ctx.stroke();
        ctx.strokeStyle = TARGET; ctx.lineWidth = 3; ctx.setLineDash([10, 7]); ctx.stroke(); ctx.setLineDash([]);
        const d = distanceM(st.me.position, tg);
        text(ctx, fmtDistance(d), (dx + tx) / 2, (dy + ty) / 2 - 12, '800 12px Inter, system-ui, sans-serif', TARGET);
      }
      // the pin: a drop with a dot, its point on the spot
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.bezierCurveTo(tx - 10, ty - 12, tx - 9, ty - 26, tx, ty - 26);
      ctx.bezierCurveTo(tx + 9, ty - 26, tx + 10, ty - 12, tx, ty);
      ctx.fillStyle = TARGET; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(2,6,23,.9)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(tx, ty - 17, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#1a1400'; ctx.fill();
      if (tg.name && tg.name !== 'Điểm đến') text(ctx, tg.name, tx, ty - 36, '700 11.5px Inter, system-ui, sans-serif', '#fde68a');
    }

    // Your trail (unless hidden, from where it was last cleared), then your dino with its heading.
    const me = st.me;
    if (me && pos) {
      const trail = st.trail.on ? (me.trail ?? []).filter((pt) => !(pt.t <= st.trail.clearedAt)) : [];
      if (trail.length > 0) {
        ctx.beginPath();
        trail.forEach((pt, i) => { const [x, y] = scr(unitsOf(pt)); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        const [dx, dy] = scr(pos); ctx.lineTo(dx, dy);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(2,6,23,.6)'; ctx.lineWidth = 5; ctx.stroke();
        ctx.strokeStyle = COLOR; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
      }
      const [x, y] = scr(pos);
      if (typeof me.position.yaw === 'number') {
        // Navigation triangle pointing along world forward (cos yaw, sin yaw).
        // World X is right and world Y down on screen; centroid is centered at (x, y).
        const a = me.position.yaw * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
        const tip = 18, back = 9, half = 10;
        const triangle = () => {
          ctx.beginPath();
          ctx.moveTo(x + dx * tip, y + dy * tip);
          ctx.lineTo(x - dx * back + nx * half, y - dy * back + ny * half);
          ctx.lineTo(x - dx * back - nx * half, y - dy * back - ny * half);
          ctx.closePath();
        };
        ctx.lineJoin = 'round';
        // Dark outline for strong contrast on any terrain
        triangle(); ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(2,6,23,.85)'; ctx.stroke();
        // Crisp white border
        triangle(); ctx.lineWidth = 2.8; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        // Directional gradient fill (emerald depth to radiant tip)
        const grad = ctx.createLinearGradient(x - dx * back, y - dy * back, x + dx * tip, y + dy * tip);
        grad.addColorStop(0, '#059669');
        grad.addColorStop(1, COLOR);
        ctx.fillStyle = grad;
        triangle(); ctx.fill();
        // Precise coordinate center dot
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
      } else {
        // Fallback dot if heading is unavailable
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fillStyle = COLOR; ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
      }
    }
  }

  /**
   * The launcher's mini map: this map as it is — its layers, target, trail, AI… — around your dino,
   * radiusM metres to the edge, north up or turned with the dino, onto `c` (width × height CSS px at
   * dpr). False when there is nothing to draw yet (no map, no position).
   */
  function paintMini(c, { width, height, dpr = 1, radiusM = 500, rotate = 'north' }) {
    const pos = shown();
    if (!st.data || !pos || !(width > 0) || !(height > 0)) return false;
    const w = Math.round(width * dpr), h = Math.round(height * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const b = st.data.bounds;
    const s = (Math.min(width, height) / 2) / (radiusM / 10 * (st.img.naturalWidth / (b.maxY - b.minY)));
    const [ix, iy] = toImg(pos);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, width, height);   // beyond the picture's edge
    const yaw = st.me?.position?.yaw;
    if (rotate === 'heading' && typeof yaw === 'number') {
      ctx.translate(width / 2, height / 2); ctx.rotate(-Math.PI / 2 - yaw * Math.PI / 180); ctx.translate(-width / 2, -height / 2);
    }
    const kept = st.view;
    st.view = { s, ox: width / 2 - ix * s, oy: height / 2 - iy * s };
    try {
      paintScene(ctx, width, height, pos, Math.min(width / st.img.naturalWidth, height / st.img.naturalHeight));
    } finally {
      st.view = kept;
    }
    return true;
  }

  // --- input ---
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => {
    if (!st.view) return;
    canvas.setPointerCapture(e.pointerId);
    st.pointers.set(e.pointerId, local(e));
    if (st.pointers.size === 1) { const [x, y] = local(e); st.drag = { x, y, ox: st.view.ox, oy: st.view.oy, moved: false }; }
    else if (st.pointers.size === 2) {
      const [a, b] = [...st.pointers.values()];
      st.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: st.view.s }; st.drag = null;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!st.view || !st.pointers.has(e.pointerId)) return;
    const [x, y] = local(e);
    st.pointers.set(e.pointerId, [x, y]);
    if (st.pinch && st.pointers.size === 2) {
      const [a, b] = [...st.pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (st.pinch.s * d / st.pinch.d) / st.view.s);
      return;
    }
    if (st.drag) {
      const dx = x - st.drag.x, dy = y - st.drag.y;
      if (!st.drag.moved && Math.hypot(dx, dy) > 4) { st.drag.moved = true; setFollow(false); }
      if (st.drag.moved) { st.view.ox = st.drag.ox + dx; st.view.oy = st.drag.oy + dy; draw(); }
    }
  });
  const end = (e) => {
    // A tap (no drag, one finger): that is where you are heading.
    const tap = st.drag && !st.drag.moved && st.pointers.size === 1 && e.type === 'pointerup';
    st.pointers.delete(e.pointerId); if (st.pointers.size < 2) st.pinch = null; st.drag = null;
    if (tap && st.data && st.view) { const [x, y] = local(e); setTarget({ ...toWorld(x, y), name: 'Điểm đến' }); }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    if (!st.view) return;
    e.preventDefault();
    const [x, y] = local(e);
    // Following keeps the dino centred, so zoom around it then.
    if (st.follow) zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, Math.exp(-e.deltaY * 0.0018));
    else zoomAt(x, y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018)));
  }, { passive: false });
  root.querySelector('.map-tools').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-z]');
    if (!b || !st.view) return;
    if (b.dataset.z === 'follow') { setFollow(!st.follow); return; }
    if (b.dataset.z === 'trail') {
      st.trail.on = !st.trail.on;
      saveTrail(st.trail);
      trailButtons();
      draw();
      return;
    }
    if (b.dataset.z === 'clear') {
      // Hide what is drawn now; where the dino goes next is drawn again.
      const pts = st.me?.trail ?? [];
      st.trail.clearedAt = pts.length ? Math.max(...pts.map((p) => p.t ?? 0)) : Math.floor(Date.now() / 1000);
      saveTrail(st.trail);
      draw();
      return;
    }
    zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, b.dataset.z === 'in' ? 1.6 : 1 / 1.6);
  });
  window.addEventListener('resize', draw);
  const trailButtons = () => {
    const b = root.querySelector('[data-z="trail"]');
    b.classList.toggle('on', st.trail.on);
    b.setAttribute('aria-pressed', String(st.trail.on));
    b.title = st.trail.on ? 'Ẩn đường di chuyển' : 'Hiện đường di chuyển';
  };
  trailButtons();

  // --- layers ---
  function chips() {
    root.querySelector('.map-chips').innerHTML = LAYERS.map(([id, label, color]) =>
      `<button type="button" class="chip${st.on.has(id) ? ' on' : ''}" data-layer="${id}"><i style="background:${color}"></i>${esc(label)}${id === 'ai' ? ` <b class="ai-n">${st.ai.length}</b>` : id === 'escape' ? ` <b class="esc-n">${st.escapees.length}</b>` : id === 'fish' ? ` <b class="fish-n">${st.fish.length}</b>` : id === 'aizone' ? ` <b class="az-n">${st.zones.length}</b>` : id === 'heat' ? ` <b class="heat-n">${st.heat?.players ?? 0}</b>` : ''}</button>`).join('');
  }
  root.querySelector('.map-chips').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-layer]');
    if (!b) return;
    const id = b.dataset.layer;
    if (st.on.has(id)) st.on.delete(id); else st.on.add(id);
    saveLayers(st.on);
    chips(); draw();
  });

  // --- the target bar and the saved points ---
  const bar = root.querySelector('.map-target');
  const hint = root.querySelector('.map-hint');
  const savedEl = root.querySelector('.map-saved');
  function setTarget(t) {
    st.wp.target = t ? { x: t.x, y: t.y, name: t.name || 'Điểm đến' } : null;
    saveWaypoints(st.wp);
    const input = bar.querySelector('.mt-input');
    input.value = t && t.name !== 'Điểm đến' ? t.name : '';
    renderTarget(); renderSaved(); draw();
    if (st.onTarget) st.onTarget(st.wp.target);
  }
  function renderTarget() {
    const t = st.wp.target;
    bar.hidden = !t;
    hint.hidden = Boolean(t);
    if (!t) return;
    bar.querySelector('.mt-name').textContent = t.name;
    const me = st.me && st.me.position;
    bar.querySelector('.mt-dist').textContent = me
      ? `${fmtDistance(distanceM(me, t))} · hướng ${compassName(bearingOf(me, t))}${distanceM(me, t) < 30 ? ' · đã tới nơi ✓' : ''}`
      : 'vào game để thấy khoảng cách';
    const isSaved = st.wp.saved.some((p) => p.x === t.x && p.y === t.y);
    bar.querySelector('.mt-save').textContent = isSaved ? 'Đã lưu ✓' : 'Lưu điểm';
    bar.querySelector('.mt-save').disabled = isSaved;
  }
  function renderSaved() {
    savedEl.hidden = st.wp.saved.length === 0;
    const t = st.wp.target;
    savedEl.innerHTML = `<span class="ms-label">📍 Điểm đã lưu</span>` + st.wp.saved.map((p) =>
      `<span class="ms-item${t && t.x === p.x && t.y === p.y ? ' on' : ''}"><button type="button" data-go="${esc(p.id)}" title="Chọn làm điểm đến">${esc(p.name)}</button><button type="button" class="ms-del" data-del="${esc(p.id)}" title="Xoá điểm này">✕</button></span>`).join('');
  }
  bar.querySelector('.mt-clear').addEventListener('click', () => setTarget(null));
  bar.querySelector('.mt-save').addEventListener('click', () => {
    const t = st.wp.target;
    if (!t) return;
    const name = bar.querySelector('.mt-input').value.trim().slice(0, 40) || `Điểm ${st.wp.saved.length + 1}`;
    st.wp.saved = [{ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, x: t.x, y: t.y }, ...st.wp.saved].slice(0, WP_MAX);
    st.wp.target = { ...t, name };
    saveWaypoints(st.wp);
    renderTarget(); renderSaved(); draw();
    if (st.onTarget) st.onTarget(st.wp.target);
  });
  bar.querySelector('.mt-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') bar.querySelector('.mt-save').click(); });
  // Typing a name must not pan / zoom the map or hit the page's keys.
  for (const ev of ['pointerdown', 'wheel', 'keydown']) bar.addEventListener(ev, (e) => e.stopPropagation());
  savedEl.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    const del = e.target.closest('[data-del]');
    if (go) { const p = st.wp.saved.find((x) => x.id === go.dataset.go); if (p) setTarget(p); }
    if (del) {
      const p = st.wp.saved.find((x) => x.id === del.dataset.del);
      st.wp.saved = st.wp.saved.filter((x) => x.id !== del.dataset.del);
      if (p && st.wp.target && st.wp.target.x === p.x && st.wp.target.y === p.y) st.wp.target = { ...st.wp.target, name: 'Điểm đến' };
      saveWaypoints(st.wp); renderTarget(); renderSaved(); draw();
      if (st.onTarget) st.onTarget(st.wp.target);
    }
  });
  renderTarget(); renderSaved();

  // Another page of the site changed them (the big map in game, the launcher's map tab): the same here.
  window.addEventListener('storage', (e) => {
    if (e.key === LAYERS_KEY) { st.on = loadLayers(); chips(); draw(); }
    else if (e.key === WP_KEY) { st.wp = loadWaypoints(); renderTarget(); renderSaved(); draw(); if (st.onTarget) st.onTarget(st.wp.target); }
    else if (e.key === TRAIL_KEY) { st.trail = loadTrail(); trailButtons(); draw(); }
  });

  (async () => {
    try {
      const r = await fetch('/map/gateway.json', { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      // VulnonaMAP's "animal" spots are not AI you can meet (Evrima spawns AI around players).
      data.features = data.features.filter((f) => f.layer !== 'animal');
      const img = new Image();
      img.src = `/map/${encodeURIComponent(data.image)}?v=${encodeURIComponent(data.updated)}`;
      await img.decode();
      st.data = data; st.img = img;
      // The waters outlined (scripts/build-water-areas.py, from the map image): highlighted with the Nước layer.
      // WATER_V: bump after re-running the script (the proxy keeps /map/* a week).
      fetch(`/map/water-areas.json?v=${WATER_V}`, { credentials: 'same-origin' }).then((w) => (w.ok ? w.json() : null))
        .then((w) => { st.water = Array.isArray(w?.areas) ? w.areas : []; draw(); }).catch(() => undefined);
      // Every water pixel of the map (scripts/build-water-areas.py), tinted once in the layer's colour.
      st.waterTint = null;
      const mask = new Image();
      mask.src = `/map/water-mask.png?v=${WATER_V}`;
      mask.decode().then(() => { st.waterTint = tintMask(mask, LAYER.water.color); draw(); }).catch(() => undefined);
      // The big map over the game: the island cut out of the picture (half size), to fade the sea.
      if (opts.overlay) {
        const land = new Image();
        land.src = `/map/land-mask.png?v=${WATER_V}`;
        land.decode().then(() => { st.landCut = landCut(img, land); draw(); }).catch(() => undefined);
      }
      msg.hidden = true;
      chips();
      root.querySelector('.map-note').innerHTML = `Bản đồ &amp; địa điểm: <a href="${esc(data.source.url)}" target="_blank" rel="noopener">${esc(data.source.name)}</a> (${esc(data.source.author)}), ${esc(data.name)} · ảnh nền chụp trong game, bản quyền của nhà phát triển. * dữ liệu tham khảo, không phải dữ liệu live của server.`;
      draw();
    } catch (err) {
      msg.textContent = `Không tải được bản đồ (${err.message ?? err}).`;
    }
  })();

  return {
    /** /api/ai .list: [{ s, x, y }] (empty when the server is down). */
    setAi(list) {
      st.ai = Array.isArray(list) ? list.filter((a) => typeof a?.x === 'number' && typeof a?.y === 'number') : [];
      const n = root.querySelector('.map-chips .ai-n');
      if (n) n.textContent = String(st.ai.length);
      draw();
    },
    /** /api/ai .fish: [{ s, x, y }] (absent from an older bridge: no fish). */
    setFish(list) {
      st.fish = Array.isArray(list) ? list.filter((a) => typeof a?.x === 'number' && typeof a?.y === 'number') : [];
      const n = root.querySelector('.map-chips .fish-n');
      if (n) n.textContent = String(st.fish.length);
      draw();
    },
    /** /api/ai .escapees: escaped inmates [{ name, s, x, y, since }] (absent from an older bridge). */
    setEscapees(list) {
      st.escapees = Array.isArray(list) ? list.filter((a) => typeof a?.x === 'number' && typeof a?.y === 'number') : [];
      const n = root.querySelector('.map-chips .esc-n');
      if (n) n.textContent = String(st.escapees.length);
      draw();
    },
    /** /api/heatmap: { t, next, cell, players, cells: [{ x, y, n }] } (null: none yet). */
    setHeat(h) {
      st.heat = h && Array.isArray(h.cells) && Number.isFinite(h.cell)
        ? { ...h, cells: h.cells.filter((c) => Number.isFinite(c?.x) && Number.isFinite(c?.y) && c.n > 0) } : null;
      const n = root.querySelector('.map-chips .heat-n');
      if (n) n.textContent = String(st.heat?.players ?? 0);
      draw();
    },
    /** /api/ai-zones .zones: [{ name, x, y, radiusM, species: [labels], count }]. */
    setAiZones(list) {
      st.zones = Array.isArray(list) ? list.filter((zn) => typeof zn?.x === 'number' && typeof zn?.y === 'number' && typeof zn?.radiusM === 'number') : [];
      const n = root.querySelector('.map-chips .az-n');
      if (n) n.textContent = String(st.zones.length);
      draw();
    },
    /** me.dino from /api/me (null = no dino). */
    update(dino) {
      if (!dino || !dino.position) {
        st.me = null; st.to = null; st.from = null;
        if (st.data) { msg.hidden = false; msg.textContent = 'Chưa có vị trí: vào game và điều khiển dino.'; }
        draw();
        return;
      }
      if (st.data) msg.hidden = true;
      const to = unitsOf(dino.position);
      const cur = shown();
      // A jump (respawn, teleport) is not glided across the map.
      const far = !cur || Math.hypot(to[0] - cur[0], to[1] - cur[1]) > 60;
      st.from = far ? to : cur; st.to = to; st.t0 = performance.now();
      st.me = dino;
      renderTarget();
      draw();
    },
    /** The target you set on the map ({ x, y, name } in world units), or null. */
    getTarget() { return st.wp.target; },
    paintMini,
    /** The whole island again, in the middle (the big map, each time it opens). */
    resetView() {
      st.view = null; st.size = '';
      if (opts.overlay) { st.follow = false; followBtn.classList.remove('on'); }
      draw();
    },
    /** The big map over the game: { map, dim } opacities 0–1. */
    setLook(look) {
      const clamp = (v, d) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
      st.look = { map: clamp(look?.map, st.look.map), dim: clamp(look?.dim, st.look.dim) };
      draw();
    },
    onTargetChange(cb) { st.onTarget = cb; },
  };
}
