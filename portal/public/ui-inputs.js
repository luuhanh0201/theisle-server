/*
 * ui-inputs.js, the system's number and date / time inputs (rule: AGENTS.md
 * "UI"), on every page: the admin panel (bridge serves it from the portal), the
 * portal, the launcher's pages. Load it as a classic script before the page's
 * own code, after ui-select.js:
 *   <script src="/ui-inputs.js"></script>
 * Its look follows the page's colour tokens, with fallbacks.
 */
(() => {
  if (window.__uiInputs) return;
  window.__uiInputs = true;
  const style = document.createElement('style');
  style.id = 'ui-inputs-css';
  style.textContent = `/* Form controls (see the "Form controls" script): number inputs get − / + ,
   date / time inputs a calendar; the native input stays for its value and events. */
.nf { display: flex; align-items: stretch; width: 100%; min-width: 0; border: 1px solid var(--border-strong, var(--border-light, rgba(255,255,255,.14))); border-radius: 10px;
  background: var(--surface-2, var(--bg-surface, #0e1526)); transition: border-color .15s, box-shadow .15s; }
.nf:focus-within { border-color: var(--accent, var(--emerald, #10b981)); box-shadow: 0 0 0 3px var(--accent-soft, var(--emerald-soft, rgba(16,185,129,.14))); }
.nf.disabled { opacity: .5; }
.nf > input[type=number] { border: 0 !important; box-shadow: none !important; background: none; min-width: 0; flex: 1; width: 100% !important;
  text-align: center; padding-left: 4px; padding-right: 4px; font-variant-numeric: tabular-nums; -moz-appearance: textfield; }
.nf > input[type=number]::-webkit-inner-spin-button, .nf > input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.nf-b { flex: none; width: 30px; border: 0; background: none; color: var(--muted, var(--text-muted, #8b9bb4)); cursor: pointer; font: inherit; font-size: 16px; font-weight: 700;
  display: grid; place-items: center; user-select: none; touch-action: manipulation; }
.nf-b:first-child { border-right: 1px solid var(--border, rgba(255,255,255,.08)); border-radius: 9px 0 0 9px; }
.nf-b:last-child { border-left: 1px solid var(--border, rgba(255,255,255,.08)); border-radius: 0 9px 9px 0; }
.nf-b:hover:not(:disabled) { color: var(--accent, var(--emerald, #10b981)); background: var(--accent-soft, var(--emerald-soft, rgba(16,185,129,.14))); }
.nf-b:disabled { opacity: .35; cursor: not-allowed; }
input.dt-native { display: none !important; }
.dt-btn { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; padding: 9px 12px; text-align: left;
  border: 1px solid var(--border-strong, var(--border-light, rgba(255,255,255,.14))); border-radius: 10px; background: var(--surface-2, var(--bg-surface, #0e1526)); color: var(--text, #f1f5f9);
  font: inherit; font-size: 13.5px; cursor: pointer; font-variant-numeric: tabular-nums; }
.dt-btn:hover:not(:disabled) { border-color: color-mix(in srgb, var(--accent, var(--emerald, #10b981)) 45%, var(--border-strong, var(--border-light, rgba(255,255,255,.14)))); }
.dt-btn:focus-visible, .dt-btn[aria-expanded="true"] { outline: none; border-color: var(--accent, var(--emerald, #10b981)); box-shadow: 0 0 0 3px var(--accent-soft, var(--emerald-soft, rgba(16,185,129,.14))); }
.dt-btn:disabled { opacity: .5; cursor: not-allowed; }
.dt-btn .dt-val { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dt-btn .dt-val.ph { color: var(--muted, var(--text-muted, #8b9bb4)); }
.dt-btn svg { flex: none; width: 15px; height: 15px; color: var(--muted, var(--text-muted, #8b9bb4)); }
.dt-pop { position: fixed; z-index: 1000; width: 296px; max-width: calc(100vw - 16px); background: var(--surface, var(--bg-card, #0c1220)); color: var(--text, #f1f5f9);
  border: 1px solid var(--border-strong, var(--border-light, rgba(255,255,255,.14))); border-radius: 14px; box-shadow: 0 12px 32px rgba(15, 23, 42, .22); padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.dt-pop[hidden] { display: none; }
.dt-head { display: flex; align-items: center; gap: 6px; }
.dt-head b { flex: 1; text-align: center; font-size: 14px; text-transform: capitalize; }
.dt-nav { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--border, rgba(255,255,255,.08)); background: var(--surface-2, var(--bg-surface, #0e1526)); color: var(--text, #f1f5f9); cursor: pointer; font-size: 15px; }
.dt-nav:hover { border-color: var(--accent, var(--emerald, #10b981)); color: var(--accent, var(--emerald, #10b981)); }
.dt-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.dt-grid .dow { font-size: 11px; font-weight: 700; color: var(--muted, var(--text-muted, #8b9bb4)); text-align: center; padding: 2px 0 4px; }
.dt-day { height: 34px; border: 0; border-radius: 8px; background: none; color: var(--text, #f1f5f9); font: inherit; font-size: 13px; cursor: pointer; font-variant-numeric: tabular-nums; }
.dt-day:hover:not(:disabled) { background: var(--accent-soft, var(--emerald-soft, rgba(16,185,129,.14))); }
.dt-day.out { color: var(--muted, var(--text-muted, #8b9bb4)); opacity: .55; }
.dt-day.today { box-shadow: inset 0 0 0 1px var(--accent, var(--emerald, #10b981)); }
.dt-day.on { background: var(--accent, var(--emerald, #10b981)); color: #fff; font-weight: 700; }
.dt-day:disabled { opacity: .25; cursor: not-allowed; }
.dt-time { display: flex; align-items: center; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border, rgba(255,255,255,.08)); flex-wrap: wrap; }
.dt-time .lbl { font-size: 12px; color: var(--muted, var(--text-muted, #8b9bb4)); font-weight: 650; }
.dt-time .nf { width: 96px; }
.dt-time .colon { font-weight: 800; }
.dt-quick { display: flex; gap: 4px; flex-wrap: wrap; }
.dt-quick button, .dt-foot button { border: 1px solid var(--border, rgba(255,255,255,.08)); background: var(--surface-2, var(--bg-surface, #0e1526)); color: var(--text-2, var(--text-muted, #cbd5e1)); border-radius: 999px; padding: 4px 10px;
  font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; }
.dt-quick button:hover, .dt-foot button:hover { border-color: var(--accent, var(--emerald, #10b981)); color: var(--accent, var(--emerald, #10b981)); }
.dt-foot { display: flex; gap: 6px; justify-content: flex-end; }
.dt-foot .ok { background: var(--accent, var(--emerald, #10b981)); border-color: var(--accent, var(--emerald, #10b981)); color: #fff; }
.dt-foot .ok:hover { color: #fff; filter: brightness(1.08); }
/* never too narrow for its number: a label that shrinks to its content would leave the input 0 px */
.nf { min-width: 96px; }
.nf > input[type=number] { min-width: 34px; }
/* inside the box: the page's own input look is not wanted */
.nf > input[type=number] { color: var(--text, #f1f5f9); font: inherit; font-size: 13.5px; padding-top: 8px; padding-bottom: 8px; outline: none; }
.dt-time .nf > input[type=number] { padding-top: 5px; padding-bottom: 5px; }
`;
  (document.head || document.documentElement).append(style);
})();
/*
 * Form controls, the panel's own number and date / time inputs, on every
 * <input type=number|date|time|datetime-local> (in the HTML and built later),
 * the way "Custom select" above does selects. The native input stays the truth:
 * code keeps reading and writing input.value / min / max / disabled / hidden,
 * and a change here sets it and fires its input + change events.
 *
 *  number   − / + either side (hold to repeat; step, min, max), the native
 *           spinner gone, the mouse wheel no longer changes a focused number.
 *  date / time / datetime-local   a button with the value (dd/mm/yyyy hh:mm)
 *           opening a calendar (week from Monday) with hour / minute and quick
 *           picks; Esc / outside click closes, "Xong" keeps.
 * An input with data-plain is left alone.
 */
