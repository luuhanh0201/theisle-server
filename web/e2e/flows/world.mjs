// Thế giới: the overview cards show the bridge's numbers; Thực vật and Cá save and are put back.
const save = `h.click(h.byText('Lưu cài đặt')); await h.sleep(1500);`;
export default [
  {
    name: 'Tổng quan: 5 thẻ, số liệu từ bridge, nút dẫn tới trang cài đặt',
    path: '/#world/overview',
    wait: 3500,
    run: `
      const flora = await h.api('/api/flora-settings'); const fish = await h.api('/api/fish-settings');
      for (const t of ['AI', 'Di cư', 'Ngày đêm', 'Thực vật', 'Cá']) check('thẻ ' + t, h.$$('h2').some((e) => e.textContent === t));
      check('cá: số loài', document.body.textContent.includes(fish.settings.species.length + '/6 loài'));
      check('thực vật: tối đa cây/khóm', document.body.textContent.includes('tối đa ' + flora.settings.migrationMaxPerArea + ' cây/khóm'));
      check('nút Cài đặt cá dẫn tới #world/fish', h.byText('Cài đặt cá').closest('a').getAttribute('href') === '#world/fish');
      h.byText('Cài đặt thực vật').click(); await h.sleep(800);
      check('bấm thì sang trang Thực vật', location.hash === '#world/flora' && !!h.$('#fl-control'), location.hash);
    `,
  },
  {
    name: 'Thực vật: công tắc, số, thống kê, lưu và trả lại',
    path: '/#world/flora',
    run: `
      const before = (await h.api('/api/flora-settings')).settings;
      check('hiện % di cư', h.value('Di cư: % cây có chất') === String(before.migrationNutrientPct));
      check('có dòng thống kê mod', document.body.textContent.includes('Dữ liệu cây') || document.body.textContent.includes('Lượt gần nhất') || document.body.textContent.includes('Chưa có dữ liệu'));
      h.click(h.plus('Di cư: tối đa cây mỗi khóm')); h.$('#fl-control').click(); await h.sleep(200);
      ${save}
      const after = (await h.api('/api/flora-settings')).settings;
      check('đã lưu', after.migrationMaxPerArea === before.migrationMaxPerArea + 1 && after.control === !before.control, after);
      check('toast đã lưu', h.$$('[role=status] div').some((d) => d.textContent.includes('~15 giây')));
      h.click(h.minus('Di cư: tối đa cây mỗi khóm')); h.$('#fl-control').click(); await h.sleep(200);
      ${save}
      check('trả lại như cũ', JSON.stringify((await h.api('/api/flora-settings')).settings) === JSON.stringify(before));
      await h.sleep(2500);
      check('số liệu sống không bật nhầm "Có thay đổi mới"', !document.body.textContent.includes('Có thay đổi mới'));
    `,
  },
  {
    name: 'Cá: số thập phân, chọn loài, lưu (RCON local không có) và trả lại',
    path: '/#world/fish',
    run: `
      const before = (await h.api('/api/fish-settings')).settings;
      h.click(h.plus('Giây giữa hai lần sinh')); await h.sleep(100);
      check('bước 0,1 không lệch số', h.value('Giây giữa hai lần sinh') === String(Math.round((before.cooldownSec + 0.1) * 10) / 10), h.value('Giây giữa hai lần sinh'));
      const tile = h.$$('label').find((l) => l.textContent.trim() === 'Forktail');
      tile.querySelector('input').click(); await h.sleep(200);
      ${save}
      const after = (await h.api('/api/fish-settings')).settings;
      check('đã lưu thời gian sinh', after.cooldownSec === Math.round((before.cooldownSec + 0.1) * 10) / 10, after.cooldownSec);
      check('đã lưu loài Forktail', after.species.includes('Forktail') !== before.species.includes('Forktail'), after.species);
      check('toast nói về RCON / restart', h.$$('[role=status] div').some((d) => d.textContent.startsWith('Đã lưu')), h.$$('[role=status] div').map((d) => d.textContent));
      h.click(h.minus('Giây giữa hai lần sinh'));
      h.$$('label').find((l) => l.textContent.trim() === 'Forktail').querySelector('input').click(); await h.sleep(200);
      ${save}
      const back = (await h.api('/api/fish-settings')).settings;
      check('trả lại như cũ', JSON.stringify({ ...back, species: [...back.species].sort() }) === JSON.stringify({ ...before, species: [...before.species].sort() }), back);
    `,
  },
];
