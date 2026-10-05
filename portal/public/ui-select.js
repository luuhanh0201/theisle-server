/*
 * ui-select.js, the system's one select box (rule: AGENTS.md "UI"), on every
 * page: the admin panel (bridge serves it from the portal), the portal, the
 * launcher's pages. Load it as a classic script before the page's own code:
 *   <script src="/ui-select.js"></script>
 * Every <select>, in the HTML and built later, is shown with this button +
 * list instead of the browser's own; the native <select> stays (hidden) and
 * remains the truth. A <select data-plain> is left alone.
 * Its look follows the page's colour tokens (panel: --surface…, portal:
 * --bg-surface…), with fallbacks.
 */
(() => {
  if (window.__uiSelect) return;
  window.__uiSelect = true;
  const style = document.createElement('style');
  style.id = 'ui-select-css';
  style.textContent = `/* Custom select (see the "Custom select" script): the native <select> stays
   for its value and events, hidden; .cs-btn shows it, .cs-pop lists it. */
select.cs-native { display: none !important; }
.cs-btn {
  display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; padding: 9px 12px; text-align: left;
  border: 1px solid var(--border-strong, var(--border-light, rgba(255,255,255,.14))); border-radius: 10px; background: var(--surface-2, var(--bg-surface, #0e1526)); color: var(--text, #f1f5f9);
  font: inherit; font-size: 13.5px; font-weight: 500; line-height: 1.35; cursor: pointer; box-shadow: none;
}
.cs-btn:hover:not(:disabled) { border-color: color-mix(in srgb, var(--accent, var(--emerald, #10b981)) 45%, var(--border-strong, var(--border-light, rgba(255,255,255,.14)))); }
.cs-btn:focus-visible, .cs-btn[aria-expanded="true"] { outline: none; border-color: var(--accent, var(--emerald, #10b981)); box-shadow: 0 0 0 3px var(--accent-soft, var(--emerald-soft, rgba(16,185,129,.14))); }
.cs-btn:disabled { opacity: .5; cursor: not-allowed; }
.cs-btn.chosen { border-color: color-mix(in srgb, var(--grow, #34d399) 55%, transparent); }
.cs-btn .cs-val { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cs-btn .cs-val.ph { color: var(--muted, var(--text-muted, #8b9bb4)); }
.cs-btn .cs-arrow { flex: none; width: 14px; height: 14px; color: var(--muted, var(--text-muted, #8b9bb4)); transition: transform .15s; }
.cs-btn[aria-expanded="true"] .cs-arrow { transform: rotate(180deg); }
.cs-pop {
  position: fixed; z-index: 1000; display: flex; flex-direction: column; min-width: 220px; max-width: min(520px, calc(100vw - 16px));
  background: var(--surface, var(--bg-card, #0c1220)); color: var(--text, #f1f5f9); border: 1px solid var(--border-strong, var(--border-light, rgba(255,255,255,.14))); border-radius: 12px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, .18), 0 2px 6px rgba(15, 23, 42, .08); overflow: hidden;
}
.cs-pop[hidden] { display: none; }
.cs-search { margin: 6px 6px 0; padding: 7px 10px; font-size: 13px; border-radius: 8px; width: auto; }
.cs-list { overflow-y: auto; padding: 4px; overscroll-behavior: contain; }
.cs-group { padding: 8px 10px 4px; font-size: 11px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: var(--muted, var(--text-muted, #8b9bb4)); }
.cs-opt { display: flex; flex-direction: column; gap: 1px; padding: 7px 10px 7px 28px; border-radius: 8px; cursor: pointer; font-size: 13.5px; position: relative; }
.cs-opt.in-group { padding-left: 36px; }
.cs-opt .cs-sub { font-size: 11.5px; color: var(--muted, var(--text-muted, #8b9bb4)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cs-opt.active { background: var(--accent-soft, var(--emerald-soft, rgba(16,185,129,.14))); }
.cs-opt[aria-selected="true"] { font-weight: 650; color: var(--accent, var(--emerald, #10b981)); }
.cs-opt[aria-selected="true"]::before { content: ""; position: absolute; left: 10px; top: 11px; width: 10px; height: 6px;
  border-left: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(-45deg); }
.cs-opt.in-group[aria-selected="true"]::before { left: 18px; }
.cs-opt[aria-disabled="true"] { opacity: .45; cursor: not-allowed; }
.cs-empty { padding: 10px; font-size: 12.5px; color: var(--muted, var(--text-muted, #8b9bb4)); }
/* the search box: a plain input wherever this runs */
.cs-search { border: 1px solid var(--border-strong, var(--border-light, rgba(255,255,255,.14))); background: var(--surface-2, var(--bg-surface, #0e1526));
  color: var(--text, #f1f5f9); font: inherit; font-size: 13px; outline: none; }
.cs-search:focus { border-color: var(--accent, var(--emerald, #10b981)); }
`;
  (document.head || document.documentElement).append(style);
})();
/*
 * Custom select, every <select> on the page, the ones in the HTML and the
 * ones built later, is shown with the panel's own button + list instead of the
 * browser's. The native <select> stays (hidden) and remains the truth: the
 * code keeps reading and writing sel.value / innerHTML / disabled, and a pick
 * here sets it and fires its input + change events, so nothing else changes.
 *
 * Kept in step by: a MutationObserver (options rebuilt, disabled, class) and
 * sel.value / sel.selectedIndex wrapped per instance (set from code, no event).
 * One list popup, fixed to the viewport; a search box when there are many.
 * Keyboard: Enter / Space / arrows open; arrows, Home, End, type to jump,
 * Enter picks, Esc / Tab close.
 */
