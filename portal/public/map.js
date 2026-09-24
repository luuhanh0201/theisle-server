// Your dino on the Gateway map: position and heading from /api/me (the bridge
// reads the game every second), your own recent trail, and the places players
// plan around (migration / patrol zones, sanctuaries, water, landmarks).
// Only YOUR dino: the portal never gets anyone else's position, nor the AI's.
//
// Base image and places: VulnonaMAP (Coco.N), fetched by the bridge
// (bridge/src/cli-fetch-map.ts) and shipped to public/map/. Map units = game
// world units / 1000, in the order the game SHOWS a location ("Y, X, Z"):
// map X (down the image) is world Y, map Y (right) is world X.

const LAYERS = [
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
const ZONES = new Set(['migration', 'patrol', 'sanctuary', 'mud']);
const TWEEN_MS = 900;
const COLOR = '#34d399';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unitsOf = (p) => [p.y / 1000, p.x / 1000];
const hexA = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

export function createMap(root) {
  root.innerHTML = `<div class="map-wrap">
      <canvas></canvas>
      <div class="map-tools">
        <button type="button" data-z="in" title="Phóng to">+</button>
        <button type="button" data-z="out" title="Thu nhỏ">−</button>
        <button type="button" data-z="follow" title="Bám theo dino" class="on">◎</button>
      </div>
      <div class="map-msg">Đang tải bản đồ…</div>
    </div>
    <div class="map-chips"></div>
    <p class="muted map-note"></p>`;
  const canvas = root.querySelector('canvas');
  const msg = root.querySelector('.map-msg');
  const followBtn = root.querySelector('[data-z="follow"]');
  const st = {
    data: null, img: null, view: null, fit: 1, size: '', raf: 0,
    follow: true, me: null, from: null, to: null, t0: 0,
    zoomIn: true,        // the first position zooms in on the dino (4x the whole island)
    on: new Set(LAYERS.filter((l) => l[3]).map((l) => l[0])),
    pointers: new Map(), drag: null, pinch: null,
  };
  try {
    const saved = JSON.parse(localStorage.getItem('portalMapLayers') ?? 'null');
    if (Array.isArray(saved)) st.on = new Set(saved.filter((id) => LAYER[id]));
  } catch { /* defaults */ }

  const toImg = ([x, y]) => {
    const b = st.data.bounds;
    return [(y - b.minY) / (b.maxY - b.minY) * st.img.naturalWidth, (x - b.minX) / (b.maxX - b.minX) * st.img.naturalHeight];
  };
  const scr = (p) => { const [ix, iy] = toImg(p); return [st.view.ox + ix * st.view.s, st.view.oy + iy * st.view.s]; };
  const rX = (r) => r / (st.data.bounds.maxX - st.data.bounds.minX) * st.img.naturalHeight * st.view.s;
  const rY = (r) => r / (st.data.bounds.maxY - st.data.bounds.minY) * st.img.naturalWidth * st.view.s;
  const draw = () => { if (!st.raf) st.raf = requestAnimationFrame(render); };

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
        st.view = { s: st.fit, ox: (cw - st.img.naturalWidth * st.fit) / 2, oy: (ch - st.img.naturalHeight * st.fit) / 2 };
      }
    }
    const pos = shown();
    if (pos && (st.follow || st.zoomIn)) { center(pos, st.zoomIn ? 4 : 0); st.zoomIn = false; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const { s, ox, oy } = st.view;
    const z = s / st.fit;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(st.img, ox, oy, st.img.naturalWidth * s, st.img.naturalHeight * s);

    const feats = st.data.features.filter((f) => st.on.has(f.layer) && (f.kind !== 'label'
      || (f.size === 'small' ? z >= 2.2 : f.layer === 'landmark' ? z >= 1.5 : f.layer === 'water' ? z >= 1.3 || f.size === 'large' : true)));
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
        text(ctx, f.text, x, y, `italic 600 ${big ? 12.5 : 11}px Inter, system-ui, sans-serif`, c);
      } else {
        text(ctx, f.text.toUpperCase(), x, y, `800 ${big ? 13 : 11}px Inter, system-ui, sans-serif`, hexA(c, 0.92));
      }
    }

    // Your trail, then your dino with its heading.
    const me = st.me;
    if (me && pos) {
      const trail = me.trail ?? [];
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
    if (st.to && performance.now() - st.t0 < TWEEN_MS) draw();
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
  const end = (e) => { st.pointers.delete(e.pointerId); if (st.pointers.size < 2) st.pinch = null; st.drag = null; };
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
    zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, b.dataset.z === 'in' ? 1.6 : 1 / 1.6);
  });
  window.addEventListener('resize', draw);

  // --- layers ---
  function chips() {
    root.querySelector('.map-chips').innerHTML = LAYERS.map(([id, label, color]) =>
      `<button type="button" class="chip${st.on.has(id) ? ' on' : ''}" data-layer="${id}"><i style="background:${color}"></i>${esc(label)}</button>`).join('');
  }
  root.querySelector('.map-chips').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-layer]');
    if (!b) return;
    const id = b.dataset.layer;
    if (st.on.has(id)) st.on.delete(id); else st.on.add(id);
    try { localStorage.setItem('portalMapLayers', JSON.stringify([...st.on])); } catch { /* not remembered */ }
    chips(); draw();
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
      msg.hidden = true;
      chips();
      root.querySelector('.map-note').innerHTML = `Bản đồ &amp; địa điểm: <a href="${esc(data.source.url)}" target="_blank" rel="noopener">${esc(data.source.name)}</a> (${esc(data.source.author)}), ${esc(data.name)} · ảnh nền chụp trong game, bản quyền của nhà phát triển. * dữ liệu tham khảo, không phải dữ liệu live của server.`;
      draw();
    } catch (err) {
      msg.textContent = `Không tải được bản đồ (${err.message ?? err}).`;
    }
  })();

  return {
    /** me.dino from /api/me (null = no dino). */
    update(dino) {
      if (!dino || !dino.position) {
        st.me = null; st.to = null; st.from = null;
        if (st.data) { msg.hidden = false; msg.textContent = 'Chưa có vị trí — vào game và điều khiển dino.'; }
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
      draw();
    },
  };
}
