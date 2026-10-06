// Quản trị: panel access (add a range, read back, put back), the admin log (search, pages, a line
// deleted by the super admin), Discord (switch, a route, the relay URL: saved and put back; no
// webhook is ever added or tested here). LOCAL copy only.
export default [
  {
    name: 'Truy cập panel: thêm một dải IP, lưu, trả lại',
    path: '/next/#admin/access',
    run: `
      const before = (await h.api('/api/panel-access')).ips;
      check('hiện danh sách đang cho phép', before.every((ip) => document.body.textContent.includes(ip)));
      h.type(h.$('#pa-ips'), [...before, '10.99.0.0/24'].join('\\n')); await h.sleep(200);
      h.click(h.byText('Lưu danh sách', 'button')); await h.sleep(1500);
      check('đã lưu dải mới', (await h.api('/api/panel-access')).ips.includes('10.99.0.0/24'));
      h.type(h.$('#pa-ips'), before.join('\\n')); await h.sleep(200);
      h.click(h.byText('Lưu danh sách', 'button')); await h.sleep(1500);
      check('trả lại như cũ', JSON.stringify((await h.api('/api/panel-access')).ips) === JSON.stringify(before));
    `,
  },
  {
    name: 'Nhật ký admin: tên thao tác tiếng Việt, tìm, sang trang, xoá một dòng (admin tổng)',
    path: '/next/#admin/audit',
    wait: 3000,
    run: `
      const first = await h.api('/api/server/audit?page=1&limit=30');
      check('đếm dòng', document.body.textContent.includes(first.total + ' dòng'));
      check('tên thao tác đã dịch (Lưu cài đặt…)', h.$$('td').some((td) => /^(✗ )?(Lưu|Đổi|Đăng|Xoá|Thêm|Tạo|RCON|🎮)/.test(td.textContent)));
      const search = h.$('input[type=search]');
      h.type(search, 'Tele settings'); await h.sleep(1200);
      const found = await h.api('/api/server/audit?page=1&limit=30&q=' + encodeURIComponent('Tele settings'));
      check('tìm: đúng số dòng', document.body.textContent.includes(found.total + ' dòng'), found.total);
      h.type(search, ''); await h.sleep(1200);
      if (first.pages > 1) {
        h.click(h.byText('2', 'button')); await h.sleep(1200);
        check('sang trang 2', document.body.textContent.includes('trang 2/'));
      } else check('một trang (bỏ qua chuyển trang)', true);
      // Delete the newest line (the test's own "panel access saved"), the super admin's tool.
      h.click(h.byText('1', 'button')); await h.sleep(1200);
      const top = (await h.api('/api/server/audit?page=1&limit=30')).entries[0];
      const btn = h.$('button[aria-label="Xoá dòng này"]');
      check('có nút xoá (admin tổng)', !!btn);
      btn.click(); await h.sleep(300);
      h.click(h.$('[role=dialog] button[type=submit]')); await h.sleep(1500);
      const after = (await h.api('/api/server/audit?page=1&limit=30')).entries;
      check('dòng đã bị xoá', !after.some((e) => e.key === top.key));
    `,
  },
  {
    name: 'Discord: bật / tắt, trạm ngoài, lưu và trả lại (không đụng webhook)',
    path: '/next/#admin/discord',
    run: `
      const before = await h.api('/api/discord');
      h.$('#dc-enabled').click();
      h.type(h.$('#dc-relay-url'), 'https://relay-e2e.example.workers.dev'); await h.sleep(200);
      h.click(h.byText('Lưu Discord', 'button')); await h.sleep(1500);
      check('thiếu mã bí mật của trạm: báo lỗi, không lưu', h.$$('[role=status] div').some((d) => d.textContent.includes('mã bí mật')) && (await h.api('/api/discord')).enabled === before.enabled);
      h.type(h.$('#dc-relay-secret'), 'e2e-secret-0123456789abcdef'); await h.sleep(200);
      h.click(h.byText('Lưu Discord', 'button')); await h.sleep(1500);
      const after = await h.api('/api/discord');
      check('đã lưu công tắc và URL trạm', after.enabled === !before.enabled && after.relay?.url === 'https://relay-e2e.example.workers.dev', { enabled: after.enabled, relay: after.relay });
      h.$('#dc-enabled').click();
      h.type(h.$('#dc-relay-url'), before.relay?.url ?? ''); await h.sleep(200);
      h.click(h.byText('Lưu Discord', 'button')); await h.sleep(1500);
      const back = await h.api('/api/discord');
      check('trả lại như cũ', back.enabled === before.enabled && (back.relay?.url ?? '') === (before.relay?.url ?? ''), { enabled: back.enabled, relay: back.relay });
      check('URL webhook không bao giờ hiện ra', !document.body.innerHTML.includes('discord.com/api/webhooks/1'));
    `,
  },
];
