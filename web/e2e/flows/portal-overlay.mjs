// Game Overlay HUD in React (/next/#overlay) against the site before React (/#overlay), on the local portal
// (e2e/local-portal.sh), run with LIVE_COOKIE ("Live Tester" in game). In the launcher (overlay-stub.mjs plays its
// overlay calls): the same steps on both sites and the same calls made, each result saved from the old page and
// compared: what shows, the tabs, a widget turned on, a style, a slider, a shown part, a reset, the whole overlay off and
// on, preview, edit on screen, the keys (one taken), game mode's kept widgets, the big map's screen, the black-edge fix, a
// box dragged on the layout. Then what the page hands the overlay each second (your dino, the mini map's picture) and to
// the big map when it opens. Last, a browser (no launcher): the card says it is only a preview.
import { SEEN } from './launcher-stub.mjs';
import { OVERLAY } from './overlay-stub.mjs';

const INIT = `${SEEN} ${OVERLAY}`;

const STEPS = `
  const out = {};
  const txt = (s) => (typeof s === 'string' ? h.$(s) : s)?.innerText?.replace(/\\s+/g, ' ').trim() ?? '';
  const shown = (s) => !!h.$(s) && h.$(s).getClientRects().length > 0;
  const calls = () => { const c = window.__ov.calls.slice(); window.__ov.calls.length = 0; return c; };
  const tabs = () => h.$$('#ov-tabs button').map((b) => (b.getAttribute('aria-selected') === 'true' ? '*' : '') + (b.querySelector('.st.on') ? '●' : '○') + txt(b)).join(' / ');
  const boxes = () => h.$$('#ov-stage .ov-box').map((b) => txt(b) + (b.className.includes('sel') ? ' [sel]' : '')).join(' | ') + ' // ' + h.$$('#ov-stage .ov-screen').map(txt).join(' | ') + ' // ' + txt('#ov-stage .ov-empty');
  const checks = (sel) => h.$$(sel + ' input[type=checkbox]').map((i) => (i.checked ? '☑' : '☐') + (i.closest('label')?.innerText.trim() ?? '')).join(', ');
  const pressed = () => h.$$('#ov-panel .v-seg button').map((b) => (b.getAttribute('aria-pressed') === 'true' ? '*' : '') + txt(b)).join(',');
  const panel = () => [txt('#ov-panel'), pressed(), checks('#ov-panel'), h.$$('#ov-panel output').map(txt).join(',')];
  const checkbox = (label) => h.$$('#page-overlay input[type=checkbox]').find((i) => i.closest('label')?.innerText.trim() === label);
  await h.until(() => shown('#ov-app') && h.$('#ov-tabs button'), 8000);
  await h.sleep(300);
  out.start = [shown('#ov-app'), shown('#ov-web'), txt('.ov-top'), h.$('#ov-enabled').checked, checks('#ov-gm-keep'), shown('#ov-bigmap-display-wrap'), shown('#ov-compat-wrap'),
    txt('#ov-bigmap-display-wrap'), tabs(), boxes(), ...panel(), calls()];
  // The tabs.
  for (const t of ['map', 'dino', 'quests']) { h.click('#ov-tabs [data-tab="' + t + '"]'); await h.sleep(250); out['tab_' + t] = [tabs(), ...panel()]; }
  // Turn the quests widget on: sent, its box on the layout, its dot.
  checkbox('Hiện khung 🏆 Nhiệm vụ').click();
  await h.sleep(600);
  out.questsOn = [tabs(), boxes(), calls()];
  checkbox('Ẩn nhiệm vụ đã xong').click();
  await h.sleep(400);
  out.hideDone = [checks('#ov-panel'), calls()];
  // Voice: a style, a slider (the overlay follows while it moves), a part shown or not, then its defaults back.
  h.click('#ov-tabs [data-tab="voice"]'); await h.sleep(250);
  h.click('#ov-panel [data-choice="style"][data-value="compact"]');
  await h.sleep(500);
  out.style = [pressed(), calls()];
  const scale = h.$$('#ov-panel input[type=range]')[0];
  h.type(scale, '150');
  await h.sleep(500);
  scale.dispatchEvent(new Event('change', { bubbles: true }));
  await h.sleep(500);
  out.scale = [h.$$('#ov-panel output').map(txt).join(','), calls(), boxes()];
  checkbox('Hướng & khoảng cách (trái / phải, gần / xa)').click();
  await h.sleep(500);
  out.showPart = [checks('#ov-panel'), calls()];
  h.click('#ov-panel [data-act="reset"]');
  await h.sleep(500);
  out.reset = [...panel(), calls()];
  // The whole overlay off, then on.
  h.$('#ov-enabled').click();
  await h.sleep(500);
  out.off = [h.$('#ov-enabled').checked, boxes(), calls()];
  h.$('#ov-enabled').click();
  await h.sleep(500);
  out.on = [h.$('#ov-enabled').checked, boxes(), calls()];
  // Preview, edit on screen (twice), the keys.
  h.click('#ov-preview');
  h.click('#ov-drag'); await h.sleep(200);
  out.edit = [txt('#ov-drag'), calls()];
  h.click('#ov-drag'); await h.sleep(200);
  out.editOff = [txt('#ov-drag'), calls()];
  h.click('#ov-key'); await h.sleep(100);
  out.keyWaiting = txt('#ov-key-name');
  await h.sleep(500);
  out.key = [txt('#ov-key-name'), txt('#ov-drag'), calls()];
  h.click('#ov-edit-key'); await h.sleep(600);
  out.keyTaken = [txt('#ov-edit-key-name'), calls()];
  h.click('#ov-bigmap-key'); await h.sleep(600);
  out.bigmapKey = [txt('#ov-bigmap-key-name'), calls()];
  // Game mode keeps the dino widget too; the big map on screen 2; the black-edge fix.
  checkbox('🦖 Thông số dino').click();
  await h.sleep(300);
  out.keep = [checks('#ov-gm-keep'), calls()];
  const sel = h.$('#ov-bigmap-display-wrap button[aria-haspopup=listbox]');
  sel.click(); await h.sleep(200);
  const opt = h.$$('[role=option]').find((x) => x.innerText.trim().startsWith('Màn hình 2'));
  opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); opt.click();
  await h.sleep(300);
  out.display = [txt(sel), calls()];
  h.$('#ov-compat').click();
  await h.sleep(300);
  out.compat = [h.$('#ov-compat').checked, calls()];
  // Drag the voice box 60 px right, 20 px down on the layout.
  const box = h.$('#ov-stage .ov-box[data-box="voice"]');
  const r = box.getBoundingClientRect();
  const at = (type, dx, dy) => box.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: r.left + 10 + dx, clientY: r.top + 10 + dy }));
  try { at('pointerdown', 0, 0); } catch {}
  await h.sleep(50); at('pointermove', 30, 10); await h.sleep(50); at('pointermove', 60, 20); await h.sleep(100); at('pointerup', 60, 20);
  await h.sleep(600);
  out.drag = [boxes(), calls().filter((c) => c.startsWith('overlayPlace')).slice(-1)];
  // Each second the overlay gets your dino; the mini map gets pictures.
  const g0 = window.__ov.games;
  await h.until(() => window.__ov.games > g0 + 1, 8000);
  const g = window.__ov.lastGame;
  out.game = [Object.keys(g).join(','), g.player?.name, g.dino?.species, Array.isArray(g.ai), Array.isArray(g.escapees), g.target === null || typeof g.target === 'object'];
  window.__ov.bigMap(true);
  await h.until(() => window.__ov.lastGame?.aiZones !== null, 8000);
  out.bigMap = [Array.isArray(window.__ov.lastGame.aiZones)];`;
