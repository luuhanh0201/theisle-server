// Tính năng mod: every sub-page loads the server's values, a change saves (read back from the
// bridge), and is put back. Steps run in the page: h.* (e2e/run.mjs), check(name, ok, got).
const saveAndWait = `h.click(h.byText('Lưu cài đặt')); await h.sleep(1200);`;
export default [
  {
    name: 'Lệnh chat: cooldown và bật / tắt lệnh',
    path: '/next/#mods/commands',
    run: `
      const before = await h.api('/api/commands-settings');
      check('hiện đúng giá trị !slay', h.value('Chờ giữa hai lần !slay') === String(before.slayCooldown), h.value('Chờ giữa hai lần !slay'));
      check('nút Lưu tắt khi chưa đổi', h.byText('Lưu cài đặt').disabled);
      h.click(h.plus('Chờ giữa hai lần !slay'));
      h.switchFor('!food').click();
      await h.sleep(200);
      check('thanh "chưa lưu" hiện', !!h.byText('Lưu', 'button') && document.body.textContent.includes('chưa lưu'));
      ${saveAndWait}
      const after = await h.api('/api/commands-settings');
      check('đã lưu slayCooldown +1', after.slayCooldown === before.slayCooldown + 1, after.slayCooldown);
      check('đã lưu !food tắt / bật', after.enabled.food === !before.enabled.food, after.enabled);
      h.click(h.minus('Chờ giữa hai lần !slay'));
      h.switchFor('!food').click();
      await h.sleep(200);
      ${saveAndWait}
      const back = await h.api('/api/commands-settings');
      check('trả lại như cũ', JSON.stringify(back) === JSON.stringify(before), back);
      check('không còn "Có thay đổi mới"', !document.body.textContent.includes('Có thay đổi mới'));
    `,
  },
  {
    name: 'Ptera gắp: công tắc và số',
    path: '/next/#mods/ptera',
    run: `
      const before = await h.api('/api/ptera-carry');
      check('hiện maxKg', h.value('Cân nặng tối đa') === String(before.maxKg), h.value('Cân nặng tối đa'));
      h.click(h.plus('Cân nặng tối đa'));
      h.$('#pt-enabled').click();
      await h.sleep(200);
      ${saveAndWait}
      const after = await h.api('/api/ptera-carry');
      check('đã lưu maxKg +5 và công tắc', after.maxKg === before.maxKg + 5 && after.enabled === !before.enabled, after);
      h.click(h.minus('Cân nặng tối đa'));
      h.$('#pt-enabled').click();
      await h.sleep(200);
      ${saveAndWait}
      check('trả lại như cũ', JSON.stringify(await h.api('/api/ptera-carry')) === JSON.stringify(before));
    `,
  },
  {
    name: 'Tele con non: 6 số, gõ tay và giới hạn',
    path: '/next/#mods/tele',
    run: `
      const before = await h.api('/api/tele-settings');
      const box = h.$('#tl-maxGrowthPct');
      h.typeNum(box, '150');
      await h.sleep(200);
      check('gõ 150 thì về tối đa 100', box.value === '100', box.value);
      ${saveAndWait}
      check('đã lưu 100', (await h.api('/api/tele-settings')).maxGrowthPct === 100);
      h.typeNum(box, String(before.maxGrowthPct));
      await h.sleep(200);
      ${saveAndWait}
      check('trả lại như cũ', JSON.stringify(await h.api('/api/tele-settings')) === JSON.stringify(before));
    `,
  },
  {
    name: 'Voice gần: ô chọn kiểu hệ thống',
    path: '/next/#mods/voice',
    run: `
      const before = await h.api('/api/voice-settings');
      const btn = h.$('#vs-name-mode');
      check('không dùng select của trình duyệt', !h.$('select'));
      btn.click(); await h.sleep(200);
      const opts = h.$$('[role=option]');
      check('mở danh sách 3 lựa chọn', opts.length === 3, opts.length);
      const other = opts.find((o) => o.getAttribute('aria-selected') !== 'true');
      other.click(); await h.sleep(200);
      check('đổi chú thích theo lựa chọn', btn.textContent.trim() === other.textContent.trim());
      ${saveAndWait}
      const after = await h.api('/api/voice-settings');
      check('đã lưu nameMode', after.nameMode !== before.nameMode, after.nameMode);
      btn.click(); await h.sleep(200);
      h.$$('[role=option]').find((o) => o.textContent.includes(before.nameMode === 'id' ? 'Chỉ hiện mã' : before.nameMode === 'name' ? 'Hiện tên' : 'Không hiện')).click();
      await h.sleep(200);
      ${saveAndWait}
      check('trả lại như cũ', (await h.api('/api/voice-settings')).nameMode === before.nameMode);
    `,
  },
  {
    name: 'Thông báo: mốc, định kỳ, sửa tin, tắt tin, tìm',
    path: '/next/#mods/messages',
    run: `
      const before = await h.api('/api/messages');
      check('đếm tin đúng', document.body.textContent.includes(before.catalog.length + ' tin'));
      const search = h.$('input[type=search]');
      h.type(search, 'tele.done'); await h.sleep(200);
      check('tìm ra 1 tin', h.$$('textarea').length === 1, h.$$('textarea').length);
      const area = h.$('textarea');
      h.type(area, 'Đã tới chỗ {name} rồi'); await h.sleep(200);
      check('ví dụ điền biến', document.body.textContent.includes('Ví dụ: Đã tới chỗ Rex rồi'));
      check('nhãn đã sửa', !!h.byText('đã sửa'));
      h.type(search, ''); await h.sleep(200);
      const marks = h.$('#msg-marks');
      h.type(marks, '10p, 1p, 10s'); await h.sleep(100);
      h.click(h.byText('+ Thêm thông báo định kỳ')); await h.sleep(200);
      const rows = h.$$('input[aria-label="Nội dung thông báo định kỳ"]');
      h.type(rows[rows.length - 1], 'Thử e2e'); await h.sleep(100);
      h.click(h.byText('Lưu thông báo')); await h.sleep(1500);
      check('biến không có trong tin: báo lỗi đỏ, không lưu', h.$$('[role=status] div').some((d) => d.textContent.includes('{name} is not available')),
        h.$$('[role=status] div').map((d) => d.textContent));
      check('chưa lưu gì', JSON.stringify((await h.api('/api/messages')).countdownMarks) === JSON.stringify(before.countdownMarks));
      h.type(h.$('input[type=search]'), 'tele.done'); await h.sleep(200);
      h.type(h.$('textarea'), 'Đã tới chỗ người đưa mã rồi'); await h.sleep(200);
      h.type(h.$('input[type=search]'), ''); await h.sleep(200);
      h.click(h.byText('Lưu thông báo')); await h.sleep(1500);
      const after = await h.api('/api/messages');
      check('lưu mốc', JSON.stringify(after.countdownMarks) === JSON.stringify([600, 60, 10]), after.countdownMarks);
      check('lưu tin đã sửa', after.texts['tele.done'] === 'Đã tới chỗ người đưa mã rồi', after.texts['tele.done']);
      check('thêm thông báo định kỳ', after.periodic.some((p) => p.text === 'Thử e2e'), after.periodic.length);
      // Put everything back through the page.
      h.type(h.$('input[type=search]'), 'tele.done'); await h.sleep(200);
      h.click(h.byText('Về mặc định')); await h.sleep(100);
      h.type(h.$('input[type=search]'), ''); await h.sleep(200);
      h.type(h.$('#msg-marks'), before.countdownMarks.map((s) => (s >= 60 && s % 60 === 0 ? s / 60 + 'p' : s + 's')).join(', '));
      for (const li of h.$$('input[aria-label="Nội dung thông báo định kỳ"]').filter((i) => i.value === 'Thử e2e').map((i) => i.closest('li')).reverse()) {
        [...li.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Xoá').click(); await h.sleep(150);
      }
      h.click(h.byText('Lưu thông báo')); await h.sleep(1500);
      const back = await h.api('/api/messages');
      const pick = (m) => JSON.stringify({ texts: m.texts, marks: m.countdownMarks, periodic: m.periodic, cw: m.corpseWipe });
      check('trả lại như cũ', pick(back) === pick(before), pick(back).slice(0, 200));
    `,
  },
];
