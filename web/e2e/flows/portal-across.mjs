// Across pages in React (/next/) against the site before React (/), on the local portal (e2e/local-portal.sh), run with
// PANEL_COOKIE (Rex). The same steps on both sites, each result saved from the old page and compared:
// - the command palette: Ctrl+K opens it (and closes it again), the list by group, a search, ↓ ↑ Enter, nothing found,
//   Esc, ESC, a click outside, a chat command copied, a species (Skin Studio and a toast), a place (the map), the tour;
// - the tour: opened by itself a second after a first visit, each step (its badge, title, text, dots, buttons, the page
//   it opens and what it lights), → ← Enter and a dot, the last step done (remembered, the toast), Hướng dẫn opens it
//   again, Esc and ✕ Bỏ qua close it, a page opened during a step stays; seen already: not opened.
// Differences, all kept: a step's page is in the address (#gara...) in React, before React the address did not change;
// Enter on the palette's tour entry opens step 1 (before React the same key reached the tour and went on to step 2);
// out of the launcher the last step lights the header (before React a 12 px box in the corner, the hidden overlay entry).
import { SEEN } from './launcher-stub.mjs';

// Headless Chrome refuses the clipboard and both sites then ask with prompt(), which would stop the page: copies recorded.
const CLIP = `if (location.protocol === 'http:') Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } });`;
const FIRST = `if (location.protocol === 'http:') localStorage.removeItem('isle_portal_tour_done');`;

const HELP = `
  const out = {};
  const txt = (s) => (typeof s === 'string' ? h.$(s) : s)?.innerText?.replace(/\\s+/g, ' ').trim() ?? '';
  const key = (k, extra = {}, el = document.activeElement || document.body) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
  const page = () => h.$('.sidebar .nav-btn.active')?.dataset.nav ?? '';
  const toast = () => txt('#global-toast');`;

const PALETTE = `${HELP}
  const pal = () => !h.$('#cmd-palette-modal').hidden;
  const items = () => h.$$('#cmd-results-list .cmd-item').map((i) => (i.classList.contains('active') ? '*' : '') + i.dataset.cmdId).join(',');
  const groups = () => h.$$('#cmd-results-list .cmd-group-label').map(txt).join(' / ');
  const open = async () => { key('k', { ctrlKey: true }); await h.until(pal, 2000); await h.sleep(80); };
  const search = async (q) => { h.type('#cmd-search-input', q); await h.sleep(80); };
  await h.until(() => h.$('#cmd-palette-modal') && page(), 8000);
  out.closed = [pal(), page()];
  await open();
  out.open = [items(), groups(), txt('#cmd-results-list'), h.$('#cmd-search-input').value, h.$('#cmd-search-input').placeholder];
  key('k', { ctrlKey: true }); await h.sleep(80);
  out.toggle = pal();
  await open();
  out.reopened = h.$('#cmd-search-input').value;
  await search('gara');
  out.gara = [items(), txt('#cmd-results-list')];
  key('ArrowDown', {}, h.$('#cmd-search-input')); await h.sleep(30); out.down = items();
  key('ArrowDown', {}, h.$('#cmd-search-input')); key('ArrowDown', {}, h.$('#cmd-search-input')); await h.sleep(30); out.wrap = items();
  key('ArrowUp', {}, h.$('#cmd-search-input')); await h.sleep(30); out.up = items();
  key('ArrowUp', {}, h.$('#cmd-search-input')); await h.sleep(30); out.up2 = items();
  // Enter on the tour entry: before React the same key also reached the tour, opened at once, which went on to step 2.
  key('Enter', {}, h.$('#cmd-search-input'));
  await h.until(() => !pal() && !h.$('#tour-backdrop').hidden, 2000); await h.sleep(150);
  out.enterTour = [pal(), txt('#tour-step-badge'), page()];
  key('Escape'); await h.sleep(150);
  await open(); await search('gara');
  key('ArrowDown', {}, h.$('#cmd-search-input')); key('ArrowUp', {}, h.$('#cmd-search-input'));
  key('Enter', {}, h.$('#cmd-search-input'));
  await h.until(() => !pal(), 2000); await h.sleep(150);
  out.enter = [pal(), page(), location.hash];
  await open(); await search('LỆNH CHAT');
  out.chat = [items(), groups()];
  await search('zzz');
  out.none = [items(), txt('#cmd-results-list')];
  key('Escape'); await h.sleep(80);
  out.esc = pal();
  await open(); h.click('#cmd-close-btn'); await h.sleep(80);
  out.closeBtn = pal();
  await open(); h.click('#cmd-palette-modal'); await h.sleep(80);
  out.outside = pal();
  await open(); h.click('.cmd-item[data-cmd-id="cmd-slay"]');
  await h.until(() => toast(), 3000);
  out.copy = [pal(), toast(), window.__copied];
  await open(); h.click('.cmd-item[data-cmd-id="dino-trex"]');
  await h.until(() => toast().includes('T-Rex'), 3000); await h.sleep(150);
  out.species = [pal(), page(), toast()];
  await open(); await search('đập');
  out.dam = items();
  h.click('.cmd-item[data-cmd-id="loc-dam"]');
  await h.until(() => toast().includes('Đập'), 3000); await h.sleep(150);
  out.place = [pal(), page(), toast()];
  await open(); await search('tour'); h.click('.cmd-item[data-cmd-id="action-tour"]');
  await h.until(() => !h.$('#tour-backdrop').hidden, 3000); await h.sleep(150);
  out.tour = [pal(), txt('#tour-step-badge'), page()];
  key('Escape'); await h.sleep(80);
  out.tourEsc = [h.$('#tour-backdrop').hidden, pal()];`;
