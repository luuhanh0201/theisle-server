// The two panels: / is the React one, /old the one before React (kept for a while). Each links to
// the other on the same page; the old one still loads its relative files (map, images) at /old.
// A link's destination is caught (Navigation API) instead of followed: a flow cannot outlive its page.
const CATCH = `window.__to = null; navigation.addEventListener('navigate', (e) => { window.__to = e.destination.url; if (e.cancelable) e.preventDefault(); });`;
export default [
  {
    name: '/ là panel React; "Về panel cũ" mở /old đúng trang đang xem',
    path: '/#players/bans',
    wait: 3000,
    run: `${CATCH}
      check('/ là panel React', !!h.$('#root') && h.$$('h1').some((x) => x.textContent === 'Người chơi'));
      const old = h.$$('a').find((a) => a.textContent === 'Về panel cũ');
      check('link về panel cũ', old?.getAttribute('href') === '/old');
      old.click(); await h.sleep(300);
      check('đích: /old đúng trang', new URL(window.__to ?? 'x:').pathname === '/old' && new URL(window.__to).hash === '#players/bans', window.__to);
    `,
  },
  {
    name: 'Panel cũ ở /old: đúng trang theo địa chỉ, bản đồ tải được (đường dẫn tương đối), "Về panel mới" về / đúng trang',
    path: '/old#map',
    wait: 5000,
    run: `${CATCH}
      check('panel cũ, đang ở Bản đồ', !h.$('#root') && !!h.$('#to-next') && !h.$('[data-view="map"]').hidden);
      check('bản đồ cũ tải được ở /old', h.$('#map-msg')?.hidden === true, h.$('#map-msg')?.textContent);
      check('logo tải được', h.$('img.brand-logo')?.naturalWidth > 0);
      h.$('#to-next').click(); await h.sleep(300);
      check('đích: / đúng trang', new URL(window.__to ?? 'x:').pathname === '/' && new URL(window.__to).hash === '#map', window.__to);
    `,
  },
];