(() => {
  const SEARCH_FROM = 12;
  const proto = HTMLSelectElement.prototype;
  const valueDesc = Object.getOwnPropertyDescriptor(proto, 'value');
  const indexDesc = Object.getOwnPropertyDescriptor(proto, 'selectedIndex');
  const ARROW = '<svg class="cs-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
  const btnOf = new WeakMap();
  let uid = 0;

  const pop = document.createElement('div');
  pop.className = 'cs-pop';
  pop.hidden = true;
  pop.innerHTML = '<input class="cs-search" type="text" placeholder="Tìm…" autocomplete="off" spellcheck="false"><div class="cs-list" role="listbox"></div>';
  const search = pop.querySelector('.cs-search');
  const list = pop.querySelector('.cs-list');
  let open = null;            // { sel, btn, items: [{ el, opt }], active }
  let typed = '', typedAt = 0;

  function sync(sel) {
    const btn = btnOf.get(sel);
    if (!btn) return;
    const opt = sel.options[indexDesc.get.call(sel)];
    const val = btn.querySelector('.cs-val');
    val.textContent = opt ? opt.label || opt.textContent : '';
    val.classList.toggle('ph', !opt || opt.value === '');
    btn.title = opt?.title || val.textContent;
    btn.disabled = sel.disabled;
    btn.hidden = sel.hidden;
    for (const c of sel.classList) if (c !== 'cs-native') btn.classList.add(c);
    for (const c of [...btn.classList]) if (c !== 'cs-btn' && !sel.classList.contains(c)) btn.classList.remove(c);
    if (open?.sel === sel) render();
  }

  function enhance(sel) {
    if (btnOf.has(sel) || sel.multiple || sel.size > 1 || sel.hasAttribute('data-plain')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cs-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = `<span class="cs-val"></span>${ARROW}`;
    if (sel.id) {
      btn.id = `cs-${sel.id}`;
      const label = document.querySelector(`label[for="${CSS.escape(sel.id)}"]`);
      if (label) {
        if (!label.id) label.id = `cs-l${++uid}`;
        btn.setAttribute('aria-labelledby', label.id);
      }
    }
    btnOf.set(sel, btn);
    sel.classList.add('cs-native');
    sel.tabIndex = -1;
    sel.after(btn);
    Object.defineProperty(sel, 'value', { configurable: true, get() { return valueDesc.get.call(this); }, set(v) { valueDesc.set.call(this, v); sync(this); } });
    Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return indexDesc.get.call(this); }, set(v) { indexDesc.set.call(this, v); sync(this); } });
    sel.focus = () => btn.focus();
    new MutationObserver(() => sync(sel)).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'class', 'selected', 'label'] });
    btn.addEventListener('click', () => (open?.sel === sel ? close(true) : show(sel)));
    btn.addEventListener('keydown', (ev) => {
      if (open?.sel === sel) return keyNav(ev);
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key)) { ev.preventDefault(); show(sel); }
    });
    sync(sel);
  }

  function items() {
    const out = [];
    for (const node of open.sel.children) {
      if (node.tagName === 'OPTGROUP') {
        out.push({ group: node.label, disabled: node.disabled });
        for (const opt of node.children) if (opt.tagName === 'OPTION') out.push({ opt, inGroup: true, disabled: node.disabled || opt.disabled });
      } else if (node.tagName === 'OPTION') out.push({ opt: node, disabled: node.disabled });
    }
    return out;
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const all = items();
    const cur = indexDesc.get.call(open.sel);
    list.textContent = '';
    open.items = [];
    let pendingGroup = null;
    for (const it of all) {
      if (it.group !== undefined) { pendingGroup = it; continue; }
      if (!it.inGroup) pendingGroup = null;
      const text = it.opt.label || it.opt.textContent;
      if (q && !`${text} ${it.opt.title} ${it.opt.value}`.toLowerCase().includes(q)) continue;
      if (pendingGroup) {
        const g = document.createElement('div');
        g.className = 'cs-group';
        g.textContent = pendingGroup.group;
        g.setAttribute('role', 'presentation');
        list.append(g);
        pendingGroup = null;
      }
      const el = document.createElement('div');
      el.className = `cs-opt${it.inGroup ? ' in-group' : ''}`;
      el.id = `cs-o${++uid}`;
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', String(it.opt.index === cur));
      if (it.disabled) el.setAttribute('aria-disabled', 'true');
      const main = document.createElement('span');
      main.textContent = text;
      el.append(main);
      if (it.opt.title) {
        const sub = document.createElement('span');
        sub.className = 'cs-sub';
        sub.textContent = it.opt.title;
        el.append(sub);
        el.title = it.opt.title;
      }
      el.addEventListener('mousedown', (ev) => ev.preventDefault());
      el.addEventListener('click', () => { if (!it.disabled) pick(it.opt); });
      el.addEventListener('mousemove', () => setActive(open.items.findIndex((x) => x.el === el), false));
      list.append(el);
      open.items.push({ el, opt: it.opt, disabled: it.disabled });
    }
    if (!open.items.length) {
      const e = document.createElement('div');
      e.className = 'cs-empty';
      e.textContent = q ? 'Không tìm thấy' : 'Không có lựa chọn';
      list.append(e);
    }
    const selIdx = open.items.findIndex((x) => x.opt.index === cur);
    setActive(selIdx >= 0 ? selIdx : open.items.findIndex((x) => !x.disabled), true);
  }

  function setActive(i, scroll) {
    if (!open) return;
    open.items[open.active]?.el.classList.remove('active');
    open.active = i;
    const it = open.items[i];
    if (!it) { list.removeAttribute('aria-activedescendant'); return; }
    it.el.classList.add('active');
    list.setAttribute('aria-activedescendant', it.el.id);
    if (scroll) it.el.scrollIntoView({ block: 'nearest' });
  }

  function move(step) {
    const n = open.items.length;
    if (!n) return;
    let i = open.active;
    for (let k = 0; k < n; k++) {
      i = i < 0 ? (step > 0 ? 0 : n - 1) : Math.min(n - 1, Math.max(0, i + step));
      if (!open.items[i].disabled) return setActive(i, true);
      if ((step > 0 && i === n - 1) || (step < 0 && i === 0)) return;
    }
  }

  function edge(first) {
    const idx = open.items.map((x, i) => (x.disabled ? -1 : i)).filter((i) => i >= 0);
    if (idx.length) setActive(first ? idx[0] : idx[idx.length - 1], true);
  }

  function keyNav(ev) {
    const k = ev.key;
    if (k === 'ArrowDown') { ev.preventDefault(); move(1); }
    else if (k === 'ArrowUp') { ev.preventDefault(); move(-1); }
    else if (k === 'PageDown') { ev.preventDefault(); move(8); }
    else if (k === 'PageUp') { ev.preventDefault(); move(-8); }
    else if (k === 'Home' && ev.target !== search) { ev.preventDefault(); edge(true); }
    else if (k === 'End' && ev.target !== search) { ev.preventDefault(); edge(false); }
    else if (k === 'Enter' || (k === ' ' && ev.target !== search)) {
      ev.preventDefault();
      const it = open.items[open.active];
      if (it && !it.disabled) pick(it.opt);
    } else if (k === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(true); }
    else if (k === 'Tab') close(true);
    else if (k.length === 1 && ev.target !== search && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      const now = Date.now();
      typed = now - typedAt > 700 ? k.toLowerCase() : typed + k.toLowerCase();
      typedAt = now;
      const i = open.items.findIndex((x) => !x.disabled && (x.opt.label || x.opt.textContent).trim().toLowerCase().startsWith(typed));
      if (i >= 0) setActive(i, true);
    }
  }

  function place() {
    const r = open.btn.getBoundingClientRect();
    const gap = 4, margin = 8;
    const below = window.innerHeight - r.bottom - gap - margin;
    const above = r.top - gap - margin;
    const up = below < 220 && above > below;
    const room = Math.max(120, Math.min(360, up ? above : below));
    pop.style.width = `${Math.max(r.width, 220)}px`;
    pop.style.maxHeight = `${room}px`;
    list.style.maxHeight = `${room - (search.hidden ? 0 : 44)}px`;
    const w = pop.offsetWidth;
    pop.style.left = `${Math.max(margin, Math.min(r.left, window.innerWidth - w - margin))}px`;
    pop.style.top = up ? '' : `${r.bottom + gap}px`;
    pop.style.bottom = up ? `${window.innerHeight - r.top + gap}px` : '';
  }

  function show(sel) {
    const btn = btnOf.get(sel);
    if (sel.disabled || !btn.getClientRects().length) return;
    if (open) close(false);
    open = { sel, btn, items: [], active: -1 };
    // In a modal <dialog> (the top layer) the list must be inside it, or it opens behind the dialog
    // (the dino ticket's species list showed nothing, 2026-10-05).
    const host = sel.closest('dialog[open]') ?? document.body;
    if (pop.parentElement !== host) host.append(pop);
    search.value = '';
    search.hidden = sel.options.length < SEARCH_FROM;
    list.id = `cs-list-${++uid}`;
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-controls', list.id);
    pop.hidden = false;
    render();
    place();
    open.items[open.active]?.el.scrollIntoView({ block: 'nearest' });
    (search.hidden ? btn : search).focus();
  }

  function close(refocus) {
    if (!open) return;
    const { btn } = open;
    open = null;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.removeAttribute('aria-controls');
    if (refocus) btn.focus();
  }

  function pick(opt) {
    const sel = open.sel;
    const changed = indexDesc.get.call(sel) !== opt.index;
    close(true);
    if (!changed) return;
    indexDesc.set.call(sel, opt.index);
    sync(sel);
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  search.addEventListener('input', () => render());
  search.addEventListener('keydown', keyNav);
  document.addEventListener('mousedown', (ev) => {
    if (open && !pop.contains(ev.target) && !open.btn.contains(ev.target)) close(false);
  }, true);
  window.addEventListener('scroll', (ev) => { if (open && !pop.contains(ev.target)) place(); }, true);
  window.addEventListener('resize', () => { if (open) place(); });
  // A <label for> of a hidden select would do nothing: send it to the button.
  document.addEventListener('click', (ev) => {
    const label = ev.target.closest?.('label[for]');
    const sel = label && document.getElementById(label.htmlFor);
    if (sel instanceof HTMLSelectElement && btnOf.has(sel)) { ev.preventDefault(); btnOf.get(sel).focus(); }
  });

  const scan = (root) => {
    if (root instanceof HTMLSelectElement) enhance(root);
    else root.querySelectorAll?.('select').forEach(enhance);
  };
  const start = () => {
    scan(document);
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
        // A select's button leaves with it; a list open on it closes.
        if (open && !open.sel.isConnected) close(false);
      }
    }).observe(document.body, { childList: true, subtree: true });
  };
  // Loaded in <head>: once the page is there.
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
