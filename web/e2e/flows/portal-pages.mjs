// The player site's pages of their own in React (/next/<page>.html) against the same pages before React (/<page>.html),
// on the local portal (e2e/local-portal.sh; its /tai/version.json has a Windows build, no Linux one). The same steps on
// both, each result saved from the old page and compared:
// - tai.html: the text, which system is "Máy của bạn" (headless Chrome on Linux), the version, each button (address,
//   text, off), the download counted; in the launcher: back home. One difference, a fix: "Sao chép" copies and says so
//   (before React its inline script was refused by the portal's CSP and the button did nothing);
// - mutations.html: the cards (count, texts, icons filled), each filter, a search, nothing found;
// - launcher-done.html: done (and the hand back to the launcher), each error;
// - bigmap.html: in a browser (the map, nothing live), the sliders kept; in the launcher (bigmap-stub below): its key,
//   the game data drawn, Esc / ✕ / a tap off the island close it, a text box tells the launcher it is typing.
import { LAUNCHER } from './launcher-stub.mjs';

const HELP = `
  const out = {};
  const txt = (s) => (typeof s === 'string' ? h.$(s) : s)?.innerText?.replace(/\\s+/g, ' ').trim() ?? '';`;
const compare = (key, keys) => `{
  const old = JSON.parse(localStorage.getItem('${key}') ?? '{}');
  for (const k of ${JSON.stringify(keys)}) check('same as before React: ' + k, JSON.stringify(out[k]) === JSON.stringify(old[k]), { new: out[k], old: old[k] }); }`;
const pair = (name, page, steps, keys, extra = '', opts = {}) => [
  { name: `before React: ${name}`, old: true, path: `/${page}`, wait: 3000, ...opts,
    run: `${HELP} ${steps} localStorage.setItem('e2e.old.${name}', JSON.stringify(out)); check('done', true, out);` },
  { name: `${name} in React = before React`, path: `/next/${page}`, wait: 3000, ...opts,
    run: `${HELP} ${steps} ${compare(`e2e.old.${name}`, keys)} ${extra}` },
];

// Headless Chrome refuses the clipboard: copies recorded. Beacons recorded.
const RECORD = `if (location.protocol === 'http:') {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } });
  window.__beacons = []; navigator.sendBeacon = (u, b) => { window.__beacons.push([u, String(b)]); return true; };
}`;

const TAI = `
  await h.until(() => txt('#version').startsWith('Phiên bản'), 5000);
  out.text = txt('.wrap');
  out.title = document.title;
  out.mine = [h.$('#tag-win').hidden, h.$('#tag-linux').hidden, h.$('#dl-win').className, h.$('#dl-linux').className];
  out.btns = ['#btn-win', '#btn-linux'].map((s) => [h.$(s).getAttribute('href'), h.$(s).className, txt(s)]);
  h.$('#btn-win').addEventListener('click', (e) => e.preventDefault());
  h.click('#btn-win');
  out.beacon = window.__beacons.filter(([u]) => u === '/api/track/download');
  h.click('.btn-copy-mini'); await h.sleep(300);
  out.copy = [window.__copied ?? null, txt('#toast-container')];`;

const MUT = `
  await h.until(() => h.$$('#mutation-grid .card').length > 0, 5000);
  await h.until(() => h.$$('#mutation-grid img[data-mut-filled="1"]').length > 0, 5000);
  const cards = () => h.$$('#mutation-grid .card');
  out.head = [txt('header'), document.title, h.$('#search-input').placeholder];
  out.all = [cards().length, cards().map(txt).join(' | ')];
  out.icons = [h.$$('#mutation-grid img[data-mut-icon]').length, h.$$('#mutation-grid img[data-mut-filled="1"]').length];
  out.links = h.$$('#mutation-grid .btn-dl').slice(0, 4).map((a) => [a.getAttribute('href'), a.getAttribute('download')]);
  out.filters = [];
  for (const b of h.$$('#filter-container .filter-btn')) {
    h.click(b); await h.sleep(80);
    out.filters.push([txt(b), h.$$('#filter-container .filter-btn.active').map(txt).join(), cards().map((c) => txt(c.querySelector('.card-title'))).join(',')]);
  }
  h.click('[data-filter="all"]'); await h.sleep(80);
  h.type('#search-input', 'máu'); await h.sleep(120);
  out.search = cards().map((c) => txt(c.querySelector('.card-title'))).join(',');
  h.type('#search-input', 'zzzz'); await h.sleep(120);
  out.none = txt('#mutation-grid');`;

