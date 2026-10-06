// Gara: the list searches; the creator makes a dino into a player's garage (read back from the
// bridge, then deleted from the list); the settings save and are put back. On a LOCAL copy only.
const TEST_SLOT = 'e2etest';
export default [
  {
    name: 'Danh sách: đếm, tìm theo loài và theo SteamID',
    path: '/next/#garage/stored',
    wait: 3500,
    run: `
      const idx = await h.api('/api/garage');
      const total = Object.values(idx.players).reduce((n, s) => n + Object.keys(s).length, 0);
      check('đếm slot đúng', document.body.textContent.includes(total + ' slot'), total);
      const search = h.$('input[type=search]');
      h.type(search, 'Tyrannosaurus'); await h.sleep(200);
      const rexes = Object.values(idx.players).reduce((n, s) => n + Object.values(s).filter((m) => m.classPath.includes('Tyrannosaurus')).length, 0);
      const cards = () => h.$$('button[title="Xoá khỏi gara"]').length;
      check('tìm theo loài', cards() === rexes, [cards(), rexes]);
      const first = Object.keys(idx.players)[0];
      h.type(search, first); await h.sleep(200);
      check('tìm theo SteamID', cards() === Object.keys(idx.players[first]).length, cards());
      h.type(search, 'khongcoainhuthe'); await h.sleep(200);
      check('không thấy thì báo', document.body.textContent.includes('Không tìm thấy dino nào'));
    `,
  },
  {
    name: 'Tạo dino: người chơi, loài, growth, prime, mutation, gửi; đọc lại; xoá từ danh sách',
    path: '/next/#garage/stored',
    wait: 3500,
    run: `
      const players = (await h.api('/api/players')).players;
      const p = players.find((x) => x.name) ?? players[0];
      const steam = h.$('#f-steam');
      h.type(steam, p.steamId); await h.sleep(300);
      check('gợi ý tên người nhận', document.body.textContent.includes('Gửi cho'));
      h.type(h.$('#f-slot'), '${TEST_SLOT}'); await h.sleep(200);
      h.$$('#creator-card button').find((b) => b.textContent.includes('Tyrannosaurus') && b.textContent.includes('mutation đã thấy')).click(); await h.sleep(800);
      check('xem trước hiện loài', h.$$('#creator-card [class*=title]').some((e) => e.textContent === 'Tyrannosaurus'));
      h.$$('#creator-card button').find((b) => b.textContent.includes('Sub-adult') && b.textContent.includes('75%')).click(); await h.sleep(300);
      check('growth 75%', document.body.textContent.includes('75%'));
      h.$('#f-prime').click(); await h.sleep(300);
      const count = h.$$('#creator-card input[type=checkbox]:not([role=switch])').filter((c) => c.checked && c.closest('label')?.textContent.match(/^\\d+\\./)).length;
      check('bật prime thì đủ ít nhất 5 nhiệm vụ', count >= 5, count);
      h.$('#f-mut-Slot1').click(); await h.sleep(300);
      const opt = h.$$('[role=option]').find((o) => o.getAttribute('aria-disabled') !== 'true' && o.textContent && !o.textContent.startsWith('trống'));
      const mutName = opt?.querySelector('span')?.textContent ?? '';
      opt?.click(); await h.sleep(300);
      check('chọn được mutation Slot 1', !!mutName && h.$('#f-mut-Slot1').textContent.includes(mutName.replace(/ ⚠$/, '')), mutName);
      check('có nút ! tra cứu', !!h.$('[data-mut-tip]'));
      h.$('[data-mut-tip]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await h.sleep(300);
      const tip = h.$('[role=tooltip]');
      check('rê chuột: hiện mô tả và bằng chứng trên server', !!tip && tip.textContent.includes('Trên server này'), tip?.textContent.slice(0, 80));
      h.$('[data-mut-tip]').dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); await h.sleep(200);
      check('rời chuột: tắt', !h.$('[role=tooltip]'));
      h.click(h.$$('#creator-card button[type=submit]')[0]); await h.sleep(1800);
      const res = h.$$('#creator-card div').map((d) => d.textContent).find((t) => t.startsWith('✓ Đã tạo') || t.startsWith('Lỗi'));
      check('tạo thành công', res?.startsWith('✓ Đã tạo'), res);
      const g = await h.api('/api/garage/' + p.steamId);
      const meta = g.slots['${TEST_SLOT}'];
      check('slot có trong gara của người chơi', !!meta && meta.classPath.includes('Tyrannosaurus') && Math.abs(meta.growth - 0.75) < 0.001, meta);
      // Same name again: the red box, the button blocked until the overwrite is ticked.
      await h.sleep(5500);
      check('trùng tên: hộp đỏ ghi đè', document.body.textContent.includes('Tạo dino mới sẽ thay thế con này'));
      check('nút bị khoá tới khi tick', h.$$('#creator-card button[type=submit]')[0].disabled);
      // Delete it from the list.
      window.scrollTo(0, 0);
      h.type(h.$('input[type=search]'), '${TEST_SLOT}'); await h.sleep(300);
      h.$('button[title="Xoá khỏi gara"]').click(); await h.sleep(300);
      check('hỏi xác nhận', document.body.textContent.includes('Xoá dino khỏi gara?'));
      h.click(h.byText('Xoá khỏi gara', 'button')); await h.sleep(1500);
      check('đã xoá', !(await h.api('/api/garage/' + p.steamId)).slots['${TEST_SLOT}']);
    `,
  },
  {
    name: 'Cài đặt gara: chọn vị trí, bảng theo mức thành viên, lưu và trả lại',
    path: '/next/#garage/settings',
    run: `
      const before = await h.api('/api/garage-settings');
      const pick = (o) => ({ redeemAt: o.redeemAt, maxSlots: o.maxSlots, storeCountdown: o.storeCountdown, cooldown: o.cooldown, minHealthPct: o.minHealthPct, minGrowthPct: o.minGrowthPct, tiers: o.tiers });
      h.$('[aria-label="VIP: số ô gara"]').parentElement.querySelector('[aria-label="Tăng"]').click();
      h.click(h.plus('Thời gian đếm ngược khi cất'));
      h.$('#gs-redeem-at').click(); await h.sleep(200);
      const other = h.$$('[role=option]').find((o) => o.getAttribute('aria-selected') !== 'true'); other.click(); await h.sleep(200);
      h.click(h.byText('Lưu cài đặt', 'button')); await h.sleep(1500);
      const after = await h.api('/api/garage-settings');
      check('đã lưu VIP +1, đếm ngược +1, vị trí', after.tiers.vip.maxSlots === before.tiers.vip.maxSlots + 1 && after.storeCountdown === before.storeCountdown + 1 && after.redeemAt !== before.redeemAt, pick(after));
      h.$('[aria-label="VIP: số ô gara"]').parentElement.querySelector('[aria-label="Giảm"]').click();
      h.click(h.minus('Thời gian đếm ngược khi cất'));
      h.$('#gs-redeem-at').click(); await h.sleep(200);
      h.$$('[role=option]')[['current', 'stored', 'choice'].indexOf(before.redeemAt)].click(); await h.sleep(200);
      h.click(h.byText('Lưu cài đặt', 'button')); await h.sleep(1500);
      check('trả lại như cũ', JSON.stringify(pick(await h.api('/api/garage-settings'))) === JSON.stringify(pick(before)));
    `,
  },
];