const PALETTE_KEYS = ['closed', 'open', 'toggle', 'reopened', 'gara', 'down', 'wrap', 'up', 'up2', 'enter', 'chat', 'none', 'esc', 'closeBtn', 'outside',
  'copy', 'species', 'dam', 'place', 'tour', 'tourEsc'];

const TOUR = `${HELP}
  const on = () => !h.$('#tour-backdrop').hidden;
  // Where the spotlight is put (it slides there in 0.3 s): its set place, not where it is in the middle of the slide.
  const spot = () => { const s = h.$('#tour-spotlight').style; return s.display === 'none' ? 'none' : [s.top, s.left, s.width, s.height].join(','); };
  const step = () => [txt('#tour-step-badge'), txt('#tour-title'), txt('#tour-body'), h.$$('#tour-dots .tour-dot').map((d) => (d.classList.contains('active') ? '●' : '○')).join(''),
    h.$('#tour-btn-prev').disabled, txt('#tour-btn-next'), page(), spot()];
  await h.until(() => on(), 5000); await h.sleep(250);
  out.auto = step();
  out.seenYet = localStorage.getItem('isle_portal_tour_done');
  h.click('#tour-btn-next'); await h.sleep(250); out.s2 = step();
  key('ArrowRight'); await h.sleep(250); out.s3 = step();
  key('ArrowLeft'); await h.sleep(250); out.back = step();
  key('ArrowLeft'); await h.sleep(250); key('ArrowLeft'); await h.sleep(250); out.first = step();
  h.click(h.$$('#tour-dots .tour-dot')[3]); await h.sleep(250); out.s4 = step();
  key('Enter'); await h.sleep(250); out.s5 = step();
  h.click('#tour-btn-next'); await h.sleep(250);
  await h.until(() => toast(), 3000);
  out.done = [on(), localStorage.getItem('isle_portal_tour_done'), toast(), page()];
  h.click('#tour-btn'); await h.sleep(250);
  out.again = [on(), txt('#tour-step-badge'), page()];
  h.click('#tour-btn-next'); await h.sleep(250);
  // A page opened during a step stays (the step's page is opened when the step is shown, not after).
  h.click('.sidebar .nav-btn[data-nav="ranking"]'); await h.sleep(400);
  out.navDuring = [on(), page(), txt('#tour-step-badge')];
  key('Escape'); await h.sleep(150);
  out.esc = [on(), page()];
  h.click('#tour-btn'); await h.sleep(250); h.click('#tour-skip-btn'); await h.sleep(150);
  out.skip = [on(), page()];`;
