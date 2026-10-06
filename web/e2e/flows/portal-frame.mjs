// The player site's frame in React (/next/): the menu, the pages as #addresses, the header, the
// launcher's parts, the phone's menu, a guest. On the local portal (e2e/local-portal.sh), logged in
// as Rex Tester (2 garage slots), the server named "Test".
import { LAUNCHER } from './launcher-stub.mjs';

export default [
  {
    name: 'menu, header, server name (web, logged in)',
    path: '/next/#home',
    run: `
      await h.until(() => h.$('.auth-name'));
      const labels = h.$$('.sidebar .nav-label').map((e) => e.textContent.trim());
      // Rex's bag is open, the shop shown (locked): local-portal.sh.
      check('the menu entries', JSON.stringify(labels) === JSON.stringify(['Trang chủ', 'Dino Live Monitor', 'Bản đồ Gateway', 'Gara Khủng Long', 'Bảng Xếp Hạng', 'Skin Studio', 'Túi đồ', 'Cửa hàng', 'Voice 3D', 'Tải Launcher', 'Luật & Dinh Dưỡng']), labels);
      // The site before React has the same entries (less the overlay, launcher only, and the hidden tour button).
      const old = new DOMParser().parseFromString(await (await fetch('/')).text(), 'text/html');
      const oldLabels = [...old.querySelectorAll('.sidebar .nav-btn:not(#nav-overlay):not(#sidebar-tour-btn) .nav-label')].map((e) => e.textContent.trim());
      check('same entries as the site before React', JSON.stringify(labels) === JSON.stringify(oldLabels), oldLabels);
      check('Trang chủ lit', h.$('.sidebar .nav-btn.active')?.dataset.nav === 'home');
      check('the garage badge (2 slots)', h.$('#nav-gara-badge')?.textContent === '2', h.$('#nav-gara-badge')?.textContent);
      check('LIVE dim (not in game)', !h.$('#nav-dino-badge').classList.contains('on'));
      check('logged in as Rex Tester', h.$('.auth-name')?.textContent.includes('Rex Tester'));
      check('Đăng xuất button', h.$('#logout-btn')?.textContent === 'Đăng xuất');
      await h.until(() => h.$('#srv-name')?.textContent === 'Test');
      check('server name in the menu and the tab', h.$('#srv-name').textContent === 'Test' && document.title === 'Test', document.title);
      check('slots in the menu (Live Tester online)', h.$('#sidebar-slots')?.textContent === '1 / 100 slot', h.$('#sidebar-slots')?.textContent);
      check('no Discord without an invite', !h.$('#srv-discord'));
      check('download links on the web', h.$('#get-launcher')?.getAttribute('href') === '/tai.html' && h.$('#sidebar-launcher-link')?.getAttribute('href') === '/tai.html');
      check('no overlay page, no game mode outside the launcher', !h.$('[data-nav=overlay]') && !h.$('#game-mode'));
      check('not html.in-launcher', !document.documentElement.classList.contains('in-launcher'));
      check('the page section', !h.$('#page-home').hidden);
    `,
  },
  {
    name: 'pages as #addresses; a page not moved yet links to the site before React',
    path: '/next/#home',
    run: `
      await h.until(() => h.$('.sidebar [data-nav=gara]'));
      h.click('.sidebar [data-nav=gara]');
      await h.until(() => location.hash === '#gara' && h.$('#page-gara') && !h.$('#page-gara').hidden);
      check('Gara lit', h.$('.sidebar .nav-btn.active')?.dataset.nav === 'gara');
      check('its section shown, home hidden', !h.$('#page-gara').hidden && h.$('#page-home').hidden);
      check('link to the same page before React', h.$('#page-gara [data-legacy] a')?.getAttribute('href') === '/#gara', h.$('#page-gara a')?.getAttribute('href'));
      location.hash = 'ranking';
      await h.until(() => h.$('.sidebar .nav-btn.active')?.dataset.nav === 'ranking');
      check('typing an address goes there', !h.$('#page-ranking').hidden);
      location.hash = 'nothing';
      await h.until(() => h.$('.sidebar .nav-btn.active')?.dataset.nav === 'home');
      check('an unknown address shows Trang chủ', !h.$('#page-home').hidden);
      location.hash = 'bag';
      await h.until(() => h.$('#page-bag') && !h.$('#page-bag').hidden);
      check('the bag, open to this player', h.$('.sidebar .nav-btn.active')?.dataset.nav === 'bag');
      location.hash = 'gara';
      await h.sleep(200);
      h.click('[data-action=open-rules]');
      await h.until(() => location.hash === '#home' && h.$('.sidebar .nav-btn.active')?.dataset.nav === 'home');
      check('Luật & Dinh Dưỡng goes to Trang chủ', !h.$('#page-home').hidden);
    `,
  },
  {
    name: 'the menu collapses and stays so; Mở menu opens it',
    path: '/next/#home',
    run: `
      await h.until(() => h.$('#sidebar-toggle'));
      try { localStorage.removeItem('xg.sidebar_collapsed'); } catch {}
      check('open at first', !document.body.classList.contains('sidebar-collapsed'));
      h.click('#sidebar-toggle');
      await h.until(() => document.body.classList.contains('sidebar-collapsed'));
      check('collapsed', true);
      check('remembered (xg.sidebar_collapsed)', localStorage.getItem('xg.sidebar_collapsed') === '1');
      check('toggle titled for opening', h.$('#sidebar-toggle').title === 'Mở rộng menu bên trái');
      h.click('#desktop-sidebar-expand');
      await h.until(() => !document.body.classList.contains('sidebar-collapsed'));
      check('Mở menu opens it and forgets', localStorage.getItem('xg.sidebar_collapsed') === null);
      localStorage.setItem('xg.sidebar_collapsed', '1');
    `,
  },
  {
    name: 'collapsed state read at load',
    path: '/next/#home',
    run: `
      await h.until(() => h.$('#sidebar-toggle'));
      check('collapsed after a reload', document.body.classList.contains('sidebar-collapsed'));
      h.click('#sidebar-toggle');
      await h.until(() => !document.body.classList.contains('sidebar-collapsed'));
      check('open again', localStorage.getItem('xg.sidebar_collapsed') === null);
    `,
  },
  {
    name: 'lab mode (?lab=1, remembered, ?lab=0 off)',
    path: '/next/?lab=1#home',
    run: `
      await h.until(() => h.$('.sidebar'));
      check('html.lab', document.documentElement.classList.contains('lab'));
      check('remembered', localStorage.getItem('xg.lab') === '1');
    `,
  },
  {
    name: 'lab mode off',
    path: '/next/?lab=0#home',
    run: `
      await h.until(() => h.$('.sidebar'));
      check('no html.lab', !document.documentElement.classList.contains('lab'));
      check('forgotten', localStorage.getItem('xg.lab') === null);
    `,
  },
  {
    name: 'a failed Steam login says so, the address cleaned',
    path: '/next/?login_error=Steam%20kh%C3%B4ng%20tr%E1%BA%A3%20l%E1%BB%9Di',
    run: `
      await h.until(() => h.$('#error'));
      check('the error line', !h.$('#error').hidden && h.$('#error').textContent === 'Đăng nhập không thành công: Steam không trả lời', h.$('#error').textContent);
      check('address cleaned, still the new site', location.pathname === '/next/' && location.search === '', location.href);
    `,
  },
  {
    name: 'inside the launcher: no download, overlay page, game mode, version and update',
    path: '/next/#home',
    init: LAUNCHER,
    run: `
      await h.until(() => h.$('.auth-name'));
      // As on the live site before React: its in-launcher script was refused by the CSP (main.tsx MARK_IN_LAUNCHER).
      check('no html.in-launcher (as before React)', !document.documentElement.classList.contains('in-launcher'));
      check('nothing about downloading the launcher', h.$$('.web-only').length === 0 && h.$$('a[href*="tai"]').length === 0, h.$$('.web-only').map((e) => e.id));
      check('overlay page in the menu', Boolean(h.$('.sidebar [data-nav=overlay]')));
      check('launcher version under the name', h.$('.launcher-version')?.textContent === 'Launcher v2.8.0');
      const up = h.$('.launcher-update');
      check('update button', up?.textContent === '⟳ Kiểm tra cập nhật' && !up.disabled, up?.textContent);
      h.click(up);
      check('a click looks for an update', window.__calls.updateCheck === 1);
      window.__upd = { phase: 'downloading', version: '2.9.0', percent: 40, current: '2.8.0' };
      window.__cb.update(window.__upd);
      await h.until(() => h.$('.launcher-update').textContent.startsWith('Đang tải'));
      check('downloading: disabled, percent', h.$('.launcher-update').disabled && h.$('.launcher-update').textContent === 'Đang tải v2.9.0… 40%', h.$('.launcher-update').textContent);
      window.__upd = { phase: 'ready', version: '2.9.0', current: '2.8.0' };
      window.__cb.update(window.__upd);
      await h.until(() => h.$('.launcher-update.ready'));
      check('ready: install', h.$('.launcher-update').textContent === '⬆ Cập nhật lên v2.9.0');
      h.click('.launcher-update');
      check('a click installs', window.__calls.updateInstall === 1);
      const gm = h.$('#game-mode');
      check('game mode button', gm && gm.getAttribute('aria-pressed') === 'false');
      h.click(gm);
      check('a click asks game mode on', window.__gm === true);
      window.__cb.gameMode({ on: true, keep: {} });
      await h.until(() => h.$('#game-mode').getAttribute('aria-pressed') === 'true');
      check('pressed while on', true);
      location.hash = 'overlay';
      await h.until(() => h.$('.sidebar .nav-btn.active')?.dataset.nav === 'overlay');
      check('overlay page opens', !h.$('#page-overlay').hidden);
    `,
  },
  {
    name: 'a phone: the drawer, the bottom bar',
    path: '/next/#home',
    width: 380,
    run: `
      await h.until(() => h.$('#mobile-menu-toggle'));
      const bar = h.$('.bottom-thumb-bar');
      check('bottom bar shown', bar && getComputedStyle(bar).display !== 'none');
      check('no sideways scroll', document.documentElement.scrollWidth <= 380, document.documentElement.scrollWidth);
      h.click('#mobile-menu-toggle');
      await h.until(() => h.$('#portal-sidebar').classList.contains('drawer-open'));
      check('drawer open, backdrop on', h.$('#drawer-backdrop').classList.contains('open'));
      h.click('.sidebar [data-nav=skin]');
      await h.until(() => location.hash === '#skin' && h.$('#page-skin'));
      await h.sleep(100);
      check('a page closes the drawer', !h.$('#portal-sidebar').classList.contains('drawer-open'));
      h.click('#bottom-menu-toggle');
      await h.until(() => h.$('#portal-sidebar').classList.contains('drawer-open'));
      h.click('#drawer-backdrop');
      await h.until(() => !h.$('#portal-sidebar').classList.contains('drawer-open'));
      check('the backdrop closes it', true);
      h.click('.bottom-thumb-bar [data-nav=map]');
      await h.until(() => h.$('#page-map') && !h.$('#page-map').hidden);
      check('bottom bar goes to a page', h.$('.bottom-thumb-bar .nav-btn.active')?.dataset.nav === 'map');
    `,
  },
  {
    name: 'a guest: Đăng nhập Steam, no garage count',
    path: '/next/#home',
    init: `if (location.protocol === 'http:') document.cookie = 'isle_session=; path=/; max-age=0';`,
    run: `
      await h.until(() => h.$('#auth-actions a'));
      check('Steam login link', h.$('#auth-actions a.btn-steam')?.getAttribute('href') === '/auth/steam' && h.$('#auth-actions a').textContent.trim() === 'Đăng nhập Steam');
      check('garage badge 0', h.$('#nav-gara-badge')?.textContent === '0');
      check('no shop, no bag', !h.$('[data-nav=shop]') && !h.$('[data-nav=bag]'));
      location.hash = 'bag';
      await h.sleep(300);
      await h.until(() => location.hash === '#home' && !h.$('#page-home').hidden);
      check('the bag, not open to a guest: back home', h.$('.sidebar .nav-btn.active')?.dataset.nav === 'home');
    `,
  },
];
