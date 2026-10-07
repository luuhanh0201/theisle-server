// The panel's addresses: / is the React panel (the only one since 2026-10-07); /next/, where it was
// tried first, still opens it; /old (the panel before React, removed) goes to / on the same page.
export default [
  {
    name: '/ là panel React, không còn link về panel cũ',
    path: '/#players/bans',
    wait: 3000,
    run: `
      check('/ là panel React', !!h.$('#root') && h.$$('h1').some((x) => x.textContent === 'Người chơi'));
      check('không còn "Về panel cũ"', !h.$$('a').some((a) => a.textContent === 'Về panel cũ' || (a.getAttribute('href') ?? '').startsWith('/old')));
    `,
  },
  {
    name: 'Địa chỉ /old cũ (bookmark): về panel React, đúng trang đang xem',
    path: '/old#map',
    wait: 4000,
    run: `
      check('đã về /', location.pathname === '/', location.pathname);
      check('giữ trang #map', location.hash.startsWith('#map'), location.hash);
      check('panel React, đang ở Bản đồ', !!h.$('#root') && h.$$('h1').some((x) => x.textContent === 'Bản đồ trực tiếp'));
    `,
  },
  {
    name: '/next/ vẫn mở panel React',
    path: '/next/#overview',
    wait: 3000,
    run: `
      check('/next/ là panel React', !!h.$('#root') && h.$$('h1').some((x) => x.textContent === 'Tổng quan'));
    `,
  },
];
