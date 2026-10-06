// Người chơi: the list (search, filter, sort, a row opens the player), Killfeed (a kill, its scene),
// Xếp hạng, Chat (search; the super admin's delete is only looked at). Ban and Nhà tù as they move.
// LOCAL copy only (e2e/local-bridge.sh: two players, a bite, a kill, two chat lines).
export default [
  {
    name: 'Danh sách: mọi người chơi, tìm, lọc, sắp xếp, SteamID sao chép được',
    path: '/next/#players/list',
    run: `
      const ps = (await h.api('/api/players')).players;
      check('hiện mọi người chơi', ps.every((p) => document.body.textContent.includes(p.name ?? p.steamId)));
      check('đếm', document.body.textContent.includes(ps.length + ' người chơi'));
      const box = h.$('input[type=search]');
      h.type(box, 'carno'); await h.sleep(300);
      const rows = () => h.$$('tbody tr').filter((tr) => !tr.textContent.includes('Không tìm thấy'));
      check('tìm theo loài', rows().length === ps.filter((p) => /carno/i.test(p.species ?? '')).length, rows().length);
      h.type(box, ''); await h.sleep(300);
      h.click(h.byText('Offline', 'button')); await h.sleep(300);
      check('lọc offline', rows().length === ps.filter((p) => !p.online).length, rows().length);
      h.click(h.byText('Tất cả', 'button')); await h.sleep(300);
      h.click([...document.querySelectorAll('th button')].find((b) => b.textContent.startsWith('K / D'))); await h.sleep(300);
      const first = rows()[0].textContent;
      const top = [...ps].sort((a, b) => (b.kills / Math.max(1, b.deaths)) - (a.kills / Math.max(1, a.deaths)) || b.kills - a.kills)[0];
      check('sắp K/D giảm dần', first.includes(top.name), first.slice(0, 40));
      check('có nút sao chép SteamID', !!h.$('button[aria-label^="Sao chép SteamID"]'));
      const link = h.$('tbody a[href^="#player/"]');
      check('tên dẫn tới trang người chơi', !!link && link.getAttribute('href') === '#player/' + rows()[0].querySelector('a').getAttribute('href').slice(8));
    `,
  },
  {
    name: 'Killfeed: lần giết hiện đủ, tìm, mở hiện trường',
    path: '/next/#players/killfeed',
    run: `
      const evs = (await h.api('/api/killfeed?limit=200')).events;
      const k = evs.find((e) => e.attributed && e.killer);
      check('có lần giết', !!k && document.body.textContent.includes((k.killerName) + ' đã giết'), evs.length);
      check('dòng phụ: loài, đòn cuối', document.body.textContent.includes('đòn cuối'));
      h.type(h.$('input[type=search]'), 'không-có-ai'); await h.sleep(300);
      check('tìm không thấy', document.body.textContent.includes('Không tìm thấy sự kiện hạ gục nào'));
      h.type(h.$('input[type=search]'), ''); await h.sleep(300);
      const pin = h.$$('button').find((b) => b.textContent.startsWith('📍'));
      check('có nút hiện trường', !!pin);
      h.click(pin); await h.sleep(2500);
      const dlg = h.$('[role=dialog]');
      check('mở hiện trường', !!dlg && dlg.textContent.includes(k.killerName + ' giết'));
      check('vẽ bản đồ (không báo lỗi)', !!dlg.querySelector('canvas') && !dlg.textContent.includes('Không hiện được bản đồ'));
      h.click([...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Xem chi tiết giao chiến')); await h.sleep(300);
      check('chi tiết giao chiến', ['Dino tham gia', 'Không có đòn PvP', 'có trước khi panel lưu hiện trường.'].some((x) => dlg.textContent.includes(x)));
      h.click(dlg.querySelector('button[aria-label="Đóng"]')); await h.sleep(300);
      check('đóng hiện trường', !h.$('[role=dialog]'));
    `,
  },
  {
    name: 'Xếp hạng: năm bảng và con mồi lớn nhất',
    path: '/next/#players/leaderboard',
    run: `
      const b = await h.api('/api/leaderboard');
      for (const t of ['Nhiều kill nhất', 'K/D (≥ 3 kill)', 'Gây damage', 'Giờ chơi', 'Sống lâu nhất']) check('bảng ' + t, document.body.textContent.includes(t));
      check('người đứng đầu kill', !b.kills[0] || document.body.textContent.includes(b.kills[0].name));
      check('con mồi lớn nhất', (b.biggestPrey ?? []).length === 0 || document.body.textContent.includes((b.biggestPrey.length) + ' loài'));
    `,
  },
  {
    name: 'Chat: tin hiện đủ, lệnh ! kiểu mono, tìm; admin tổng thấy nút xoá (không bấm)',
    path: '/next/#players/chat',
    run: `
      const lines = (await h.api('/api/chat?limit=300')).events;
      check('hiện mọi tin', lines.every((e) => document.body.textContent.includes(e.message)));
      h.type(h.$('input[type=search]'), lines[0].message.slice(0, 4)); await h.sleep(300);
      check('tìm theo nội dung', document.body.textContent.includes(lines[0].message));
      h.type(h.$('input[type=search]'), ''); await h.sleep(300);
      check('nút xoá cho admin tổng', !!h.$('button[aria-label="Xoá tin này"]') && document.body.textContent.includes('Chọn cả trang'));
    `,
  },
];
