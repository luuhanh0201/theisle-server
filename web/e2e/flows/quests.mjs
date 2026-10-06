// Nhiệm vụ: the check-in (a day's reward saved and put back), Hổ phách (+ / − with a reason, the
// ledger and its filter), the shop (a listing added, moved, saved, put back), the daily quests
// (one added, saved, removed). LOCAL copy only.
const REX = '76561198000000011';
export default [
  {
    name: 'Điểm danh: đổi thưởng ngày 7, lưu, trả lại',
    path: '/next/#quests',
    wait: 3000,
    run: `
      const before = (await h.api('/api/economy')).settings;
      h.typeNum(h.$('input[aria-label="Ngày 7"]'), String(before.checkinRewards[6] + 11)); await h.sleep(300);
      check('chưa lưu', document.body.textContent.includes('● Có thay đổi chưa lưu'));
      h.click(h.byText('Lưu điểm danh', 'button')); await h.sleep(1500);
      check('đã lưu', (await h.api('/api/economy')).settings.checkinRewards[6] === before.checkinRewards[6] + 11);
      h.typeNum(h.$('input[aria-label="Ngày 7"]'), String(before.checkinRewards[6])); await h.sleep(300);
      h.click(h.byText('Lưu điểm danh', 'button')); await h.sleep(1500);
      check('trả lại', JSON.stringify((await h.api('/api/economy')).settings) === JSON.stringify(before));
    `,
  },
  {
    name: 'Hổ phách: thiếu lý do bị từ chối; +50 rồi −20 cho Rex, sổ giao dịch, lọc',
    path: '/next/#quests',
    wait: 3000,
    run: `
      const sid = h.$('input[placeholder="7656119…"]'), delta = h.$$('label').find((l) => l.textContent.startsWith('Cộng (+)')).querySelector('input');
      const reason = h.$('input[placeholder="vd. đền bù lỗi gara"]');
      h.type(sid, '${REX}'); h.type(delta, '50'); await h.sleep(200);
      h.click(h.byText('Cộng / trừ', 'button')); await h.sleep(500);
      check('thiếu lý do: báo lỗi', document.body.textContent.includes('Cần ghi lý do'));
      h.type(reason, 'e2e thưởng'); await h.sleep(200);
      h.click(h.byText('Cộng / trừ', 'button')); await h.sleep(1500);
      h.type(delta, '-20'); h.type(reason, 'e2e trừ'); await h.sleep(200);
      h.click(h.byText('Cộng / trừ', 'button')); await h.sleep(2500);
      const top = (await h.api('/api/economy')).summary.top.find((x) => x.steamId === '${REX}');
      check('số dư 30', top?.balance === 30, top);
      check('sổ giao dịch có 2 dòng', document.body.textContent.includes('e2e thưởng') && document.body.textContent.includes('e2e trừ') && document.body.textContent.includes('+50'));
      h.type(h.$('input[aria-label="Lọc theo SteamID"]'), '76561198000000012'); await h.sleep(2500);
      check('lọc người khác: không còn dòng của Rex', !document.body.textContent.includes('e2e thưởng'));
      h.type(h.$('input[aria-label="Lọc theo SteamID"]'), ''); await h.sleep(2500);
      check('bỏ lọc: hiện lại', document.body.textContent.includes('e2e thưởng'));
    `,
  },
  {
    name: 'Cửa hàng: thêm món, đổi giá, đưa lên đầu, lưu, trả lại',
    path: '/next/#quests',
    wait: 3000,
    run: `
      const before = (await h.api('/api/shop')).listings;
      h.click(h.byText('+ Thêm món', 'button')); await h.sleep(300);
      const prices = h.$$('input[aria-label="Giá (Hổ phách)"]');
      check('một dòng mới', prices.length === before.length + 1);
      h.typeNum(prices[prices.length - 1], '777'); await h.sleep(200);
      for (let i = before.length; i > 0; i--) { h.click(h.$$('button[title="Lên"]')[i]); await h.sleep(150); }
      h.click(h.byText('Lưu cửa hàng', 'button')); await h.sleep(1500);
      const after = (await h.api('/api/shop')).listings;
      check('món mới đứng đầu, giá 777', after.length === before.length + 1 && after[0].price === 777, after.map((l) => l.price));
      h.click(h.$$('button[title="Bỏ khỏi cửa hàng"]')[0]); await h.sleep(200);
      h.click(h.byText('Lưu cửa hàng', 'button')); await h.sleep(1500);
      const back = (await h.api('/api/shop')).listings;
      check('trả lại như cũ', JSON.stringify(back.map((l) => [l.itemId, l.price, l.dailyLimit])) === JSON.stringify(before.map((l) => [l.itemId, l.price, l.dailyLimit])));
    `,
  },
  {
    name: 'Nhiệm vụ ngày / tuần: thêm, đổi tên, lưu, xoá',
    path: '/next/#quests',
    wait: 3000,
    run: `
      const before = (await h.api('/api/quests')).settings;
      h.click(h.byText('+ Thêm nhiệm vụ', 'button')); await h.sleep(300);
      const names = h.$$('label').filter((l) => l.textContent.startsWith('Tên hiện cho người chơi')).map((l) => l.querySelector('input'));
      h.type(names[names.length - 1], 'Nhiệm vụ e2e'); await h.sleep(200);
      h.click(h.byText('Lưu nhiệm vụ', 'button')); await h.sleep(1500);
      const saved = (await h.api('/api/quests')).settings.defs;
      check('đã thêm', saved.length === before.defs.length + 1 && saved[saved.length - 1].label === 'Nhiệm vụ e2e');
      h.click(h.$$('button[title="Xoá nhiệm vụ"]').pop()); await h.sleep(200);
      h.click(h.byText('Lưu nhiệm vụ', 'button')); await h.sleep(1500);
      check('trả lại như cũ', JSON.stringify((await h.api('/api/quests')).settings) === JSON.stringify(before));
    `,
  },
];
