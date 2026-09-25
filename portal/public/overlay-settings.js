'use strict';
/*
 * "Overlay trong game" card in the voice tab. The overlay is Xóm Gáy
 * Launcher's (launcher/src/overlay.js): four widgets — voice, mini map, dino
 * numbers, prime quests — each its own small window. This page only edits
 * their settings through window.isleLauncher. In a browser the card just
 * says to get the launcher.
 */
(() => {
  const L = window.isleLauncher;
  const $ = (id) => document.getElementById(id);
  if (!$('ov-app')) return;
  if (!L || !L.overlayGet) return;          // the web: the "download the launcher" note stays
  const got = L.overlayGet();
  if (!got || !got.settings || !got.settings.widgets) return;
  $('ov-web').hidden = true;
  $('ov-app').hidden = false;

  let all = got.settings;
  let current = 'voice';
  let editing = got.editing;
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const WIDGETS = [
    ['voice', '🎙️ Voice'],
    ['map', '🗺️ Mini map'],
    ['dino', '🦖 Thông số dino'],
    ['quests', '🏆 Nhiệm vụ'],
  ];
  const SHOW = {
    voice: [['speakers', 'Người đang nói gần bạn'], ['direction', 'Hướng & khoảng cách (trái / phải, gần / xa)'], ['self', 'Mic của bạn (đang nói / im lặng / tắt)'],
      ['range', 'Tầm giọng hiện tại'], ['toasts', 'Thông báo khi đổi tầm giọng'], ['warnings', 'Cảnh báo (chưa vào game, mất kết nối)']],
    map: [['target', 'Đường tới điểm đến (bấm vào tab Bản đồ để đặt)'], ['ai', 'AI đang sống quanh bạn'], ['trail', 'Vệt đường bạn vừa đi'], ['zones', 'Vùng di cư / sanctuary / tuần tra'], ['water', 'Nguồn nước'],
      ['landmarks', 'Địa danh'], ['labels', 'Tên địa điểm'], ['coords', 'Toạ độ của bạn']],
    dino: [['species', 'Loài'], ['growth', 'Growth %'], ['health', 'Máu'], ['hpValue', 'Số máu cụ thể (980 / 1.300 · 75%)'],
      ['damage', 'Hiệu ứng khi mất máu (−120 bay lên, thanh máu nháy)'], ['stamina', 'Thể lực'], ['hunger', 'Đói'], ['thirst', 'Nước'],
      ['blood', 'Huyết'], ['oxygen', 'Oxy'], ['prime', 'Huy hiệu Prime']],
    quests: [['deadline', 'Thanh growth tới mốc chốt Prime (75%)'], ['passive', 'Cả điều kiện bị động (không bị vô sinh, loài nhỏ…)']],
  };
  const NOTE = {
    voice: 'Ai đang nói gần bạn, mic và tầm giọng của bạn. Hiện khi bạn đã vào kênh voice.',
    map: 'Bản đồ nhỏ quanh dino của bạn: vị trí, hướng, vệt đường, AI và các vùng. Hiện khi bạn có dino trong game.',
    dino: 'Máu (cả số cụ thể), thể lực, đói, nước… của dino đang chơi, cập nhật mỗi giây. Mỗi lần mất máu hiện số máu bị trừ.',
    quests: 'Các điều kiện Prime Elder: đã xong ✓, chưa xong ○, chưa rõ ?. Cần xong 5 trước khi growth tới 75%.',
  };

  const seg = (key, options, value) => `<div class="v-seg" role="group">${options.map(([v, label]) =>
    `<button type="button" data-choice="${key}" data-value="${esc(v)}" aria-pressed="${String(v) === String(value)}">${esc(label)}</button>`).join('')}</div>`;
  const slider = (key, label, min, max, step, value, unit) => `<label class="v-field">${esc(label)} <output>${value}${unit}</output>
    <input type="range" data-num="${key}" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;

  function tabs() {
    $('ov-tabs').innerHTML = WIDGETS.map(([id, label]) =>
      `<button type="button" role="tab" data-tab="${id}" aria-selected="${id === current}"><span class="st${all.widgets[id].enabled ? ' on' : ''}" title="${all.widgets[id].enabled ? 'đang bật' : 'đang tắt'}"></span>${label}</button>`).join('');
  }

  function panel() {
    const w = all.widgets[current];
    let specific = '';
    if (current === 'voice') {
      specific = `<div class="v-subhead">Kiểu hiển thị</div>${seg('style', [['full', 'Đầy đủ'], ['compact', 'Gọn'], ['minimal', 'Tối giản']], w.style)}
        <div class="v-subhead">Khi không ai nói</div>${seg('autoHide', [['idle', 'Ẩn khung'], ['never', 'Luôn hiện']], w.autoHide)}
        ${slider('maxSpeakers', 'Hiện tối đa (người)', 1, 10, 1, w.maxSpeakers, '')}`;
    } else if (current === 'map') {
      specific = `<div class="v-subhead">Tầm nhìn quanh dino</div>${seg('radius', [[150, '150 m'], [300, '300 m'], [500, '500 m'], [1000, '1 km'], [2000, '2 km']], w.radius)}
        <div class="v-subhead">Hình dạng</div>${seg('shape', [['circle', 'Tròn'], ['square', 'Vuông']], w.shape)}
        <div class="v-subhead">Hướng bản đồ</div>${seg('rotate', [['north', 'Bắc luôn ở trên'], ['heading', 'Xoay theo hướng dino']], w.rotate)}`;
    } else if (current === 'dino') {
      specific = `<div class="v-subhead">Cách hiện</div>${seg('layout', [['bars', 'Thanh + %'], ['numbers', 'Chỉ số %']], w.layout)}`;
    } else if (current === 'quests') {
      specific = `<label class="ov-switch" style="margin-top:10px"><input type="checkbox" data-bool="hideDone"${w.hideDone ? ' checked' : ''}><span>Ẩn nhiệm vụ đã xong</span></label>`;
    }
    $('ov-panel').innerHTML = `
      <div class="ov-panel-head">
        <label class="ov-switch"><input type="checkbox" data-bool="enabled"${w.enabled ? ' checked' : ''}><span>Hiện khung ${esc(WIDGETS.find(([id]) => id === current)[1])}</span></label>
        <button type="button" class="btn btn-ghost" data-act="reset">Khôi phục mặc định khung này</button>
      </div>
      <p class="v-note" style="margin-top:0">${esc(NOTE[current])}</p>
      <div class="ov-grid">
        <div class="ov-block">
          ${slider('scale', 'Kích thước (hoặc kéo mép khung ở trên)', 50, 250, 5, w.scale, '%')}
          ${slider('bg', 'Độ đậm nền', 0, 100, 5, w.bg, '%')}
          ${slider('opacity', 'Độ rõ toàn khung', 30, 100, 5, w.opacity, '%')}
        </div>
        <div class="ov-block">${specific}</div>
      </div>
      <div class="v-subhead" style="margin-top:14px">Hiện những gì</div>
      <div class="ov-checks">${SHOW[current].map(([k, label]) =>
        `<label><input type="checkbox" data-show="${k}"${w.show[k] ? ' checked' : ''}> ${esc(label)}</label>`).join('')}</div>`;
  }

  // --- the layout editor: your screens in small, a box per widget ----------------------------
  const LABEL = { voice: '🎙️ Voice', map: '🗺️ Mini map', dino: '🦖 Dino', quests: '🏆 Nhiệm vụ' };
  let lay = null;           // { displays, widgets, base } from the launcher
  let view = null;          // { minX, minY, k }: screen px → stage px
  let gesture = null;       // a drag in progress
  let frame = 0;

  function stage() {
    lay = L.overlayLayout();
    const el = $('ov-stage');
    if (!lay || !lay.displays.length) { el.innerHTML = ''; return; }
    const xs = lay.displays.flatMap((d) => [d.bounds.x, d.bounds.x + d.bounds.width]);
    const ys = lay.displays.flatMap((d) => [d.bounds.y, d.bounds.y + d.bounds.height]);
    const minX = Math.min(...xs); const minY = Math.min(...ys);
    const vw = Math.max(...xs) - minX; const vh = Math.max(...ys) - minY;
    // As wide as the card allows, at most 340 px tall.
    const width = Math.min(el.parentElement.clientWidth || 800, 900, 340 * vw / vh);
    el.style.width = `${width}px`;
    el.style.height = `${width * vh / vw}px`;
    view = { minX, minY, k: width / vw };
    const px = (v) => `${v * view.k}px`;
    const screens = lay.displays.map((d, i) =>
      `<div class="ov-screen" style="left:${px(d.bounds.x - minX)};top:${px(d.bounds.y - minY)};width:${px(d.bounds.width)};height:${px(d.bounds.height)}"><span>Màn hình ${i + 1}${d.id === 'primary' ? ' (chính)' : ''}</span></div>`).join('');
    const on = WIDGETS.filter(([id]) => all.enabled && lay.widgets[id].enabled);
    const boxes = on.map(([id]) => {
      const b = lay.widgets[id].bounds;
      return `<div class="ov-box${id === current ? ' sel' : ''}" data-box="${id}" style="left:${px(b.x - minX)};top:${px(b.y - minY)};width:${px(b.width)};height:${px(b.height)}">
        ${['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'].map((d) => `<i class="h ${d}" data-dir="${d}"></i>`).join('')}
        <span>${LABEL[id]}</span><small>${lay.widgets[id].scale}%</small></div>`;
    }).join('');
    el.innerHTML = screens + boxes + (on.length ? '' : `<div class="ov-empty">${all.enabled ? 'Bật một khung ở các tab bên dưới để đặt nó lên màn hình.' : 'Overlay đang tắt.'}</div>`);
  }

  $('ov-stage').addEventListener('pointerdown', (e) => {
    const box = e.target.closest('[data-box]');
    if (!box || !lay) return;
    e.preventDefault();
    const id = box.dataset.box;
    if (id !== current) { current = id; tabs(); panel(); for (const x of $('ov-stage').querySelectorAll('.ov-box')) x.classList.toggle('sel', x === box); }
    const b = lay.widgets[id].bounds;
    gesture = { id, box, dir: e.target.dataset.dir || null, sx: e.clientX, sy: e.clientY, x: b.x, y: b.y, w: b.width, h: b.height, scale: lay.widgets[id].scale, out: null };
    box.classList.add('drag');
    box.setPointerCapture(e.pointerId);
  });
  $('ov-stage').addEventListener('pointermove', (e) => {
    const g = gesture;
    if (!g || !view) return;
    const dx = (e.clientX - g.sx) / view.k; const dy = (e.clientY - g.sy) / view.k;
    let x = g.x; let y = g.y; let scale = g.scale; let w = g.w; let h = g.h;
    if (g.dir === null) {
      x = g.x + dx; y = g.y + dy;
      // Snap to screen edges (12 px on the real screen).
      for (const d of lay.displays) {
        const B = d.bounds;
        for (const [edge, pos] of [[B.x, x], [B.x + B.width - w, x]]) if (Math.abs(pos - edge) < 12) x = edge;
        for (const [edge, pos] of [[B.y, y], [B.y + B.height - h, y]]) if (Math.abs(pos - edge) < 12) y = edge;
      }
    } else {
      const kx = g.dir.includes('e') ? (g.w + dx) / g.w : g.dir.includes('w') ? (g.w - dx) / g.w : null;
      const ky = g.dir.includes('s') ? (g.h + dy) / g.h : g.dir.includes('n') ? (g.h - dy) / g.h : null;
      let k = kx ?? ky;
      if (kx !== null && ky !== null) k = Math.abs(kx - 1) > Math.abs(ky - 1) ? kx : ky;
      scale = Math.max(50, Math.min(250, Math.round(g.scale * k)));
      const f = scale / g.scale;
      w = g.w * f; h = g.h * f;
      if (g.dir.includes('w')) x = g.x + g.w - w;
      if (g.dir.includes('n')) y = g.y + g.h - h;
    }
    Object.assign(g.box.style, {
      left: `${(x - view.minX) * view.k}px`, top: `${(y - view.minY) * view.k}px`,
      width: `${w * view.k}px`, height: `${h * view.k}px`,
    });
    g.box.querySelector('small').textContent = `${scale}%`;
    g.out = { x: Math.round(x), y: Math.round(y), scale };
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (gesture && gesture.out) L.overlayPlace(gesture.id, gesture.out); });
  });
  const endGesture = () => {
    const g = gesture;
    if (!g) return;
    gesture = null;
    if (g.out) L.overlayPlace(g.id, g.out);
    // Where it really landed (kept on a screen), and the saved settings.
    setTimeout(() => { const got2 = L.overlayGet(); if (got2) all = got2.settings; stage(); panel(); }, 120);
  };
  $('ov-stage').addEventListener('pointerup', endGesture);
  $('ov-stage').addEventListener('pointercancel', endGesture);
  window.addEventListener('resize', () => { if (!gesture) stage(); });
  // The tab may be opened later: size the editor when it becomes visible.
  new ResizeObserver(() => { if (!gesture) stage(); }).observe($('ov-app'));

  // Game mode: which widgets stay while playing.
  function renderGameMode() {
    const gm = L.gameModeGet ? L.gameModeGet() : null;
    const box = $('ov-gm-keep');
    if (!gm || !box) { if (box) box.closest('.ov-gm').hidden = true; return; }
    box.innerHTML = WIDGETS.map(([id, label]) =>
      `<label><input type="checkbox" data-keep="${id}"${gm.keep[id] ? ' checked' : ''}> ${esc(label)}</label>`).join('');
  }
  if ($('ov-gm-keep')) {
    $('ov-gm-keep').addEventListener('change', (e) => {
      const id = e.target.dataset.keep;
      if (id) L.gameModeKeep({ [id]: e.target.checked });
    });
    window.addEventListener('isle-gamemode', renderGameMode);
  }

  function render() {
    renderGameMode();
    $('ov-enabled').checked = all.enabled;
    if (!gesture) stage();
    $('ov-key-name').textContent = L.keyLabel('overlay');
    $('ov-edit-key-name').textContent = L.keyLabel('edit');
    $('ov-drag').textContent = editing ? `✓ Xong chỉnh (${L.keyLabel('edit')})` : `✥ Chỉnh trên màn hình (${L.keyLabel('edit')})`;
    tabs();
    panel();
  }

  /** Send a change for the current widget; sliders call this while dragging, so the overlay moves live. */
  let pending = null;
  let timer = null;
  function change(patch) {
    const w = all.widgets[current];
    all.widgets[current] = { ...w, ...patch, show: { ...w.show, ...(patch.show || {}) } };
    pending = { widget: current, ...(pending && pending.widget === current ? pending : {}), ...patch,
      show: { ...((pending && pending.widget === current && pending.show) || {}), ...(patch.show || {}) } };
    if (timer !== null) return;
    timer = setTimeout(async () => {
      timer = null;
      const p = pending; pending = null;
      const saved = await L.overlaySet(p);
      if (saved && pending === null) { all = saved; if (!document.activeElement?.matches('input[type=range]')) render(); }
    }, 80);
  }

  $('ov-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    current = b.dataset.tab;
    render();
  });
  // Sliders change the size: keep the picture in step.
  $('ov-panel').addEventListener('change', () => setTimeout(stage, 150));
  $('ov-panel').addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.num) {
      t.previousElementSibling.textContent = `${t.value}${t.dataset.num === 'scale' || t.dataset.num === 'bg' || t.dataset.num === 'opacity' ? '%' : t.dataset.num.startsWith('offset') ? ' px' : ''}`;
      change({ [t.dataset.num]: Number(t.value) });
    }
  });
  $('ov-panel').addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.bool) { change({ [t.dataset.bool]: t.checked }); if (t.dataset.bool === 'enabled') setTimeout(tabs, 150); }
    else if (t.dataset.show) change({ show: { [t.dataset.show]: t.checked } });
    else if (t.dataset.num) render();
  });
  $('ov-panel').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.choice) {
      const v = b.dataset.value;
      change({ [b.dataset.choice]: /^\d+$/.test(v) ? Number(v) : v });
      setTimeout(render, 150);
    } else if (b.dataset.act === 'reset') {
      all = await L.overlaySet({ widget: current, reset: true });
      render();
    }
  });
  $('ov-enabled').addEventListener('change', async (e) => { all = await L.overlaySet({ enabled: e.target.checked }); render(); });
  $('ov-preview').addEventListener('click', () => L.overlayPreview());
  $('ov-drag').addEventListener('click', () => {
    editing = !editing;
    L.overlayEdit(editing);
    render();
  });
  L.onOverlayChanged((saved) => {
    if (saved && saved.widgets) all = saved;
    // Dragging on screen keeps edit mode on; "Xong" there turns it off.
    const g = L.overlayGet();
    editing = Boolean(g && g.editing);
    if (!gesture) render();
  });
  $('ov-key').addEventListener('click', async () => {
    $('ov-key-name').textContent = 'bấm một phím hoặc nút chuột…';
    await L.captureKey('overlay');
    render();
  });
  $('ov-edit-key').addEventListener('click', async () => {
    $('ov-edit-key-name').textContent = 'bấm một phím hoặc nút chuột…';
    await L.captureKey('edit');
    render();
  });
  render();
})();