const DONE = `out.shown = [h.$('#ok').hidden, h.$('#bad').hidden, txt('.card'), document.title];`;

// bigmap: the launcher's big map calls, recorded (launcher/src/preload.js); the game data as the overlay gets it.
const BIGMAP_STUB = `if (location.protocol === 'http:') {
  window.__bm = { calls: [], cb: {} };
  const rec = (c) => window.__bm.calls.push(c);
  window.isleLauncher = {
    keyLabel: (k) => (k === 'bigmap' ? 'M' : '?'),
    bigMapClose: () => rec('close'), bigMapTyping: (on) => rec('typing ' + on),
    onBigMap: (cb) => { window.__bm.cb.open = cb; },
    onOverlayGame: (cb) => { window.__bm.cb.game = cb; },
    overlayGameGet: () => ({ dino: { species: 'Tyrannosaurus', growth: 0.5, position: { x: 1000, y: -2000, z: 0, yaw: 90 }, trail: [] }, ai: [], fish: [], escapees: [], friends: [], aiZones: null }),
  };
}`;
const BIG_WEB = `
  await h.until(() => h.$('#map canvas'), 5000); await h.sleep(300);
  out.bar = [txt('.bm-bar'), h.$('#bm-map').value, h.$('#bm-dim').value, document.title];
  out.map = [h.$$('#map canvas').length, h.$$('#map .chip').map(txt).join(','), txt('#map .map-msg')];`;
const BIG_LAUNCHER = `
  await h.until(() => h.$('#map canvas'), 5000); await h.sleep(500);
  out.bar = [txt('.bm-bar')];
  out.map = [h.$$('#map .chip').map(txt).join(','), txt('#map .map-msg')];
  h.click('#bm-close'); out.closeBtn = window.__bm.calls.splice(0);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); out.esc = window.__bm.calls.splice(0);
  const box = h.$('#map input[type=text], #map .mt-input');
  out.typingBox = !!box;
  window.__bm.cb.open(true); window.__bm.cb.game({ dino: null, ai: [], fish: [], escapees: [], friends: null }); await h.sleep(200);
  out.fed = txt('#map .map-msg');`;

export default [
  ...pair('tai', 'tai.html', TAI, ['text', 'title', 'mine', 'btns', 'beacon'],
    `check('Sao chép copies and says so (before React: nothing)', out.copy[0] === 'chmod +x XomGay-Launcher*.AppImage' && out.copy[1] === '✓ Đã sao chép lệnh vào bộ nhớ tạm!', { new: out.copy, old: JSON.parse(localStorage.getItem('e2e.old.tai')).copy });`,
    { init: RECORD }),
  ...pair('tai in the launcher', 'tai.html', `out.where = [location.pathname, location.hash];`, ['where'], `check('home', out.where[0] === '/', out.where);`, { init: LAUNCHER }),
  ...pair('mutations', 'mutations.html', MUT, ['head', 'all', 'icons', 'links', 'filters', 'search', 'none']),
  ...pair('launcher-done', 'launcher-done.html', DONE, ['shown']),
  ...['steam', 'refused', 'other-address', 'expired'].flatMap((e) => pair(`launcher-done ${e}`, `launcher-done.html?error=${e}`, DONE, ['shown'])),
  ...pair('bigmap in a browser', 'bigmap.html', `${BIG_WEB}
    // A slider moved: the look kept for the next time.
    h.type('#bm-map', '50'); h.type('#bm-dim', '30'); await h.sleep(100);
    out.look = [localStorage.getItem('isle-bigmap-look.v1'), h.$('#bm-map').value, h.$('#bm-dim').value];
    localStorage.removeItem('isle-bigmap-look.v1');`, ['bar', 'map', 'look']),
  ...pair('bigmap in the launcher', 'bigmap.html', BIG_LAUNCHER, ['bar', 'map', 'closeBtn', 'esc', 'typingBox', 'fed'], '', { init: BIGMAP_STUB }),
];