const TOUR_KEYS = ['auto', 'seenYet', 's2', 's3', 'back', 'first', 's4', 's5', 'done', 'again', 'navDuring', 'esc', 'skip'];

const SEEN_ONLY = `${HELP} await h.until(() => page(), 8000); await h.sleep(1500); out.seen = [!h.$('#tour-backdrop').hidden, page()];`;

const compare = (key, keys) => `{
  const old = JSON.parse(localStorage.getItem('${key}') ?? '{}');
  for (const k of ${JSON.stringify(keys)}) check('same as before React: ' + k, JSON.stringify(out[k]) === JSON.stringify(old[k]), { new: out[k], old: old[k] }); }`;

export default [
  { name: 'before React: the command palette (Ctrl+K)', old: true, path: '/#home', init: `${SEEN} ${CLIP}`, wait: 3500,
    run: `${PALETTE} localStorage.setItem('e2e.old.palette', JSON.stringify(out)); check('done', true, out);` },
  { name: 'the command palette in React: the same steps, the same results', path: '/next/#home', init: `${SEEN} ${CLIP}`,
    run: `${PALETTE} ${compare('e2e.old.palette', PALETTE_KEYS)}
      const oldT = JSON.parse(localStorage.getItem('e2e.old.palette') ?? '{}').enterTour;
      check('Enter on the tour: step 1 (before React: step 2, the key reached the tour too)', out.enterTour[1].startsWith('BƯỚC 1') && out.enterTour[2] === 'home' && String(oldT?.[1]).startsWith('BƯỚC 2'), { new: out.enterTour, old: oldT });` },
  { name: 'before React: the tour on a first visit', old: true, path: '/#home', init: FIRST, wait: 3500,
    run: `${TOUR} localStorage.setItem('e2e.old.tour', JSON.stringify(out)); check('done', true, out);` },
  { name: 'the tour in React on a first visit: the same steps, the same results', path: '/next/#home', init: FIRST, wait: 3500,
    run: `${TOUR} ${compare('e2e.old.tour', TOUR_KEYS.filter((k) => k !== 's5'))}
      const old5 = JSON.parse(localStorage.getItem('e2e.old.tour') ?? '{}').s5 ?? [];
      check('same as before React: s5 (but what it lights)', JSON.stringify(out.s5.slice(0, 7)) === JSON.stringify(old5.slice(0, 7)), { new: out.s5, old: old5 });
      // Out of the launcher there is no game mode button: before React it lit the hidden overlay menu entry (a 12 px box
      // in the corner); the header now, as the step meant.
      const hd = h.$('.top-header').getBoundingClientRect();
      check('the last step lights the header', out.s5[7] === [hd.top - 6, hd.left - 6, hd.width + 12, hd.height + 12].map((v) => Math.max(0, v) + 'px').join(','), [out.s5[7], old5[7]]);` },
  { name: 'before React: the tour seen already', old: true, path: '/#home', init: SEEN, wait: 3500,
    run: `${SEEN_ONLY} localStorage.setItem('e2e.old.tour.seen', JSON.stringify(out)); check('done', true, out);` },
  { name: 'the tour in React, seen already: not opened', path: '/next/#home', init: SEEN,
    run: `${SEEN_ONLY} ${compare('e2e.old.tour.seen', ['seen'])} check('not opened', !out.seen[0]);` },
];