const KEYS = ['start', 'tab_map', 'tab_dino', 'tab_quests', 'questsOn', 'hideDone', 'style', 'scale', 'showPart', 'reset', 'off', 'on', 'edit', 'editOff',
  'keyWaiting', 'key', 'keyTaken', 'bigmapKey', 'keep', 'display', 'compat', 'drag', 'game', 'bigMap'];

const WEB = `
  const txt = (s) => h.$(s)?.innerText?.replace(/\\s+/g, ' ').trim() ?? '';
  await h.until(() => h.$('#ov-web'), 8000); await h.sleep(300);
  const out = [h.$('#ov-web').getClientRects().length > 0, h.$('#ov-app').getClientRects().length > 0, txt('#v-overlay-card .card-header'), txt('.ov-top'), txt('#ov-tabs'), txt('#ov-panel')];`;

export default [
  { name: 'before React: Overlay in the launcher: settings, layout, keys, game mode, big map; the data handed over', old: true, path: '/#overlay', init: INIT, wait: 3500,
    run: `${STEPS} localStorage.setItem('e2e.old.overlay', JSON.stringify(out)); check('done', true, out);` },
  { name: 'Overlay in React, in the launcher: the same steps, the same calls', path: '/next/#overlay', init: INIT,
    run: `${STEPS}
      const old = JSON.parse(localStorage.getItem('e2e.old.overlay') ?? '{}');
      for (const k of ${JSON.stringify(KEYS)}) check('same as before React: ' + k, JSON.stringify(out[k]) === JSON.stringify(old[k]), { new: out[k], old: old[k] });
      check('the mini map got pictures', window.__ov.frames > 0, window.__ov.frames);` },
  { name: 'before React: Overlay in a browser', old: true, path: '/#overlay', init: SEEN, wait: 3500,
    run: `${WEB} localStorage.setItem('e2e.old.overlay.web', JSON.stringify(out)); check('done', true, out);` },
  { name: 'Overlay in React, in a browser = before React', path: '/next/#overlay', init: SEEN,
    run: `${WEB} const old = JSON.parse(localStorage.getItem('e2e.old.overlay.web') ?? 'null');
      check('same as before React: web', JSON.stringify(out) === JSON.stringify(old), { new: out, old });` },
];
