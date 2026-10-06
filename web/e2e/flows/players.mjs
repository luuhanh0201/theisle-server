// Người chơi: the list (search, filter, sort, a row opens the player), Killfeed (a kill, its scene),
// Xếp hạng, Chat (search; the super admin's delete is only looked at), Ban (no RCON: refused; edit,
// unban, reasons), Nhà tù (off: refused; on, jail, extend, release, off again), a player's page
// (#player/<id>: offline locks, a garage slot deleted, lives; an unknown id).
// LOCAL copy only (e2e/local-bridge.sh: two players, a bite, a kill, two chat lines, two bans, a prison zone).
export default [
  {
    name: 'Danh sách: mọi người chơi, tìm, lọc, sắp xếp, SteamID sao chép được',
    path: '/#players/list',
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
    path: '/#players/killfeed',
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
    path: '/#players/leaderboard',
    run: `
      const b = await h.api('/api/leaderboard');
      for (const t of ['Nhiều kill nhất', 'K/D (≥ 3 kill)', 'Gây damage', 'Giờ chơi', 'Sống lâu nhất']) check('bảng ' + t, document.body.textContent.includes(t));
      check('người đứng đầu kill', !b.kills[0] || document.body.textContent.includes(b.kills[0].name));
      check('con mồi lớn nhất', (b.biggestPrey ?? []).length === 0 || document.body.textContent.includes((b.biggestPrey.length) + ' loài'));
    `,
  },
  {
    name: 'Chat: tin hiện đủ, lệnh ! kiểu mono, tìm; admin tổng thấy nút xoá (không bấm)',
    path: '/#players/chat',
    run: `
      const lines = (await h.api('/api/chat?limit=300')).events;
      check('hiện mọi tin', lines.every((e) => document.body.textContent.includes(e.message)));
      h.type(h.$('input[type=search]'), lines[0].message.slice(0, 4)); await h.sleep(300);
      check('tìm theo nội dung', document.body.textContent.includes(lines[0].message));
      h.type(h.$('input[type=search]'), ''); await h.sleep(300);
      check('nút xoá cho admin tổng', !!h.$('button[aria-label="Xoá tin này"]') && document.body.textContent.includes('Chọn cả trang'));
    `,
  },
  {
    name: 'Ban: không có RCON thì báo lỗi, sửa lý do, gỡ ban, mẫu lý do lưu và trả lại',
    path: '/#players/bans',
    wait: 3000,
    run: `
      const before = await h.api('/api/bans');
      check('danh sách ban của game', document.body.textContent.includes('Griefer') && document.body.textContent.includes('1 đang ban · 2 tất cả'));
      h.click(h.byText('Hết hạn', 'button')); await h.sleep(300);
      check('lọc hết hạn', document.body.textContent.includes('Old Ban') && !h.$$('td b').some((b) => b.textContent === 'Griefer'));
      h.click(h.byText('Tất cả', 'button')); await h.sleep(300);
      h.type(h.$('input[aria-label="SteamID64"]'), '76561198000000077');
      h.type(h.$('#ban-reason'), 'e2e thử ban'); await h.sleep(300);
      check('xem trước tin toàn server', document.body.textContent.includes('Cả server sẽ thấy') && document.body.textContent.includes('e2e thử ban'));
      h.click(h.byText('Ban', 'button')); await h.sleep(300);
      h.click(h.$('[role=dialog] button[type=submit]')); await h.sleep(1500);
      check('RCON chưa cấu hình: báo trong hộp, không ban', (h.$('[role=dialog]')?.textContent ?? '').includes('RCON') && (await h.api('/api/bans')).bans.length === before.bans.length);
      h.click(h.byText('Huỷ', 'button')); await h.sleep(300);
      h.click(h.byText('Sửa', 'button')); await h.sleep(300);
      h.type(h.$('#be-reason'), 'Phá game (e2e)'); await h.sleep(200);
      h.click(h.$('[role=dialog] button[type=submit]')); await h.sleep(1500);
      check('đã sửa lý do', (await h.api('/api/bans')).bans.find((b) => b.steamId === '76561198000000099')?.reason === 'Phá game (e2e)');
      h.click(h.byText('Gỡ ban', 'button')); await h.sleep(300);
      h.click(h.$('[role=dialog] button[type=submit]')); await h.sleep(1500);
      const after = (await h.api('/api/bans')).bans.find((b) => b.steamId === '76561198000000099');
      check('đã gỡ ban', !after || !after.active, after);
      const box = h.$('textarea[aria-label="Mẫu lý do"]');
      h.type(box, [...before.reasons, 'Mẫu e2e'].join('\\n')); await h.sleep(200);
      h.click(h.byText('Lưu mẫu lý do', 'button')); await h.sleep(1500);
      check('lưu mẫu lý do', (await h.api('/api/bans')).reasons.includes('Mẫu e2e'));
      h.type(h.$('textarea[aria-label="Mẫu lý do"]'), before.reasons.join('\\n')); await h.sleep(200);
      h.click(h.byText('Lưu mẫu lý do', 'button')); await h.sleep(1500);
      // The bridge drops commas (the game's RCON ban line is split on them), as it always did.
      const back = (await h.api('/api/bans')).reasons;
      check('trả lại mẫu cũ', JSON.stringify(back) === JSON.stringify(before.reasons.map((r) => r.replace(/,/g, ' ').replace(/\\s+/g, ' ').trim())), back);
    `,
  },
  {
    name: 'Nhà tù: tắt thì không bỏ tù được; bật, bỏ tù, đổi án, thả, tắt lại',
    path: '/#players/prison',
    wait: 3000,
    run: `
      const before = await h.api('/api/prison');
      check('báo vùng tù', document.body.textContent.includes('Đảo tù'));
      h.type(h.$('input[aria-label="SteamID64"]'), '76561198000000012');
      h.type(h.$('input[aria-label="Tên"]'), 'Carno Tester'); await h.sleep(300);
      check('số phút gợi ý theo lỗi', h.$('#pr-minutes').value === String(before.settings.offenses[0].minutes), h.$('#pr-minutes').value);
      h.click(h.byText('Bỏ tù', 'button')); await h.sleep(300);
      check('tắt: không mở hộp xác nhận', !h.$('[role=dialog]') && document.body.textContent.includes('Nhà tù đang tắt'));
      h.$('#prs-enabled').click(); await h.sleep(200);
      h.click(h.byText('Lưu cài đặt nhà tù', 'button')); await h.sleep(1500);
      check('đã bật nhà tù', (await h.api('/api/prison')).settings.enabled === true);
      h.click(h.byText('Bỏ tù', 'button')); await h.sleep(300);
      h.click(h.$('[role=dialog] button[type=submit]')); await h.sleep(1500);
      let s = (await h.api('/api/prison')).active.find((x) => x.steamId === '76561198000000012');
      check('đã bỏ tù', !!s && s.minutes === before.settings.offenses[0].minutes, s);
      check('hiện trong danh sách đang ở tù', document.body.textContent.includes('1 người'));
      h.click(h.byText('Đổi án', 'button')); await h.sleep(300);
      h.click(h.$('[role=dialog] button[type=submit]')); await h.sleep(1500);
      const s2 = (await h.api('/api/prison')).active.find((x) => x.id === s.id);
      check('đổi án +10 phút', s2.totalSec === s.totalSec + 600, [s.totalSec, s2.totalSec]);
      h.click(h.byText('Thả', 'button')); await h.sleep(300);
      h.click(h.$('[role=dialog] button[type=submit]')); await h.sleep(1500);
      check('chờ thả', (await h.api('/api/prison')).active.find((x) => x.id === s.id)?.release === true);
      h.$('#prs-enabled').click(); await h.sleep(200);
      h.click(h.byText('Lưu cài đặt nhà tù', 'button')); await h.sleep(1500);
      check('tắt lại như cũ', (await h.api('/api/prison')).settings.enabled === before.settings.enabled);
    `,
  },
  {
    name: 'Trang người chơi: hồ sơ, thành tích, nhật ký, gara (xoá một slot), các đời dino; offline thì khoá thao tác',
    path: '/#player/76561198000000011',
    wait: 3000,
    run: `
      const d = await h.api('/api/player/76561198000000011');
      check('địa chỉ giữ nguyên', location.hash === '#player/76561198000000011');
      check('tên và SteamID', h.$('h1')?.textContent.includes('Rex Tester') && document.body.textContent.includes('76561198000000011'));
      check('Người chơi sáng trên thanh bên', h.$('nav a[aria-current=page]')?.textContent.includes('Người chơi'));
      check('thành tích', ['Kill', 'Gây damage', 'Mồi lớn nhất', 'Tin chat'].every((t) => document.body.textContent.includes(t)));
      check('nhật ký có sự kiện', h.$$('ul li').some((li) => li.textContent.includes('Tăng trưởng')));
      check('offline: nút xoá dino bị khoá', h.byText('Xoá dino hiện tại', 'button')?.disabled === true);
      check('thao tác admin báo offline', document.body.textContent.includes('Người chơi không online hoặc chưa có dino.'));
      check('gara: đủ slot', document.body.textContent.includes(d.garage.length + ' dino') && h.$$('button[title="Xoá khỏi gara"]').length === d.garage.length);
      check('các đời dino', document.body.textContent.includes(d.lives.length + ' đời dino') && document.body.textContent.includes('Đường đi'));
      h.$$('button[title="Xoá khỏi gara"]').pop().click(); await h.sleep(300);
      h.click(h.$('[role=dialog] button[type=submit]')); await h.sleep(2500);
      const after = await h.api('/api/player/76561198000000011');
      check('đã xoá một slot', after.garage.length === d.garage.length - 1, after.garage.length);
      check('trang vẽ lại', document.body.textContent.includes(after.garage.length + ' dino'));
      h.click(h.$$('[role=tab]').find((b) => b.textContent.includes('Xem tất cả'))); await h.sleep(300);
      check('xem tất cả: ba mục', ['Mức tăng trưởng mục tiêu', 'Tới người chơi online', 'Tới toạ độ bản đồ'].every((t) => document.body.textContent.includes(t)));
      const pathLink = h.$$('a').find((a) => a.textContent === 'Đường đi');
      check('Đường đi trỏ vào bản đồ React', pathLink?.getAttribute('href').startsWith('#map/path/76561198000000011/'), pathLink?.getAttribute('href'));
      pathLink.click(); await h.sleep(3000);
      check('mở bản đồ với đường đi', location.hash.startsWith('#map/path/') && (document.body.textContent.includes('Đường đi ·') || document.body.textContent.includes('Không còn đường đi')));
      location.hash = '#player/76561198999999999'; await h.sleep(2500);
      check('người chưa thấy', document.body.textContent.includes('Chưa thấy người chơi này'));
    `,
  },
  {
    name: 'Danh sách: bấm tên mở trang người chơi',
    path: '/#players/list',
    run: `
      const a = h.$$('a[href^="#player/"]').find((x) => x.textContent.includes('Carno Tester'));
      check('có link', !!a);
      a.click(); await h.sleep(2500);
      check('mở trang', location.hash === '#player/76561198000000012' && h.$('h1')?.textContent.includes('Carno Tester'));
    `,
  },
];
