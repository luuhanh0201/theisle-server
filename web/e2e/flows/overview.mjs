// Tổng quan: the KPIs from the players, the alert when the server is not running, the performance
// charts and their ranges, the table, the log and its filters, the shortcuts. Read only.
export default [
  {
    name: 'Tổng quan: số liệu, cảnh báo, hiệu năng, diễn biến lọc theo loại, thao tác nhanh',
    path: '/#overview',
    wait: 3500,
    run: `
      const ps = (await h.api('/api/players')).players;
      const kills = ps.reduce((a, p) => a + (p.kills ?? 0), 0);
      check('KPI online / đã thấy', document.body.textContent.includes(ps.filter((p) => p.online).length + ' / ' + ps.length));
      check('KPI kill', h.$$('div').some((d) => d.textContent === String(kills)) && document.body.textContent.includes('Kill được quy người'));
      const st = await h.api('/api/server/status');
      check('cảnh báo khi server không chạy', st.phase === 'running' || document.body.textContent.includes('Server: '), st.phase);
      // The bridge measures every 10 s and the page asks every 10 s: on a fresh bridge, wait for the first sample.
      await h.until(() => h.$$('svg[role=img]').length > 0, 25000).catch(() => {});
      check('4 biểu đồ hiệu năng', ['ServerFPS', 'Người online', 'CPU của game', 'RAM'].every((t) => h.$$('h3').some((x) => x.textContent.startsWith(t))) && h.$$('svg[role=img]').length === 4);
      check('biểu đồ đủ rộng', h.$('svg[role=img]').getBoundingClientRect().width > 600, h.$('svg[role=img]').getBoundingClientRect().width);
      h.click(h.byText('1 giờ', 'button')); await h.sleep(1500);
      check('đổi khoảng 1 giờ', h.byText('1 giờ', 'button').getAttribute('aria-pressed') === 'true' || h.byText('1 giờ', 'button').className.includes('on'));
      h.$('details summary').click(); await h.sleep(300);
      check('bảng số liệu', h.$('details[open] table tbody tr') !== null);
      check('bảng sức chứa', document.body.textContent.includes('Sức chứa theo số người online'));
      h.click(h.byText('Chat', 'button')); await h.sleep(2500);
      const chats = (await h.api('/api/feed?limit=150&type=chat')).events;
      const kinds = [...new Set(h.$$('ul li span').filter((s) => ['Chat', 'Chết', 'Spawn', 'Vào game', 'Tăng trưởng', 'Sát thương'].includes(s.textContent)).map((s) => s.textContent))];
      check('lọc Chat: chỉ còn chat', chats.length > 0 && kinds.length === 1 && kinds[0] === 'Chat', kinds);
      h.click(h.byText('Tất cả', 'button')); await h.sleep(2500);
      check('bỏ lọc', document.body.textContent.includes('Vào game'));
      check('8 thao tác nhanh', ['#server/status', '#server/rcon', '#map', '#world/flora', '#world/fish', '#garage/stored', '#mods/messages', '#admin/audit'].every((x) => h.$('a[href="' + x + '"]')));
    `,
  },
];