(() => {
  const pad = (n) => String(n).padStart(2, '0');
  const fire = (el) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const inputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

  // --- number ------------------------------------------------------------
  const decimals = (x) => { const s = String(x); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
  function nudge(inp, dir) {
    if (inp.disabled || inp.readOnly) return;
    const step = Number(inp.step) > 0 ? Number(inp.step) : 1;
    const min = inp.min === '' ? -Infinity : Number(inp.min), max = inp.max === '' ? Infinity : Number(inp.max);
    const cur = inp.value === '' ? (Number.isFinite(min) && dir > 0 ? min - step : 0) : Number(inp.value);
    if (!Number.isFinite(cur)) return;
    const next = Math.min(max, Math.max(min, cur + dir * step));
    const dp = Math.max(decimals(step), decimals(inp.min || 0));
    inp.value = next.toFixed(dp).replace(/\.?0+$/, (m) => (dp > 0 ? m : '')) || '0';
    if (dp > 0) inp.value = String(Number(next.toFixed(dp)));
    fire(inp);
  }
  function numberBox(inp) {
    if (inp.closest('.nf') || inp.hasAttribute('data-plain')) return;
    const box = document.createElement('span');
    box.className = 'nf';
    // An inline width belongs to the box now.
    for (const k of ['width', 'maxWidth', 'minWidth', 'flex']) if (inp.style[k]) { box.style[k] = inp.style[k]; inp.style[k] = ''; }
    // A width in px was the number's own: the two buttons get theirs on top.
    if (/^\d+px$/.test(box.style.width)) box.style.width = `${parseInt(box.style.width, 10) + 60}px`;
    const minus = document.createElement('button'), plus = document.createElement('button');
    minus.type = plus.type = 'button';
    minus.className = plus.className = 'nf-b';
    minus.textContent = '−'; plus.textContent = '+';
    minus.tabIndex = plus.tabIndex = -1;
    minus.setAttribute('aria-label', 'Giảm'); plus.setAttribute('aria-label', 'Tăng');
    inp.replaceWith(box);
    box.append(minus, inp, plus);
    const sync = () => {
      const v = Number(inp.value);
      box.classList.toggle('disabled', inp.disabled);
      box.hidden = inp.hidden;
      minus.disabled = inp.disabled || (inp.min !== '' && inp.value !== '' && v <= Number(inp.min));
      plus.disabled = inp.disabled || (inp.max !== '' && inp.value !== '' && v >= Number(inp.max));
    };
    for (const [b, dir] of [[minus, -1], [plus, 1]]) {
      let t = null;
      const stop = () => { clearTimeout(t); clearInterval(t); t = null; };
      b.addEventListener('pointerdown', (e) => {
        if (b.disabled || e.button !== 0) return;
        e.preventDefault();
        nudge(inp, dir); sync();
        t = setTimeout(() => { t = setInterval(() => { nudge(inp, dir); sync(); }, 70); }, 400);
      });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
    }
    inp.addEventListener('input', sync);
    inp.addEventListener('wheel', (e) => { if (document.activeElement === inp) e.preventDefault(); }, { passive: false });
    Object.defineProperty(inp, 'value', { configurable: true, get() { return inputValue.get.call(this); }, set(v) { inputValue.set.call(this, v); sync(); } });
    new MutationObserver(sync).observe(inp, { attributes: true, attributeFilter: ['disabled', 'hidden', 'min', 'max'] });
    sync();
  }

  // --- date / time ---------------------------------------------------------
  const ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3"/></svg>';
  const CLOCK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>';
  const DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  const btnOf = new WeakMap();
  /** The input's value as { y, m, d, h, mi } (missing parts null). */
  function parse(inp) {
    const v = inputValue.get.call(inp);
    const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(v), tm = /(?:^|T)(\d{2}):(\d{2})/.exec(v);
    return { y: dm ? +dm[1] : null, m: dm ? +dm[2] - 1 : null, d: dm ? +dm[3] : null, h: tm ? +tm[1] : null, mi: tm ? +tm[2] : null };
  }
  function shown(inp) {
    const p = parse(inp);
    const date = p.y !== null ? `${pad(p.d)}/${pad(p.m + 1)}/${p.y}` : '';
    const time = p.h !== null ? `${pad(p.h)}:${pad(p.mi)}` : '';
    if (inp.type === 'time') return time;
    if (inp.type === 'date') return date;
    return date && time ? `${date} ${time}` : '';
  }
  function sync(inp) {
    const b = btnOf.get(inp);
    if (!b) return;
    const txt = shown(inp);
    const val = b.querySelector('.dt-val');
    val.textContent = txt || (inp.placeholder || (inp.type === 'time' ? 'Chọn giờ' : inp.type === 'date' ? 'Chọn ngày' : 'Chọn ngày giờ'));
    val.classList.toggle('ph', !txt);
    b.disabled = inp.disabled;
    b.hidden = inp.hidden;
  }

  const pop = document.createElement('div');
  pop.className = 'dt-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  let open = null;   // { inp, view: {y, m}, pick: {y, m, d, h, mi} }

  function render() {
    const { inp, view, pick } = open;
    const hasDate = inp.type !== 'time', hasTime = inp.type !== 'date';
    const today = new Date();
    const minD = inp.min ? inp.min.slice(0, 10) : '', maxD = inp.max ? inp.max.slice(0, 10) : '';
    let html = '';
    if (hasDate) {
      const first = new Date(view.y, view.m, 1);
      const lead = (first.getDay() + 6) % 7;
      const title = first.toLocaleString('vi-VN', { month: 'long', year: 'numeric' });
      html += `<div class="dt-head"><button type="button" class="dt-nav" data-dt="prev" aria-label="Tháng trước">‹</button><b>${title}</b><button type="button" class="dt-nav" data-dt="next" aria-label="Tháng sau">›</button></div>`;
      html += '<div class="dt-grid">' + DOW.map((d) => `<span class="dow">${d}</span>`).join('');
      for (let i = 0; i < 42; i++) {
        const d = new Date(view.y, view.m, 1 - lead + i);
        const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const cls = ['dt-day', d.getMonth() !== view.m ? 'out' : '',
          d.toDateString() === today.toDateString() ? 'today' : '',
          pick.y === d.getFullYear() && pick.m === d.getMonth() && pick.d === d.getDate() ? 'on' : ''].filter(Boolean).join(' ');
        const off = (minD && key < minD) || (maxD && key > maxD);
        html += `<button type="button" class="${cls}" data-day="${key}"${off ? ' disabled' : ''}>${d.getDate()}</button>`;
      }
      html += '</div>';
    }
    if (hasTime) {
      html += `<div class="dt-time"><span class="lbl">Giờ</span>
        <span class="nf"><button type="button" class="nf-b" data-tm="h-">−</button><input type="number" data-plain data-tm-h min="0" max="23" value="${pick.h ?? 0}" inputmode="numeric"><button type="button" class="nf-b" data-tm="h+">+</button></span>
        <span class="colon">:</span>
        <span class="nf"><button type="button" class="nf-b" data-tm="m-">−</button><input type="number" data-plain data-tm-m min="0" max="59" step="5" value="${pad(pick.mi ?? 0)}" inputmode="numeric"><button type="button" class="nf-b" data-tm="m+">+</button></span>
        <div class="dt-quick">${['00:00', '06:00', '12:00', '18:00'].map((t) => `<button type="button" data-quick="${t}">${t}</button>`).join('')}</div></div>`;
    }
    html += `<div class="dt-foot">${hasDate ? '<button type="button" data-dt="today">Hôm nay</button>' : ''}<button type="button" data-dt="now">Bây giờ</button>
      ${inp.required ? '' : '<button type="button" data-dt="clear">Xoá</button>'}<span style="flex:1"></span><button type="button" class="ok" data-dt="ok">Xong</button></div>`;
    pop.innerHTML = html;
  }
  function commit() {
    const { inp, pick } = open;
    const date = `${pick.y}-${pad(pick.m + 1)}-${pad(pick.d)}`, time = `${pad(pick.h ?? 0)}:${pad(pick.mi ?? 0)}`;
    const v = inp.type === 'time' ? time : inp.type === 'date' ? date : `${date}T${time}`;
    if ((inp.type !== 'time' && pick.y === null)) return;
    if (inputValue.get.call(inp) !== v) { inputValue.set.call(inp, v); sync(inp); fire(inp); }
  }
  function place() {
    const r = btnOf.get(open.inp).getBoundingClientRect();
    const h = pop.offsetHeight, w = pop.offsetWidth;
    const below = window.innerHeight - r.bottom - 8;
    pop.style.top = `${below >= h || r.top < h ? Math.min(r.bottom + 4, window.innerHeight - h - 8) : r.top - h - 4}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  }
  function show(inp) {
    const p = parse(inp), now = new Date();
    const pick = { y: p.y, m: p.m, d: p.d, h: p.h ?? (inp.type === 'date' ? 0 : now.getHours()), mi: p.mi ?? 0 };
    if (inp.type === 'time' && pick.y === null) { pick.y = now.getFullYear(); pick.m = now.getMonth(); pick.d = now.getDate(); }
    open = { inp, pick, view: { y: p.y ?? now.getFullYear(), m: p.m ?? now.getMonth() } };
    // In a modal <dialog> (the top layer) the picker must be inside it, or it opens behind the dialog.
    const host = inp.closest('dialog[open]') ?? document.body;
    if (pop.parentElement !== host) host.append(pop);
    render();
    pop.hidden = false;
    btnOf.get(inp).setAttribute('aria-expanded', 'true');
    place();
  }
  function close(keep) {
    if (!open) return;
    if (keep) commit();
    btnOf.get(open.inp)?.setAttribute('aria-expanded', 'false');
    pop.hidden = true;
    open = null;
  }
  pop.addEventListener('click', (e) => {
    if (!open) return;
    const t = e.target;
    const day = t.closest('[data-day]');
    if (day && !day.disabled) {
      const [y, m, d] = day.dataset.day.split('-').map(Number);
      Object.assign(open.pick, { y, m: m - 1, d });
      open.view = { y, m: m - 1 };
      if (open.inp.type === 'date') { close(true); return; }
      render(); return;
    }
    const q = t.closest('[data-quick]');
    if (q) { const [h, mi] = q.dataset.quick.split(':').map(Number); Object.assign(open.pick, { h, mi }); render(); return; }
    const tm = t.closest('[data-tm]')?.dataset.tm;
    if (tm) {
      const p = open.pick;
      if (tm === 'h-') p.h = (p.h + 23) % 24; else if (tm === 'h+') p.h = (p.h + 1) % 24;
      else if (tm === 'm-') p.mi = (p.mi + 55) % 60 - ((p.mi + 55) % 60) % 5; else if (tm === 'm+') p.mi = (Math.floor(p.mi / 5) * 5 + 5) % 60;
      render(); return;
    }
    const act = t.closest('[data-dt]')?.dataset.dt;
    if (act === 'prev' || act === 'next') {
      const d = new Date(open.view.y, open.view.m + (act === 'next' ? 1 : -1), 1);
      open.view = { y: d.getFullYear(), m: d.getMonth() }; render(); place();
    } else if (act === 'today' || act === 'now') {
      const n = new Date();
      Object.assign(open.pick, { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() });
      if (act === 'now') Object.assign(open.pick, { h: n.getHours(), mi: n.getMinutes() });
      open.view = { y: n.getFullYear(), m: n.getMonth() };
      if (act === 'now' || open.inp.type === 'date') close(true); else render();
    } else if (act === 'clear') {
      const inp = open.inp; close(false);
      if (inputValue.get.call(inp) !== '') { inputValue.set.call(inp, ''); sync(inp); fire(inp); }
    } else if (act === 'ok') close(true);
  });
  pop.addEventListener('change', (e) => {
    if (!open) return;
    if (e.target.matches('[data-tm-h]')) open.pick.h = Math.min(23, Math.max(0, Math.floor(Number(e.target.value) || 0)));
    if (e.target.matches('[data-tm-m]')) open.pick.mi = Math.min(59, Math.max(0, Math.floor(Number(e.target.value) || 0)));
  });
  document.addEventListener('pointerdown', (e) => {
    if (open && !pop.contains(e.target) && !btnOf.get(open.inp)?.contains(e.target)) close(true);
  });
  document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') { e.preventDefault(); const b = btnOf.get(open.inp); close(false); b?.focus(); } });
  window.addEventListener('resize', () => { if (open) place(); });
  window.addEventListener('scroll', (e) => { if (open && !pop.contains(e.target)) place(); }, true);

  function dateBox(inp) {
    if (btnOf.has(inp) || inp.hasAttribute('data-plain')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dt-btn';
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
    if (inp.getAttribute('aria-label')) b.setAttribute('aria-label', inp.getAttribute('aria-label'));
    for (const k of ['width', 'maxWidth', 'minWidth', 'flex', 'marginTop']) if (inp.style[k]) b.style[k] = inp.style[k];
    if (b.style.width === 'auto') b.style.width = '';
    b.innerHTML = `${inp.type === 'time' ? CLOCK : ICON}<span class="dt-val"></span>`;
    inp.classList.add('dt-native');
    inp.after(b);
    btnOf.set(inp, b);
    b.addEventListener('click', () => (open?.inp === inp ? close(true) : (close(true), show(inp))));
    Object.defineProperty(inp, 'value', { configurable: true, get() { return inputValue.get.call(this); }, set(v) { inputValue.set.call(this, v); sync(this); } });
    new MutationObserver(() => sync(inp)).observe(inp, { attributes: true, attributeFilter: ['disabled', 'hidden', 'placeholder'] });
    inp.addEventListener('change', () => sync(inp));
    sync(inp);
  }
  // A <label for> of a hidden date input: send it to its button.
  document.addEventListener('click', (ev) => {
    const label = ev.target.closest?.('label[for]');
    const inp = label && document.getElementById(label.htmlFor);
    if (inp instanceof HTMLInputElement && btnOf.has(inp)) { ev.preventDefault(); btnOf.get(inp).click(); }
  });

  const DATEISH = new Set(['date', 'time', 'datetime-local']);
  const one = (el) => {
    if (!(el instanceof HTMLInputElement) || el.closest('.dt-pop')) return;
    if (el.type === 'number') numberBox(el);
    else if (DATEISH.has(el.type)) dateBox(el);
  };
  const scan = (root) => {
    if (root instanceof HTMLInputElement) one(root);
    else root.querySelectorAll?.('input[type=number], input[type=date], input[type=time], input[type=datetime-local]').forEach(one);
  };
  const start = () => {
    scan(document);
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
        if (open && !open.inp.isConnected) close(false);
      }
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
