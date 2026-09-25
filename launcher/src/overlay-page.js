'use strict';
// overlay.html?w=<voice|map|dino|quests>: one widget, drawn from what the launcher sends.
(() => {
  const $ = (id) => document.getElementById(id);
  const W = new URLSearchParams(location.search).get('w') || 'voice';
  // Data comes about once a second, mostly unchanged. Touch the page only when
  // something really changed: every change is a redraw, taken from the game.
  const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  const setWidth = (el, w) => { if (el.style.width !== w) el.style.width = w; };
  const ICON_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  const ICON_MUTED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 3l18 18M9 9v2a3 3 0 0 0 5 2.2M15 10V6a3 3 0 0 0-5.7-1.3M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 10.5 6M12 18v3"/></svg>';
  let settings = null;
  let voice = null;
  let game = null;
  let previewUntil = 0;
  // Sample content while tuning: "Xem thử", and while dragging / resizing.
  const preview = () => Date.now() < previewUntil || Boolean(settings && settings.editing);

  // --- sample data for "Xem thử" -------------------------------------------------------
  const SAMPLE_VOICE = {
    connected: true, inGame: true, talking: true, mode: 'ptt', pttLabel: 'V', range: 30, rangeName: 'Nói thường', nameMode: 'name',
    speakers: [
      { name: 'Rex Già', speaking: true, gain: 0.9, pan: 0.8 },
      { name: 'Troodon Nhỏ', speaking: true, gain: 0.45, pan: -0.7 },
      { name: 'Anky', speaking: false, gain: 0.2, pan: 0 },
    ],
    toast: { text: 'Tầm giọng: 30 m — Nói thường', at: 0 },
  };
  const SAMPLE_GAME = {
    dino: {
      species: 'Carnotaurus', growth: 0.62,
      vitals: { health: 980, stamina: 70, hunger: 55, thirst: 38, blood: 100, oxygen: 100 },
      max: { health: 1300, stamina: 100, hunger: 100, thirst: 100, blood: 100, oxygen: 100 },
      position: { x: 148696, y: 349211, z: 21345, yaw: 40 },
      trail: [{ x: 128000, y: 322000 }, { x: 136000, y: 333000 }, { x: 143500, y: 342500 }],
      prime: {
        isPrime: false, eligible: false, met: 3, growth: 0.62, deadline: 0.75, locked: false,
        conditions: [
          { n: 3, label: 'Chế độ ăn hoàn hảo', passive: false, met: true },
          { n: 4, label: 'Vào vùng Mass Migration', passive: false, met: true },
          { n: 5, label: 'Đi qua 2 vùng di cư khác nhau', passive: false, met: false },
          { n: 8, label: 'Không bao giờ bị vô sinh', passive: true, met: true },
          { n: 6, label: 'Đi qua 4 vùng tuần tra khác nhau', passive: false, met: null },
        ],
      },
    },
    ai: [{ s: 'Boar', x: 163000, y: 356000 }, { s: 'Deer', x: 141000, y: 368000 }, { s: 'Deer', x: 170000, y: 338000 }],
    target: { x: 176000, y: 322000, name: 'Hồ nước' },
  };

  // --- voice ----------------------------------------------------------------------------
  let toastTimer = null;
  let lastToastAt = 0;
  function renderVoice() {
    const st = preview() ? SAMPLE_VOICE : voice;
    const show = settings.show;
    $('w-voice').className = `wrap a-${settings.anchor} s-${settings.style}`;
    if (!st || !st.connected) {
      $('self').hidden = true; $('speakers').replaceChildren(); $('toast').hidden = true;
      $('warn').hidden = !(show.warnings && st && st.lost);
      if (!$('warn').hidden) { $('warn').className = 'box bad'; $('warn').textContent = '✕ Voice mất kết nối'; }
      return;
    }
    const speaking = (st.speakers || []).filter((p) => p.speaking);
    const idle = settings.autoHide === 'idle' && !st.talking && speaking.length === 0 && !preview();
    let warn = '';
    if (st.phase === 'reconnecting') warn = '◌ Voice đang nối lại…';
    else if (st.inGame === false) warn = '! Chưa vào game — không ai nghe thấy bạn';
    $('warn').hidden = !(show.warnings && warn);
    $('warn').className = 'box warn';
    $('warn').textContent = warn;
    $('self').hidden = !(show.self || show.range) || (idle && !warn);
    $('self-row').className = `row${st.talking ? ' on' : ''}`;
    const off = st.mode === 'off';
    $('self-ic').innerHTML = off ? ICON_MUTED : ICON_MIC;
    $('self-ic').classList.toggle('muted-ic', off);
    $('self-txt').hidden = !show.self;
    $('self-ic').hidden = !show.self;
    $('self-txt').textContent = off ? 'Mic tắt' : st.talking ? 'Đang nói' : st.mode === 'ptt' ? `Giữ ${st.pttLabel || 'phím'} để nói` : 'Im lặng';
    $('self-range').hidden = !show.range;
    $('self-range').textContent = `${st.range} m · ${st.rangeName}`;
    const list = show.speakers && !idle ? (st.speakers || []).slice(0, settings.maxSpeakers) : [];
    $('speakers').replaceChildren(...list.map((p) => {
      const el = document.createElement('div');
      el.className = `sp${p.speaking ? ' on' : ''}`;
      const ic = document.createElement('span');
      ic.className = 'ic';
      ic.innerHTML = ICON_MIC;
      const nm = document.createElement('span');
      nm.className = 'name';
      nm.textContent = st.nameMode === 'none' ? 'Có người' : (p.name || 'Người chơi');
      el.append(ic, nm);
      if (show.direction) {
        const d = document.createElement('span');
        d.className = 'dir';
        const side = p.pan >= 0.5 ? 'bên phải ▶' : p.pan <= -0.5 ? '◀ bên trái' : 'phía trước';
        d.textContent = `${p.gain >= 0.8 ? 'rất gần' : p.gain >= 0.4 ? 'gần' : 'xa'} · ${side}`;
        const v = document.createElement('span');
        v.className = 'vol';
        const i = document.createElement('i');
        i.style.width = `${Math.round(Math.max(0.05, Math.min(1, p.gain)) * 100)}%`;
        v.append(i);
        el.append(d, v);
      }
      return el;
    }));
    const t = st.toast;
    if (show.toasts && t && (t.at > lastToastAt || preview())) {
      lastToastAt = t.at;
      $('toast').textContent = t.text;
      $('toast').hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2200);
    }
  }

  // --- mini map ---------------------------------------------------------------------------
  // Map units = world units / 1000 in the order the game shows a location:
  // map X (down the image) = world Y, map Y (right) = world X (portal/public/map.js).
  const ZONES = { migration: '#22c55e', sanctuary: '#e879f9', patrol: '#f97316', mud: '#d97706' };
  const POINTS = { water: '#38bdf8', landmark: '#fbbf24' };
  const map = { data: null, img: null };
  const unitsOf = (p) => [p.y / 1000, p.x / 1000];
  function toImg([x, y]) {
    const b = map.data.bounds;
    return [(y - b.minY) / (b.maxY - b.minY) * map.img.naturalWidth, (x - b.minX) / (b.maxX - b.minX) * map.img.naturalHeight];
  }
  const fmt = (n) => Math.round(n).toLocaleString('en-US');

  let mapKey = '';
  function renderMap() {
    const box = $('w-map');
    const cls = `map ${settings.shape}`;
    if (box.className !== cls) box.className = cls;
    const canvas = $('map-canvas');
    const cw = canvas.clientWidth; const ch = canvas.clientHeight;
    const g = preview() ? SAMPLE_GAME : game;
    const dino = g && g.dino;
    const pos = dino && dino.position;
    // Standing still, nothing new around: the last picture is still right.
    // (Half a metre / two degrees is below what the mini map can show.)
    const key = preview() ? '' : JSON.stringify([
      cw, ch, settings, Boolean(map.data),
      pos ? [Math.round(pos.x / 50), Math.round(pos.y / 50), Math.round((pos.yaw ?? 0) / 2)] : null,
      g && g.target, (g && g.ai || []).map((a) => [Math.round(a.x / 100), Math.round(a.y / 100)]),
      dino && dino.trail ? dino.trail.length : 0,
    ]);
    if (key !== '' && key === mapKey) return;
    mapKey = key;
    $('map-none').hidden = Boolean(map.data && pos);
    if (!map.data) { $('map-none').textContent = 'Đang tải bản đồ…'; return; }
    if (!pos) { $('map-none').textContent = 'Vào game để thấy vị trí'; }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = `rgba(7,9,14,${Math.max(0.35, settings.bg / 100)})`;
    ctx.fillRect(0, 0, cw, ch);
    if (!pos) return;
    const b = map.data.bounds;
    const pxPerUnit = map.img.naturalWidth / (b.maxY - b.minY);
    // radius (m) → map units: 1 m = 100 world units = 0.1 map unit.
    const s = (Math.min(cw, ch) / 2) / (settings.radius / 10 * pxPerUnit);
    const [ix, iy] = toImg(unitsOf(pos));
    const yaw = typeof pos.yaw === 'number' ? pos.yaw * Math.PI / 180 : null;
    const turn = settings.rotate === 'heading' && yaw !== null ? -Math.PI / 2 - yaw : 0;
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate(turn);
    ctx.scale(s, s);
    ctx.translate(-ix, -iy);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(map.img, 0, 0);
    const lw = (px) => px / s;           // line widths in screen pixels
    const show = settings.show;
    for (const f of map.data.features) {
      if (show.zones && ZONES[f.layer] && f.kind !== 'label') {
        ctx.beginPath();
        if (f.kind === 'circle') {
          const [cx, cy] = toImg(f.at);
          ctx.ellipse(cx, cy, f.r[1] * pxPerUnit, f.r[0] * pxPerUnit, (f.rot ?? 0) * Math.PI / 180, 0, Math.PI * 2);
        } else if (f.pts) {
          for (const ringPts of f.pts) ringPts.forEach((p, i) => { const [x, y] = toImg(p); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
          if (f.kind === 'poly') ctx.closePath();
        }
        ctx.fillStyle = `${ZONES[f.layer]}26`; if (f.kind !== 'path') ctx.fill();
        ctx.lineWidth = lw(1.5); ctx.strokeStyle = `${ZONES[f.layer]}e6`; ctx.stroke();
      }
      const pc = POINTS[f.layer];
      if (pc && f.kind === 'point' && ((f.layer === 'water' && show.water) || (f.layer === 'landmark' && show.landmarks))) {
        const [x, y] = toImg(f.at);
        ctx.beginPath(); ctx.arc(x, y, lw(3), 0, Math.PI * 2); ctx.fillStyle = pc; ctx.fill();
      }
    }
    if (show.trail && Array.isArray(dino.trail) && dino.trail.length) {
      ctx.beginPath();
      dino.trail.forEach((p, i) => { const [x, y] = toImg(unitsOf(p)); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.lineTo(ix, iy);
      ctx.lineWidth = lw(2.5); ctx.strokeStyle = '#34d399'; ctx.setLineDash([lw(5), lw(4)]); ctx.stroke(); ctx.setLineDash([]);
    }
    if (show.ai && Array.isArray(g.ai)) {
      for (const a of g.ai) {
        const [x, y] = toImg(unitsOf(a));
        ctx.beginPath(); ctx.arc(x, y, lw(3.5), 0, Math.PI * 2); ctx.fillStyle = '#ef4444'; ctx.fill();
        ctx.lineWidth = lw(1); ctx.strokeStyle = 'rgba(2,6,23,.9)'; ctx.stroke();
      }
    }
    ctx.restore();
    // Labels upright, whatever the rotation.
    if (show.labels) {
      ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const f of map.data.features) {
        if (f.kind !== 'label' || !(f.layer === 'area' || (f.layer === 'landmark' && show.landmarks) || (f.layer === 'water' && show.water))) continue;
        const [x0, y0] = toImg(f.at);
        const dx = (x0 - ix) * s; const dy = (y0 - iy) * s;
        const x = cw / 2 + dx * Math.cos(turn) - dy * Math.sin(turn);
        const y = ch / 2 + dx * Math.sin(turn) + dy * Math.cos(turn);
        if (x < 0 || y < 0 || x > cw || y > ch) continue;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(2,6,23,.8)'; ctx.strokeText(f.text, x, y);
        ctx.fillStyle = '#f1f5f9'; ctx.fillText(f.text, x, y);
      }
    }
    // The point set on the launcher's map: a line from you straight at it; at
    // the edge of the mini map an arrow when it is further than the map shows.
    const tg = g.target;
    $('map-tgt').hidden = !(show.target && tg);
    if (show.target && tg) drawTarget(ctx, tg, pos, { ix, iy, s, turn, cw, ch, yaw });
    // You: the heading triangle, always at the centre.
    const cx = cw / 2; const cy = ch / 2;
    const a = yaw === null ? -Math.PI / 2 : yaw + turn;
    const dx = Math.cos(a); const dy = Math.sin(a); const nx = -dy; const ny = dx;
    ctx.beginPath();
    ctx.moveTo(cx + dx * 12, cy + dy * 12);
    ctx.lineTo(cx - dx * 6 + nx * 7, cy - dy * 6 + ny * 7);
    ctx.lineTo(cx - dx * 6 - nx * 7, cy - dy * 6 - ny * 7);
    ctx.closePath();
    ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(2,6,23,.85)'; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#34d399'; ctx.fill();
    $('map-north').hidden = settings.rotate !== 'heading';
    if (!$('map-north').hidden) {
      // Where north (up the image) is once the map is turned.
      const r = Math.min(cw, ch) / 2 - 10;
      $('map-north').style.left = `${cw / 2 + Math.sin(turn) * r}px`;
      $('map-north').style.top = `${ch / 2 - Math.cos(turn) * r}px`;
      $('map-north').style.transform = 'translate(-50%, -50%)';
    }
    $('map-coords').hidden = !show.coords;
    $('map-coords').textContent = `${fmt(pos.y)}, ${fmt(pos.x)}`;
  }

  function drawTarget(ctx, tg, pos, v) {
    const [tix, tiy] = toImg(unitsOf(tg));
    const dx0 = (tix - v.ix) * v.s; const dy0 = (tiy - v.iy) * v.s;
    const cx = v.cw / 2; const cy = v.ch / 2;
    let x = cx + dx0 * Math.cos(v.turn) - dy0 * Math.sin(v.turn);
    let y = cy + dx0 * Math.sin(v.turn) + dy0 * Math.cos(v.turn);
    // Inside the visible map? (a circle, or the square, less a margin)
    const r = Math.min(v.cw, v.ch) / 2 - 12;
    const len = Math.hypot(x - cx, y - cy);
    const inside = settings.shape === 'circle' ? len <= r : Math.abs(x - cx) <= r && Math.abs(y - cy) <= r;
    if (!inside) {
      const k = settings.shape === 'circle' ? r / len : r / Math.max(Math.abs(x - cx), Math.abs(y - cy));
      x = cx + (x - cx) * k; y = cy + (y - cy) * k;
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y);
    ctx.strokeStyle = 'rgba(2,6,23,.75)'; ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2.5; ctx.setLineDash([7, 5]); ctx.stroke(); ctx.setLineDash([]);
    if (inside) {
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = '#facc15'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(2,6,23,.9)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fillStyle = '#1a1400'; ctx.fill();
    } else {
      // an arrow on the edge, pointing on towards it
      const a = Math.atan2(y - cy, x - cx);
      ctx.translate(x, y); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-7, -7); ctx.lineTo(-3, 0); ctx.lineTo(-7, 7); ctx.closePath();
      ctx.fillStyle = '#facc15'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(2,6,23,.9)'; ctx.stroke();
    }
    ctx.restore();
    // Distance, and which way to turn from where the dino faces.
    const m = Math.hypot(tg.x - pos.x, tg.y - pos.y) / 100;
    const dist = m >= 1000 ? `${(m / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`;
    let turnText = '';
    if (v.yaw !== null) {
      const rel = ((Math.atan2(tiy - v.iy, tix - v.ix) - v.yaw) * 180 / Math.PI + 540) % 360 - 180;
      turnText = Math.abs(rel) < 15 ? ' · thẳng phía trước' : Math.abs(rel) > 160 ? ' · quay lại phía sau'
        : ` · ${rel > 0 ? 'rẽ phải' : 'rẽ trái'} ${Math.round(Math.abs(rel))}°`;
    }
    const el = $('map-tgt');
    const here = m < 30;
    el.className = `tgt${here ? ' here' : ''}`;
    el.textContent = here ? `📍 ${tg.name || 'Điểm đến'} · đã tới nơi ✓` : `📍 ${tg.name || 'Điểm đến'} · ${dist}${turnText}`;
  }

  // --- dino ---------------------------------------------------------------------------------
  // Built once and updated in place: a rebuild every second would cut the
  // damage animation short.
  const VITALS = [
    ['health', 'Máu', '#ef4444'], ['stamina', 'Thể lực', '#facc15'], ['hunger', 'Đói', '#f97316'],
    ['thirst', 'Nước', '#38bdf8'], ['blood', 'Huyết', '#be123c'], ['oxygen', 'Oxy', '#22d3ee'],
  ];
  const dinoEl = {};
  function buildDino() {
    const el = $('dino');
    const head = document.createElement('div'); head.className = 'head';
    dinoEl.species = document.createElement('span'); dinoEl.species.className = 'sp-name';
    dinoEl.growth = document.createElement('span'); dinoEl.growth.className = 'sub';
    dinoEl.prime = document.createElement('span'); dinoEl.prime.className = 'prime';
    head.append(dinoEl.species, dinoEl.growth, dinoEl.prime);
    dinoEl.none = document.createElement('div'); dinoEl.none.className = 'sub'; dinoEl.none.textContent = 'Chưa có dino trong game';
    dinoEl.rows = {};
    const rows = VITALS.map(([k, label, color]) => {
      const row = document.createElement('div'); row.className = `bar b-${k}`;
      const l = document.createElement('span'); l.textContent = label;
      const t = document.createElement('span'); t.className = 'track';
      const ghost = document.createElement('i'); ghost.className = 'ghost';
      const fill = document.createElement('i'); fill.className = 'fill'; fill.style.background = color;
      t.append(ghost, fill);
      const v = document.createElement('span'); v.className = 'v';
      row.append(l, t, v);
      dinoEl.rows[k] = { row, fill, ghost, v };
      return row;
    });
    dinoEl.pops = document.createElement('div'); dinoEl.pops.className = 'pops';
    el.replaceChildren(head, ...rows, dinoEl.none, dinoEl.pops);
    dinoEl.head = head;
  }

  const fmtHp = (n) => Math.round(n).toLocaleString('vi-VN');
  function renderDino() {
    if (!dinoEl.rows) buildDino();
    const g = preview() ? SAMPLE_GAME : game;
    const d = g && g.dino;
    if ($('w-dino').className !== `wrap a-${settings.anchor}`) $('w-dino').className = `wrap a-${settings.anchor}`;
    if ($('dino').className !== `box dino l-${settings.layout}`) $('dino').className = `box dino l-${settings.layout}`;
    const show = settings.show;
    dinoEl.none.hidden = Boolean(d);
    dinoEl.head.hidden = !d;
    for (const k of Object.keys(dinoEl.rows)) dinoEl.rows[k].row.hidden = true;
    if (!d) return;
    dinoEl.species.hidden = !show.species;
    setText(dinoEl.species, d.species || 'Dino');
    dinoEl.growth.hidden = !(show.growth && typeof d.growth === 'number');
    if (typeof d.growth === 'number') setText(dinoEl.growth, `Growth ${(d.growth * 100).toFixed(1)}%`);
    const primeOn = show.prime && d.prime && (d.prime.isPrime || d.prime.eligible);
    dinoEl.prime.hidden = !primeOn;
    if (primeOn) setText(dinoEl.prime, d.prime.isPrime ? '👑 Prime' : '👑 Đủ điều kiện');
    for (const [k] of VITALS) {
      const r = dinoEl.rows[k];
      const v = d.vitals?.[k]; const m = d.max?.[k];
      if (!show[k] || typeof v !== 'number') continue;
      r.row.hidden = false;
      const pct = typeof m === 'number' && m > 0 ? Math.max(0, Math.min(1, v / m)) : null;
      setWidth(r.fill, `${Math.round((pct ?? 0) * 1000) / 10}%`);
      // Health: the real numbers too ("980 / 1.300 · 75%").
      if (k === 'health' && show.hpValue) {
        setText(r.v, pct === null ? fmtHp(v) : `${fmtHp(v)} / ${fmtHp(m)} · ${Math.round(pct * 100)}%`);
      } else {
        setText(r.v, pct === null ? String(Math.round(v)) : `${Math.round(pct * 100)}%`);
      }
    }
  }

  /**
   * Took damage: "−120" rises and fades, the health row flashes, and the
   * lost part of the bar stays lit a moment before it drains away.
   */
  let lastHp = null;
  const SAMPLE_HP = 980;
  let sampleTimers = [];
  function onHealth(d) {
    const hp = d && d.vitals && d.vitals.health;
    const max = d && d.max && d.max.health;
    const key = d ? `${d.species}` : null;
    if (typeof hp !== 'number') { lastHp = null; return; }
    const prev = lastHp;
    lastHp = { hp, max, key };
    // A new dino (respawn, another species, redeemed from the garage) is not a hit.
    if (!prev || prev.key !== key || !settings || !settings.show.damage || !settings.show.health) return;
    const lost = prev.hp - hp;
    if (lost < 1) return;
    if (!dinoEl.rows) buildDino();
    const r = dinoEl.rows.health;
    const m = typeof max === 'number' && max > 0 ? max : prev.max;
    if (typeof m === 'number' && m > 0) {
      // The chunk just lost, lit, then drained.
      r.ghost.style.transition = 'none';
      r.ghost.style.width = `${Math.max(0, Math.min(1, prev.hp / m)) * 100}%`;
      void r.ghost.offsetWidth;
      r.ghost.style.transition = 'width .6s ease-in .45s';
      r.ghost.style.width = `${Math.max(0, Math.min(1, hp / m)) * 100}%`;
    }
    r.row.classList.remove('hit');
    void r.row.offsetWidth;
    r.row.classList.add('hit');
    const pop = document.createElement('span');
    pop.className = 'dmg';
    pop.textContent = `−${fmtHp(lost)}`;
    // Big hits look big.
    const share = typeof m === 'number' && m > 0 ? lost / m : 0;
    pop.style.fontSize = `${1.15 + Math.min(0.9, share * 3)}em`;
    // Over the bar, not over the numbers next to it.
    pop.style.left = `${r.fill.parentElement.offsetLeft + r.fill.parentElement.offsetWidth * (0.2 + Math.random() * 0.4)}px`;
    pop.style.top = `${r.row.offsetTop + 4}px`;
    dinoEl.pops.append(pop);
    setTimeout(() => pop.remove(), 1400);
  }

  // --- quests (prime elder) ---------------------------------------------------------------------
  let questsKey = '';
  function renderQuests() {
    const g = preview() ? SAMPLE_GAME : game;
    const pb = g && g.dino && g.dino.prime;
    const key = preview() ? '' : JSON.stringify([settings, Boolean(g && g.dino), pb]);
    if (key !== '' && key === questsKey) return;
    questsKey = key;
    $('w-quests').className = `wrap a-${settings.anchor}`;
    const el = $('quests');
    if (!g || !g.dino) { el.textContent = 'Chưa có dino trong game'; return; }
    if (!pb) { el.textContent = 'Dino này chưa có nhiệm vụ Prime'; return; }
    const h = document.createElement('h3');
    const t = document.createElement('span'); t.textContent = '🏆 Nhiệm vụ Prime';
    const n = document.createElement('span'); n.className = pb.met >= 5 ? '' : 'gold'; n.textContent = pb.isPrime ? '👑 Prime' : `${pb.met}/5`;
    h.append(t, n);
    const ul = document.createElement('ul');
    for (const c of pb.conditions || []) {
      if (c.passive && !settings.show.passive) continue;
      if (c.met === true && settings.hideDone) continue;
      const li = document.createElement('li');
      li.className = c.met === true ? 'met' : c.met === null ? 'unk' : '';
      const m = document.createElement('span'); m.textContent = c.met === true ? '✓' : c.met === null ? '?' : '○';
      const l = document.createElement('span'); l.textContent = c.label;
      li.append(m, l);
      ul.append(li);
    }
    const parts = [h, ul];
    if (settings.show.deadline && typeof pb.growth === 'number') {
      const dl = document.createElement('div'); dl.className = 'dl';
      const tr = document.createElement('div'); tr.className = 'track';
      const i = document.createElement('i'); i.style.width = `${Math.min(100, pb.growth * 100)}%`;
      const mark = document.createElement('b'); mark.style.left = `${pb.deadline * 100}%`;
      tr.append(i, mark);
      const s = document.createElement('div'); s.className = 'sub';
      s.textContent = pb.locked ? `Đã qua mốc ${Math.round(pb.deadline * 100)}% — kết quả đã chốt`
        : `Growth ${(pb.growth * 100).toFixed(0)}% · chốt ở ${Math.round(pb.deadline * 100)}%`;
      dl.append(tr, s);
      parts.push(dl);
    }
    el.replaceChildren(...parts);
  }

  // --- all -----------------------------------------------------------------------------------------
  function render() {
    if (!settings) return;
    document.documentElement.style.setProperty('--scale', String(settings.scale / 100));
    document.documentElement.style.setProperty('--bg', `rgba(7, 9, 14, ${settings.bg / 100})`);
    $(`w-${W}`).hidden = false;
    $('edit').hidden = !settings.editing;
    setText($('size'), `${settings.scale}%`);
    // Edit mode shows the widgets that are off too, dimmed, with a switch.
    const off = !settings.enabled || !settings.overlayOn;
    document.body.classList.toggle('off', settings.editing && off);
    setText($('wname'), { voice: '🎙️', map: '🗺️', dino: '🦖', quests: '🏆' }[W] || '');
    setText($('toggle'), settings.enabled ? '✕ Tắt' : '＋ Bật');
    if ($('toggle').className !== (settings.enabled ? 'off' : 'on')) $('toggle').className = settings.enabled ? 'off' : 'on';
    $('toggle').title = settings.enabled ? 'Tắt khung này' : 'Bật khung này';
    setText($('hint'), settings.enabled
      ? 'Kéo để di chuyển · kéo mép / góc để phóng to, thu nhỏ · F9 để xong'
      : 'Khung này đang tắt — bấm ＋ Bật để hiện nó trong game');
    if (W === 'voice') renderVoice();
    else if (W === 'map') renderMap();
    else if (W === 'dino') renderDino();
    else if (W === 'quests') renderQuests();
  }

  window.overlay.onSettings((s) => { settings = s; render(); });
  window.overlay.onState((s) => { voice = s; if (W === 'voice') render(); });
  window.overlay.onGame((g) => {
    game = g;
    if (W === 'dino' && !preview()) onHealth(g && g.dino);
    if (W !== 'voice') render();
  });
  window.overlay.onMap((m) => {
    if (W !== 'map' || !m || !m.json) return;
    const img = new Image();
    img.onload = () => { map.data = m.json; map.img = img; render(); };
    img.src = URL.createObjectURL(new Blob([m.image], { type: m.type || 'image/webp' }));
  });
  window.overlay.onPreview((ms) => {
    previewUntil = Date.now() + ms;
    render();
    setTimeout(render, ms + 50);
    if (W === 'dino') {
      // Show off the damage effect on the sample dino: always from full, and
      // a new "Xem thử" cancels the hits of the previous one.
      for (const t of sampleTimers) clearTimeout(t);
      SAMPLE_GAME.dino.vitals.health = SAMPLE_HP;
      lastHp = null;
      onHealth(SAMPLE_GAME.dino);
      render();
      sampleTimers = [85, 240, 40].map((dmg, i) => setTimeout(() => {
        SAMPLE_GAME.dino.vitals.health = Math.max(0, SAMPLE_GAME.dino.vitals.health - dmg);
        onHealth(SAMPLE_GAME.dino);
        render();
      }, 900 + i * 1500));
      sampleTimers.push(setTimeout(() => { SAMPLE_GAME.dino.vitals.health = SAMPLE_HP; lastHp = null; render(); }, ms));
    }
  });
  window.addEventListener('resize', render);
  $('done').addEventListener('click', () => window.overlay.doneEditing());
  $('toggle').addEventListener('click', () => window.overlay.toggleWidget(W));
  // Move by dragging the frame: not the window manager's drag region (some
  // Linux desktops ignore it) — the launcher moves the window to follow the
  // real pointer, so it can be dropped anywhere, on any screen.
  let mv = false;
  let frame = 0;
  const editEl = $('edit');
  editEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target !== editEl && !e.target.classList.contains('hint')) return;
    e.preventDefault();
    editEl.setPointerCapture(e.pointerId);
    editEl.classList.add('moving');
    mv = true;
    window.overlay.drag(W, 'start');
  });
  editEl.addEventListener('pointermove', () => {
    if (!mv || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; if (mv) window.overlay.drag(W, 'move'); });
  });
  const stopMove = () => {
    if (!mv) return;
    mv = false;
    editEl.classList.remove('moving');
    window.overlay.drag(W, 'end');
  };
  editEl.addEventListener('pointerup', stopMove);
  editEl.addEventListener('pointercancel', stopMove);

  // Resize by dragging an edge or a corner: the launcher follows the real
  // pointer, keeps the proportions and the opposite side where it is.
  let rs = false;
  for (const h of document.querySelectorAll('.edit .h')) {
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      h.setPointerCapture(e.pointerId);
      rs = true;
      window.overlay.resize(W, 'start', h.dataset.dir);
    });
    h.addEventListener('pointermove', () => {
      if (!rs || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; if (rs) window.overlay.resize(W, 'move'); });
    });
    const end = () => { if (!rs) return; rs = false; window.overlay.resize(W, 'end'); };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && settings && settings.editing) window.overlay.doneEditing(); });
})();
