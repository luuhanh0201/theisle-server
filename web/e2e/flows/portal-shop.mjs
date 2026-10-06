// Cửa hàng in React (/next/#shop) against the site before React (/#shop), on the local portal (e2e/local-portal.sh;
// seed-bag.mjs puts eight listings on sale, one off, and gives Live Tester, an SVip, 2000 Hổ phách), run with LIVE_COOKIE.
// The same steps on both sites: what shows (amounts as N, each run buys), the tabs, the confirm box and its cancel, a buy
// of 2 (the balance and today's limit go down by the same on both), then Rex (the shop shown locked) and a guest.
// One difference, a fix: after a buy the line "✅ Đã mua …" stays (before React the shop's reload hid it at once; the toast
// said it).
import { SEEN } from './launcher-stub.mjs';

const REX = process.env.REX_COOKIE ?? '';
const LIVE = process.env.LIVE_COOKIE ?? '';
const AS_LIVE = `${SEEN} if (location.protocol === 'http:') document.cookie = 'isle_session=${LIVE}; path=/';`;
const AS_REX = `${SEEN} if (location.protocol === 'http:') document.cookie = 'isle_session=${REX}; path=/';`;
const AS_GUEST = `${SEEN} if (location.protocol === 'http:') document.cookie = 'isle_session=; path=/; max-age=0';`;

const HELP = `
  const out = {};
  const txt = (s) => (typeof s === 'string' ? h.$(s) : s)?.innerText?.replace(/\\s+/g, ' ').trim() ?? '';
  const N = (t) => t.replace(/\\d[\\d.]*/g, 'N');
  const num = (t) => Number(String(t).replace(/[^\\d]/g, ''));
  const card = (name) => h.$$('#shop-list .shop-item').find((li) => li.querySelector('.nm b')?.innerText === name);
  const cards = () => N(h.$$('#shop-list > li').map((li) => txt(li)).join(' | '));
  const btns = () => h.$$('#shop-list .act button').map((b) => b.innerText.trim() + (b.disabled ? '(x)' : '')).join(',');
  const qtys = () => h.$$('#shop-list .shop-item').map((li) => (li.querySelector('.act input') ? 'q' : '-')).join('');
  const tabs = () => h.$$('#shop-filter button').map((b) => (b.className.includes('active') ? '*' : '') + txt(b)).join(' / ');
  const st = () => [txt('#shop-status'), h.$('#shop-status').className, h.$('#shop-status').hidden];
  const dlgOpen = () => h.$('#shop-dlg').open;
  await h.until(() => h.$('#shop-list .shop-item') || txt('#shop-status'), 10000);`;

const STEPS = `${HELP}
  out.start = [N(txt('#shop-bal')), tabs(), cards(), btns(), qtys(), st()];
  h.click('#shop-filter [data-shop-tab="skin"]'); await h.sleep(150);
  out.skins = [tabs(), cards(), btns()];
  h.click('#shop-filter [data-shop-tab="all"]'); await h.sleep(150);
  // The box and its cancel.
  h.click(card('Túi tăng trưởng').querySelector('[data-shop-buy]'));
  await h.until(() => dlgOpen(), 3000);
  out.box = N(txt('#shop-dlg-in'));
  h.click('#shop-dlg [data-shop-dlg="close"]');
  await h.until(() => !dlgOpen(), 3000);
  // A buy of 2 food boxes.
  const bal0 = num(txt('#shop-bal')), left0 = num(/còn (\\d+)/.exec(txt(card('Hộp food')))?.[1]);
  h.typeNum(card('Hộp food').querySelector('.act input'), '2');
  await h.sleep(150);
  h.click(card('Hộp food').querySelector('[data-shop-buy]'));
  await h.until(() => dlgOpen(), 3000);
  out.buyBox = [N(txt('#shop-dlg-in')), /Mua 2 × Hộp food/.test(txt('#shop-dlg-in'))];
  h.click('#shop-dlg [data-shop-dlg="buy"]');
  await h.until(() => !dlgOpen(), 8000);
  await h.until(() => txt('#global-toast').startsWith('✅'), 3000);
  out.toast = txt('#global-toast');
  await h.until(() => num(txt('#shop-bal')) !== bal0, 8000);
  out.after = [bal0 - num(txt('#shop-bal')), left0 - num(/còn (\\d+)/.exec(txt(card('Hộp food')))?.[1]), N(txt(card('Hộp food')))];`;
const KEYS = ['start', 'skins', 'box', 'buyBox', 'toast', 'after'];

const compare = (key, keys) => `{
  const old = JSON.parse(localStorage.getItem('${key}') ?? '{}');
  for (const k of ${JSON.stringify(keys)}) check('same as before React: ' + k, JSON.stringify(out[k]) === JSON.stringify(old[k]), { new: out[k], old: old[k] }); }`;

export default [
  { name: 'before React: Cửa hàng (an SVip with 2000 Hổ phách): cards, tabs, the box, a buy', old: true, path: '/#shop', init: AS_LIVE, wait: 3500,
    run: `${STEPS} localStorage.setItem('e2e.old.shop', JSON.stringify(out)); check('done', true, out);` },
  { name: 'Cửa hàng in React: the same steps, the same results', path: '/next/#shop', init: AS_LIVE,
    run: `${STEPS} ${compare('e2e.old.shop', KEYS)}
      check('the bought line stays (hidden at once before React)', txt('#shop-status').startsWith('✅ Đã mua 2 × Hộp food'), st());
      check('its link goes to the bag', h.$('#shop-status a')?.getAttribute('href') === '#bag');` },
  { name: 'before React: Cửa hàng, Rex: shown locked', old: true, path: '/#shop', init: AS_REX, wait: 3500,
    run: `${HELP} out.start = [N(txt('#shop-bal')), tabs(), cards(), btns(), qtys(), st()]; localStorage.setItem('e2e.old.shop.rex', JSON.stringify(out)); check('done', true, out);` },
  { name: 'Cửa hàng in React, Rex = before React', path: '/next/#shop', init: AS_REX,
    run: `${HELP} out.start = [N(txt('#shop-bal')), tabs(), cards(), btns(), qtys(), st()]; ${compare('e2e.old.shop.rex', ['start'])}` },
  { name: 'before React: Cửa hàng, a guest', old: true, path: '/#shop', init: AS_GUEST, wait: 3500,
    run: `${HELP} out.start = [txt('#shop-bal'), txt('#shop-list'), st()]; localStorage.setItem('e2e.old.shop.guest', JSON.stringify(out)); check('done', true, out);` },
  { name: 'Cửa hàng in React, a guest = before React', path: '/next/#shop', init: AS_GUEST,
    run: `${HELP} out.start = [txt('#shop-bal'), txt('#shop-list'), st()]; ${compare('e2e.old.shop.guest', ['start'])}` },
];
