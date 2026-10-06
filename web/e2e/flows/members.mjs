// Thành viên: the Game.ini lists (add / remove, read back), the permissions page (a switch off the
// role, saved, put back), SVip (add, a release level through its confirm, put back). LOCAL copy only.
const TEST_ID = '76561190000000777';
export default [
  {
    name: 'VIP: thêm, sai SteamID bị chặn, bỏ',
    path: '/next/#members/vips',
    run: `
      const box = h.$('#mb-vips-id');
      h.type(box, '123'); h.click(h.byText('Thêm', 'button')); await h.sleep(300);
      check('SteamID sai: báo lỗi', h.$$('[role=status] div').some((d) => d.textContent.includes('17 chữ số')));
      h.type(box, '${TEST_ID}'); h.click(h.byText('Thêm', 'button')); await h.sleep(1500);
      check('đã thêm vào Game.ini', (await h.api('/api/members')).vips.includes('${TEST_ID}'));
      check('hiện trong bảng', document.body.textContent.includes('${TEST_ID}'));
      check('ô nhập được xoá', h.$('#mb-vips-id').value === '');
      const row = h.$$('tr').find((r) => r.textContent.includes('${TEST_ID}'));
      [...row.querySelectorAll('button')].find((b) => b.textContent === 'Bỏ').click(); await h.sleep(1500);
      check('đã bỏ', !(await h.api('/api/members')).vips.includes('${TEST_ID}'));
    `,
  },
  {
    name: 'Admin: admin cố định không có nút Bỏ',
    path: '/next/#members/admins',
    run: `
      const m = await h.api('/api/members');
      const fixed = [...(m.owners ?? []), m.superAdmin].filter(Boolean).find((id) => m.admins.includes(id));
      if (fixed) { const row = h.$$('tr').find((r) => r.textContent.includes(fixed)); check('cố định', row?.textContent.includes('cố định')); }
      else check('không có admin cố định trong danh sách (bỏ qua)', true);
      check('hiện đủ admin', m.admins.every((id) => document.body.textContent.includes(id)));
    `,
  },
  {
    name: 'Whitelist: bật / tắt lưu Game.ini, trả lại',
    path: '/next/#members/whitelist',
    run: `
      const before = (await h.api('/api/members')).whitelistOn;
      h.$('[aria-label="Chỉ cho whitelist vào"]').click(); await h.sleep(200);
      h.$$('[role=option]').find((o) => o.getAttribute('aria-selected') !== 'true').click(); await h.sleep(1500);
      check('đã đổi', (await h.api('/api/members')).whitelistOn === !before);
      h.$('[aria-label="Chỉ cho whitelist vào"]').click(); await h.sleep(200);
      h.$$('[role=option]').find((o) => o.getAttribute('aria-selected') !== 'true').click(); await h.sleep(1500);
      check('trả lại như cũ', (await h.api('/api/members')).whitelistOn === before);
    `,
  },
  {
    name: 'Phân quyền: mở thẳng địa chỉ, tắt một quyền khỏi vai trò, lưu, trả lại',
    path: '/next/#members/perms',
    run: `
      check('mở thẳng #members/perms vẫn đúng trang', location.hash === '#members/perms' && document.body.textContent.includes('Phân quyền admin'));
      const data = await h.api('/api/permissions');
      const a = data.admins.find((x) => !x.super);
      const card = h.$('[data-perm-id="' + a.steamId + '"]');
      const sw = card.querySelector('[aria-label="Xem nhà tù"]');
      const was = sw.checked;
      sw.click(); await h.sleep(200);
      check('đánh dấu ngoài vai trò', card.textContent.includes(was ? 'đã tắt khỏi vai trò' : 'thêm ngoài vai trò'));
      [...card.querySelectorAll('button')].find((b) => b.textContent.startsWith('Lưu quyền')).click(); await h.sleep(1500);
      const after = (await h.api('/api/permissions')).admins.find((x) => x.steamId === a.steamId).perm;
      check('đã lưu ngoại lệ', was ? after.deny.includes('prison.view') : after.allow.includes('prison.view'), after);
      const card2 = h.$('[data-perm-id="' + a.steamId + '"]');
      card2.querySelector('[aria-label="Xem nhà tù"]').click(); await h.sleep(200);
      [...card2.querySelectorAll('button')].find((b) => b.textContent.startsWith('Lưu quyền')).click(); await h.sleep(1500);
      check('trả lại như cũ', JSON.stringify((await h.api('/api/permissions')).admins.find((x) => x.steamId === a.steamId).perm) === JSON.stringify(a.perm));
    `,
  },
  {
    name: 'SVip: thêm kèm ghi chú, đổi mức phát hành qua hộp xác nhận, trả lại',
    path: '/next/#members/svip',
    run: `
      const before = await h.api('/api/svip');
      h.type(h.$('#sv-id'), '${TEST_ID}'); h.type(h.$('#sv-note'), 'e2e'); h.click(h.byText('Thêm SVip', 'button')); await h.sleep(1500);
      const added = (await h.api('/api/svip')).players.find((p) => p.steamId === '${TEST_ID}');
      check('đã thêm, có ghi chú và thời điểm', added?.note === 'e2e' && added.addedAt > 0, added);
      const f = before.features[0];
      const target = f.mode === 'admin' ? 'testing' : 'admin';
      h.$$('[data-level="' + target + '"]')[0].click(); await h.sleep(300);
      check('hỏi xác nhận', !!h.$('[role=dialog]'));
      h.click(h.$('[role=dialog] button[type=submit]')); await h.sleep(1500);
      check('đã đổi mức', (await h.api('/api/svip')).features[0].mode === target);
      h.$$('[data-level="' + f.mode + '"]')[0].click(); await h.sleep(300);
      h.click(h.$('[role=dialog] button[type=submit]')); await h.sleep(1500);
      const row = h.$$('tr').find((r) => r.textContent.includes('${TEST_ID}'));
      [...row.querySelectorAll('button')].find((b) => b.textContent === 'Bỏ').click(); await h.sleep(1500);
      const back = await h.api('/api/svip');
      check('trả lại như cũ', JSON.stringify(back.features) === JSON.stringify(before.features) && back.players.length === before.players.length);
    `,
  },
];
