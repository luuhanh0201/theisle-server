// Trang chủ in React (/next/#home) against the site before React (/#home), on the local portal
// (e2e/local-portal.sh: Rex Tester, not in game, 2 garage slots; Hổ phách NEW, check-in ready,
// quest "Chơi 1 phút" done, "Đi 99 km" not, the starter gift waiting). The old page is read first
// into localStorage, then the new one must show the same; the claims last (they change the data).
import { LAUNCHER as STUB, SEEN } from './launcher-stub.mjs';
const LAUNCHER = `${SEEN} ${STUB}`;
// What Trang chủ says, part by part, white space folded (the same on both sites).
// What shows (innerText: no hidden part), white space folded.
const SNAP = `const t = (sel) => [...document.querySelectorAll(sel)].map((e) => (e.getClientRects().length ? e.innerText : '').replace(/\\s+/g, ' ').trim()).filter(Boolean).join(' | ');
  const snap = {
    starter: t('#home-starter'), amber: t('#home-amber'), checkin: t('#home-checkin'), quests: t('#home-quests'),
    hub: t('#launcher-hub'), status: t('.status-bar-card'), promo: t('#launcher-promo'), features: t('.feature-card'),
    rules: t('#server-rules-section'), lpBtn: document.querySelector('#lp-btn')?.offsetParent ? document.querySelector('#lp-btn').getAttribute('href') : null,
    checkinOn: document.querySelector('#home-checkin-btn')?.disabled === false,
    quests_on: [...document.querySelectorAll('[data-quest]')].map((b) => b.dataset.quest + ':' + !b.disabled).join(','),
    hubClass: document.querySelector('#hub-dino-card')?.className ?? null,
  };`;
const COMPARE = (key) => `${SNAP}
  const old = JSON.parse(localStorage.getItem('${key}') ?? 'null');
  check('the old page was read', old !== null);
  for (const k of Object.keys(snap)) check('same as before React: ' + k, JSON.stringify(snap[k]) === JSON.stringify(old?.[k]), { new: snap[k], old: old?.[k] });`;

