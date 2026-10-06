// Vật phẩm: Skin (new, colours by hex and by a palette, the whole-dino light, save, copy, retire and
// issue again, give, revoke), Mutation (a quest mutation item, its rarity fixed, give, revoke),
// Phiếu & hộp (a growth bag, a hòm with prizes and their chances, give). LOCAL copy only.
const REX = '76561198000000011';
export default [
  {
    name: 'Skin: tạo mới, đổi màu (mã hex, bảng màu), lưu, bản sao, ngừng / phát hành lại, tặng, thu hồi',
    path: '/#items/skins',
    wait: 3500,
    run: `
      const before = (await h.api('/api/items')).items.filter((i) => i.type === 'skin').length;
      h.click(h.byText('+ Skin mới', 'button')); await h.sleep(400);
      h.type(h.$('input[placeholder="vd: Hắc Long"]'), 'Skin e2e');
      h.type(h.$('input[aria-label="Thân (mã hex)"]'), '#ff0000'); await h.sleep(200);
      check('swatch Thân đổi màu', h.$('#itm-picker-Body').style.background.includes('255, 0, 0'));
      h.click(h.$$('button[title]').find((b) => b.title === 'Hắc ám')); await h.sleep(200);
      check('bảng màu áp cả 10 vùng', h.$('input[aria-label="Mắt (mã hex)"]').value === '#ff3b30');
      check('đánh dấu chưa lưu', document.body.textContent.includes('● Có thay đổi chưa lưu'));
      h.click(h.byText('Lưu skin', 'button')); await h.sleep(1500);
      const items = (await h.api('/api/items')).items.filter((i) => i.type === 'skin');
      const sk = items.find((i) => i.name === 'Skin e2e');
      check('đã tạo skin', items.length === before + 1 && !!sk, items.map((i) => i.name));
      check('màu Mắt lưu dạng tuyến tính', sk && Math.abs(sk.data.colors.Eyes.r - 1) < 0.01 && sk.data.colors.Eyes.g < 0.06, sk?.data.colors.Eyes);
      check('đã chọn skin vừa lưu', document.body.textContent.includes(sk.id) && document.body.textContent.includes('Đã lưu'));
      h.click(h.byText('Tạo bản sao', 'button')); await h.sleep(300);
      check('bản sao chưa lưu', h.$('input[placeholder="vd: Hắc Long"]').value === 'Skin e2e (bản sao)' && document.body.textContent.includes('chưa lưu'));
      h.click(h.$$('button[aria-pressed]').find((b) => b.textContent.includes('Skin e2e') && !b.textContent.includes('bản sao'))); await h.sleep(400);
      check('hỏi trước khi bỏ bản sao', !!h.$('[role=dialog]'));
      h.click(h.$('[role=dialog] button[type=submit]')); await h.sleep(800);
      check('quay về skin đã lưu', h.$('input[placeholder="vd: Hắc Long"]').value === 'Skin e2e');
      h.click(h.byText('Ngừng phát hành', 'button')); await h.sleep(1500);
      check('ngừng phát hành', (await h.api('/api/items')).items.find((i) => i.id === sk.id).retired === true);
      h.click(h.byText('Phát hành lại', 'button')); await h.sleep(1500);
      check('phát hành lại', (await h.api('/api/items')).items.find((i) => i.id === sk.id).retired === false);
      h.type(h.$('input[aria-label="Người nhận"]'), '${REX}');
      h.type(h.$('input[aria-label="Ghi chú"]'), 'quà e2e'); await h.sleep(200);
      h.click(h.byText('Tặng vào kho', 'button')); await h.sleep(2000);
      // Admins hold a copy of every item (their bag, items.ts fillBags): Rex's row is the one looked at.
      const rex = async (id) => (await h.api('/api/items/' + id + '/owners')).owners.filter((o) => o.steamId === '${REX}');
      const own = await rex(sk.id);
      check('đã tặng', own.length === 1 && own[0].note === 'quà e2e', own);
      const row = () => h.$$('div').find((x) => x.children.length > 1 && x.firstElementChild?.textContent.startsWith('Rex Tester') && x.querySelector('button'));
      check('hiện người sở hữu', !!row());
      h.click([...row().querySelectorAll('button')].find((b) => b.textContent === 'Thu hồi')); await h.sleep(300);
      h.click(h.$('[role=dialog] button[type=submit]')); await h.sleep(1500);
      check('đã thu hồi', (await rex(sk.id)).length === 0);
    `,
  },
  {
    name: 'Mutation: vật phẩm mutation nhiệm vụ (độ hiếm Đặc biệt cố định), tặng, thu hồi',
    path: '/#items/mutations',
    wait: 3000,
    run: `
      const d = await h.api('/api/items');
      const quest = d.mutations.filter((m) => m.kind === 'unlock');
      check('có mutation nhiệm vụ để chọn', quest.length > 0, quest.length);
      h.click(h.byText('+ Mutation mới', 'button')); await h.sleep(400);
      check('độ hiếm khoá ở Đặc biệt', h.$('button[aria-label="Độ hiếm"]').disabled && h.$('button[aria-label="Độ hiếm"]').textContent.includes('Đặc biệt'));
      check('mô tả mutation', document.body.textContent.includes(quest[0].name) && document.body.textContent.includes('mutation nhiệm vụ'));
      h.click(h.byText('Lưu mutation', 'button')); await h.sleep(1500);
      const it = (await h.api('/api/items')).items.find((i) => i.type === 'mutation');
      check('đã tạo, tên = mutation, độ hiếm special', it && it.name === quest[0].name && it.rarity === 'special', it);
      const rex = async (id) => (await h.api('/api/items/' + id + '/owners')).owners.filter((o) => o.steamId === '${REX}');
      h.type(h.$('input[aria-label="Người nhận"]'), '${REX}'); await h.sleep(200);
      h.click(h.byText('Tặng 1 cái vào kho', 'button')); await h.sleep(1500);
      h.click(h.byText('Tặng 1 cái vào kho', 'button')); await h.sleep(800);
      check('trống người nhận: không tặng', (await rex(it.id)).length === 1);
      h.type(h.$('input[aria-label="Người nhận"]'), '${REX}'); await h.sleep(200);
      h.click(h.byText('Tặng 1 cái vào kho', 'button')); await h.sleep(1500);
      check('2 cái, gộp một dòng', (await rex(it.id)).length === 2 && document.body.textContent.includes('Rex Tester × 2'));
      const row = h.$$('div').find((x) => x.firstElementChild?.textContent.startsWith('Rex Tester × 2') && x.querySelector('button'));
      h.click([...row.querySelectorAll('button')].find((b) => b.textContent === 'Thu hồi hết')); await h.sleep(300);
      h.click(h.$('[role=dialog] button[type=submit]')); await h.sleep(1500);
      check('đã thu hồi hết', (await rex(it.id)).length === 0);
    `,
  },
  {
    name: 'Phiếu & hộp: túi tăng trưởng, hòm có phần thưởng và tỉ lệ, tặng',
    path: '/#items/tickets',
    wait: 3000,
    run: `
      h.click(h.byText('+ Tạo mới', 'button')); await h.sleep(400);
      h.click(h.$('button[aria-label="Loại"]')); await h.sleep(200);
      h.click(h.$$('[role=option]').find((o) => o.textContent.includes('Túi tăng trưởng'))); await h.sleep(300);
      check('ô cộng thêm và mốc', h.$('input[aria-label="Cộng thêm (%)"]').value === '10' && h.$('input[aria-label="Chỉ dùng khi dino dưới (%)"]').value === '60');
      h.typeNum(h.$('input[aria-label="Cộng thêm (%)"]'), '15'); await h.sleep(200);
      h.click(h.byText('Lưu phiếu', 'button')); await h.sleep(1500);
      const bag = (await h.api('/api/items')).items.find((i) => i.type === 'growth_bag');
      check('túi đã lưu: +15% dưới 60%, tên mặc định', bag && Math.abs(bag.data.amount - 0.15) < 1e-9 && bag.data.below === 0.6 && bag.name === 'Túi tăng trưởng', bag);
      h.click(h.byText('+ Tạo mới', 'button')); await h.sleep(400);
      h.click(h.$('button[aria-label="Loại"]')); await h.sleep(200);
      h.click(h.$$('[role=option]').find((o) => o.textContent.includes('Hòm'))); await h.sleep(300);
      h.click(h.byText('+ Thêm phần thưởng', 'button')); await h.sleep(200);
      h.click(h.byText('+ Thêm phần thưởng', 'button')); await h.sleep(200);
      h.typeNum(h.$$('input[aria-label="Trọng số"]')[1], '30'); await h.sleep(200);
      check('tỉ lệ theo trọng số', document.body.textContent.includes('25.0%') && document.body.textContent.includes('75.0%') && document.body.textContent.includes('2 món · tổng trọng số 40'));
      h.type(h.$('input[placeholder="vd: Phiếu đổi mutation Hiếm"]'), 'Hòm e2e'); await h.sleep(200);
      h.click(h.byText('Lưu phiếu', 'button')); await h.sleep(1500);
      const box = (await h.api('/api/items')).items.find((i) => i.name === 'Hòm e2e');
      check('hòm đã lưu với 2 phần thưởng', box && box.type === 'loot_box' && box.data.pool.length === 2 && box.data.pool[1].weight === 30, box?.data);
      h.type(h.$('input[aria-label="Người nhận"]'), '${REX}'); await h.sleep(200);
      h.click(h.byText('Tặng 1 phiếu', 'button')); await h.sleep(1500);
      check('đã tặng hòm', (await h.api('/api/items/' + box.id + '/owners')).owners.some((o) => o.steamId === '${REX}'));
    `,
  },
];