export default [
  {
    name: 'before React: Trang chủ read (web)',
    old: true, path: '/#home',
    init: SEEN,
    wait: 3500,
    run: `await h.until(() => h.$('#home-checkin') && !h.$('#home-checkin').hidden && h.$('#lp-version')?.textContent);
      ${SNAP} localStorage.setItem('e2e.old.home', JSON.stringify(snap)); check('read', snap.checkin.length > 0, snap);`,
  },
  {
    name: 'Trang chủ in React (web) = before React',
    path: '/next/#home',
    init: SEEN,
    run: `await h.until(() => h.$('#home-checkin') && h.$('#lp-version')?.textContent && h.$('#srv-status-text')?.textContent !== 'Đang kiểm tra server…');
      ${COMPARE('e2e.old.home')}
      check('the hub is hidden on the web', getComputedStyle(h.$('#launcher-hub')).display === 'none');
      check('download: the Windows installer straight away', h.$('#lp-btn').getAttribute('href') === '/tai/XomGay-Launcher-Setup-2.8.1.exe' && h.$('#lp-os').textContent === 'cho Windows · 100 MB · miễn phí', h.$('#lp-os').textContent);
      check('Hổ phách NEW on the check-in', h.$('#home-checkin .rel-new')?.textContent === 'NEW');
      check('Trang chủ NEW in the menu? (not every part shares it)', !h.$('[data-nav=home] .rel-badge'));
      check('starter gift button', h.$('#home-starter-btn') && !h.$('#home-starter-btn').disabled);
      check('the done quest can be taken, the other not', h.$('[data-quest=play1]') && !h.$('[data-quest=play1]').disabled && h.$('[data-quest=walk99]').disabled);`,
  },
  {
    name: 'before React: Trang chủ read (launcher)',
    old: true, path: '/#home',
    init: LAUNCHER,
    wait: 3500,
    run: `await h.until(() => h.$('#home-checkin') && !h.$('#home-checkin').hidden && h.$('#hub-dino-species')?.textContent !== 'Chưa vào game');
      ${SNAP} localStorage.setItem('e2e.old.home.l', JSON.stringify(snap)); check('read', snap.status.length > 0, snap);
      check('before React, in the launcher: no hub (html.in-launcher refused by the CSP), no download promo', snap.hub === '' && snap.promo === '');`,
  },
  {
    name: 'Trang chủ in React (launcher) = before React; the hub works',
    path: '/next/#home',
    init: LAUNCHER,
    run: `await h.until(() => h.$('#home-checkin') && h.$('#hub-dino-species')?.textContent === 'Chưa vào server' && h.$('#srv-status-text')?.textContent !== 'Đang kiểm tra server…');
      ${COMPARE('e2e.old.home.l')}
      check('the hub says it as before React (when shown)', h.$('#hub-dino-badge').textContent === '○ CHƯA VÀO' && h.$('#hub-dino-status').textContent === 'Bấm Chơi Ngay ở trên để kết nối vào máy chủ.');
      check('the hub hidden in the launcher too, as before React', getComputedStyle(h.$('#launcher-hub')).display === 'none');
      check('no download promo inside the launcher', !h.$('#launcher-promo'));
      // The hub's buttons, should the hub be shown (MARK_IN_LAUNCHER): clicked in place.
      check('garage in the dock: 2/3 dino', h.$('#hub-gara-sub').textContent === '2/3 dino');
      h.click('#hub-gamemode-btn');
      check('hub game mode asks the launcher', window.__gm === true);
      h.click('#hub-update-btn');
      check('hub update looks for one', window.__calls.updateCheck === 1);
      h.click('.hub-dock-item[data-switch-tab=ranking]');
      await h.until(() => location.hash === '#ranking' && h.$('#page-ranking') && !h.$('#page-ranking').hidden);
      check('a dock button opens its page', true);`,
  },
  {
    name: 'Luật & Dinh Dưỡng scrolls to the rules, which light up',
    path: '/next/#gara',
    init: SEEN,
    run: `await h.until(() => h.$('[data-action=open-rules]'));
      h.click('[data-action=open-rules]');
      await h.until(() => h.$('#server-rules-section')?.classList.contains('highlight-section'));
      check('on Trang chủ, the rules lit', location.hash === '#home');
      await h.until(() => !h.$('#server-rules-section').classList.contains('highlight-section'), 4000);
      check('the light goes off after 2 s', true);`,
  },
  {
    name: 'the balance opens the shop',
    path: '/next/#home',
    init: SEEN,
    run: `await h.until(() => h.$('#home-amber'));
      h.click('#home-amber');
      await h.until(() => location.hash === '#shop' && h.$('#page-shop') && !h.$('#page-shop').hidden);
      check('#shop', true);`,
  },
  {
    name: 'claims: check-in, a quest, the starter gift (the data changes)',
    path: '/next/#home',
    init: SEEN,
    run: `await h.until(() => h.$('#home-checkin-btn') && !h.$('#home-checkin-btn').disabled);
      const toast = () => h.$('#global-toast')?.textContent ?? '';
      check('check-in label', h.$('#home-checkin-btn').textContent.replace(/\\s+/g, ' ').trim() === 'Điểm danh: +10 Hổ phách' || h.$('#home-checkin-btn').textContent.includes('Điểm danh: +10'), h.$('#home-checkin-btn').textContent);
      h.click('#home-checkin-btn');
      await h.until(() => toast().startsWith('✅'));
      check('check-in toast', toast() === '✅ Điểm danh ngày 1: +10 Hổ phách', toast());
      await h.until(() => h.$('#home-checkin-btn').textContent === '✓ Đã điểm danh hôm nay');
      check('done for today, disabled', h.$('#home-checkin-btn').disabled);
      await h.until(() => h.$('#home-amber').textContent.trim().startsWith('10'));
      check('balance 10', true);
      h.click('[data-quest=play1]');
      await h.until(() => toast().includes('Chơi 1 phút'));
      check('quest toast', toast() === '✅ Chơi 1 phút: +25 Hổ phách', toast());
      await h.until(() => !h.$('[data-quest=play1]'));
      check('quest marked taken', h.$('#home-quests').textContent.includes('✓ Đã nhận'));
      await h.until(() => h.$('#home-amber').textContent.trim().startsWith('35'));
      check('balance 35', true);
      h.click('#home-starter-btn');
      await h.until(() => toast().includes('Túi đồ'));
      check('starter toast', /^✅ Đã nhận .+, xem trong Túi đồ$/.test(toast()), toast());
      await h.until(() => !h.$('#home-starter'));
      check('the gift box is gone', true);
      check('the bag counts it', Number(h.$('#nav-bag-badge')?.textContent) >= 1, h.$('#nav-bag-badge')?.textContent);`,
  },
  {
    name: 'a guest: no rewards; the hub and the server as for anyone',
    path: '/next/#home',
    init: `${LAUNCHER} if (location.protocol === 'http:') document.cookie = 'isle_session=; path=/; max-age=0';`,
    run: `await h.until(() => h.$('#auth-actions a') && h.$('#srv-status-text')?.textContent !== 'Đang kiểm tra server…');
      check('no rewards', !h.$('#home-checkin') && !h.$('#home-quests') && !h.$('#home-amber') && !h.$('#home-starter'));
      check('hub as at first', h.$('#hub-dino-species').textContent === 'Chưa vào game' && h.$('#hub-dino-badge').textContent === '○ CHƯA VÀO' && h.$('#hub-dino-growth').textContent === 'Growth: 0%');
      check('hub without a tier', h.$('#hub-dino-card').className === 'hub-card hub-dino-card', h.$('#hub-dino-card').className);
      check('dock: Cất & Khôi phục', h.$('#hub-gara-sub').textContent === 'Cất & Khôi phục');
      check('server status', h.$('#srv-slots-text').textContent === '1 / 100' && h.$('#srv-status-text').textContent === 'Máy chủ đang khởi động lại…', h.$('#srv-status-text').textContent);`,
  },
];
