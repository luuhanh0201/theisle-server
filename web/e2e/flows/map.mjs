// Bản đồ: the map drawn, layers (remembered), search (a place, coordinates), the hover readout,
// AI zones (a new one placed by a click, ellipse, polygon drawn, saved, removed again), the
// small-dinos rule (saved and put back), an AI reset started and cancelled, a life's path that
// the bridge no longer has. LOCAL copy only.
const CLICK = `window.mapClick = (fx, fy) => {
  const c = document.querySelector('canvas[aria-label="Bản đồ"]'); const r = c.getBoundingClientRect();
  const o = { bubbles: true, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, pointerId: 7, button: 0, isPrimary: true };
  c.dispatchEvent(new PointerEvent('pointerdown', o)); c.dispatchEvent(new PointerEvent('pointerup', o));
};
window.mapMove = (fx, fy) => {
  const c = document.querySelector('canvas[aria-label="Bản đồ"]'); const r = c.getBoundingClientRect();
  c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, pointerId: 8 }));
};
window.tab = (t) => h.click(h.$$('[role=tab]').find((b) => b.textContent === t));`;
export default [
  {
    name: 'Bản đồ: vẽ xong, lớp hiển thị nhớ theo trình duyệt, tìm địa điểm và toạ độ, toạ độ khi rê chuột',
    path: '/next/#map',
    wait: 4000,
    run: `${CLICK}
      check('bản đồ đã tải', !document.body.textContent.includes('Đang tải bản đồ') && !!h.$('canvas[aria-label="Bản đồ"]'));
      const canvas = h.$('canvas[aria-label="Bản đồ"]');
      check('canvas đã vẽ (đúng cỡ)', canvas.width > 300 && canvas.height > 300, [canvas.width, canvas.height]);
      const chip = h.$$('label').find((l) => l.textContent.startsWith('Đường mòn'));
      const box = chip.querySelector('input'); const was = box.checked;
      box.click(); await h.sleep(300);
      const saved = JSON.parse(localStorage.getItem('mapLayers.v4')).on;
      check('bật / tắt lớp, nhớ lại', saved.includes('road') === !was);
      box.click(); await h.sleep(200);
      const search = h.$('input[aria-label="Tìm địa điểm hoặc toạ độ"]');
      h.type(search, 'delta'); await h.sleep(300);
      check('tìm địa điểm', h.$$('li button').some((b) => b.textContent.toLowerCase().includes('delta')));
      h.click(h.$$('li button').find((b) => b.textContent.toLowerCase().includes('delta'))); await h.sleep(300);
      h.type(search, '349,211, 148,696'); await h.sleep(300);
      const go = h.$$('li button').find((b) => b.textContent.includes('Tới toạ độ 349,211, 148,696'));
      check('nhận toạ độ kiểu game (Y, X)', !!go && go.textContent.includes('Y, X'));
      h.click(go); await h.sleep(300);
      check('kết quả đóng sau khi bay tới', !h.$$('li button').some((b) => b.textContent.includes('Tới toạ độ')));
      h.type(search, ''); await h.sleep(200);
      mapMove(0.5, 0.5); await h.sleep(300);
      check('toạ độ khi rê chuột', /^\\d{1,3}(,\\d{3})*, \\d{1,3}(,\\d{3})*$/.test(h.$$('div').map((d) => d.textContent).find((t) => /^\\d{1,3}(,\\d{3})*, \\d{1,3}(,\\d{3})*$/.test(t)) ?? ''));
    `,
  },
  {
    name: 'Vùng AI: vùng mới bằng một cú bấm, bầu dục, vẽ đa giác, lưu, xoá lại',
    path: '/next/#map',
    wait: 4000,
    run: `${CLICK}
      tab('Vùng AI'); await h.sleep(200);
      const before = await h.api('/api/ai-zones');
      h.click(h.byText('+ Vùng mới', 'button')); await h.sleep(200);
      check('gợi ý đặt tâm', document.body.textContent.includes('Bấm lên bản đồ để đặt tâm vùng mới'));
      mapClick(0.5, 0.45); await h.sleep(400);
      check('vùng mới được chọn, chưa lưu', document.body.textContent.includes('Vùng ' + (before.zones.length + 1)) && document.body.textContent.includes('Có thay đổi chưa lưu.'));
      h.type(h.$('input[aria-label="Tên vùng"]'), 'Vùng e2e'); await h.sleep(200);
      h.click(h.$$('[role=radio]').find((b) => b.textContent === 'Bầu dục')); await h.sleep(200);
      check('bầu dục: bán kính ngang, góc xoay', document.body.textContent.includes('Bán kính ngang (m)') && document.body.textContent.includes('Góc xoay (°)'));
      h.click(h.byText('Lưu vùng AI', 'button')); await h.sleep(2000);
      let z = (await h.api('/api/ai-zones')).zones.find((x) => x.name === 'Vùng e2e');
      check('đã lưu bầu dục', z && z.shape === 'ellipse' && z.radius2M > 0, z);
      h.click(h.$$('[role=radio]').find((b) => b.textContent === 'Đa giác')); await h.sleep(200);
      h.click(h.byText('Vẽ lại', 'button')); await h.sleep(200);
      check('đang vẽ đa giác', document.body.textContent.includes('Vẽ đa giác: bấm lên bản đồ'));
      mapClick(0.45, 0.40); await h.sleep(150); mapClick(0.55, 0.40); await h.sleep(150); mapClick(0.52, 0.52); await h.sleep(150); mapClick(0.47, 0.53); await h.sleep(150);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await h.sleep(300);
      check('đa giác 4 điểm', document.body.textContent.includes('4 điểm'));
      h.click(h.byText('Lưu vùng AI', 'button')); await h.sleep(2000);
      z = (await h.api('/api/ai-zones')).zones.find((x) => x.name === 'Vùng e2e');
      check('đã lưu đa giác', z && z.shape === 'polygon' && z.poly.length === 4, z?.poly);
      h.click(h.byText('Xoá vùng', 'button')); await h.sleep(200);
      h.click(h.byText('Lưu vùng AI', 'button')); await h.sleep(2000);
      const after = await h.api('/api/ai-zones');
      check('trả lại như cũ', after.zones.length === before.zones.length && !after.zones.some((x) => x.name === 'Vùng e2e'));
    `,
  },
  {
    name: 'Dino nhỏ (lưu, trả lại), Làm mới AI (bắt đầu rồi huỷ), Thả AI và Người chơi khi không ai online',
    path: '/next/#map',
    wait: 4000,
    run: `${CLICK}
      tab('Dino nhỏ'); await h.sleep(300);
      const g0 = await h.api('/api/zone-guard');
      h.$('#gd-enabled').click(); await h.sleep(200);
      h.click(h.byText('Lưu luật dino nhỏ', 'button')); await h.sleep(1500);
      check('đã lưu luật', (await h.api('/api/zone-guard')).enabled === !g0.enabled);
      h.$('#gd-enabled').click(); await h.sleep(200);
      h.click(h.byText('Lưu luật dino nhỏ', 'button')); await h.sleep(1500);
      check('trả lại như cũ', (await h.api('/api/zone-guard')).enabled === g0.enabled);
      tab('Làm mới'); await h.sleep(300);
      h.click(h.$('#reset-countdown')); await h.sleep(150);
      h.click(h.$$('[role=option]').find((o) => o.textContent === '5 phút')); await h.sleep(150);
      h.click(h.byText('Làm mới AI', 'button')); await h.sleep(300);
      check('hỏi trước', (h.$('[role=dialog]')?.textContent ?? '').includes('TẤT CẢ AI'));
      h.click(h.$('[role=dialog] button[type=submit]')); await h.sleep(2000);
      check('đang đếm ngược', (await h.api('/api/ai-reset')).current?.step === 'countdown' && document.body.textContent.includes('đang đếm ngược'));
      h.click(h.byText('Huỷ', 'button')); await h.sleep(2500);
      const r = await h.api('/api/ai-reset');
      check('đã huỷ', r.current === null && r.last?.step === 'cancelled', r);
      tab('Thả AI'); await h.sleep(300);
      check('không ai online: không thả được', h.$$('button:not([role=tab])').find((b) => b.textContent === 'Thả AI').disabled === true);
      tab('Người chơi'); await h.sleep(300);
      check('danh sách người chơi', document.body.textContent.includes('Chưa có ai đang điều khiển dino'));
      tab('Vùng AI');
    `,
  },
  {
    name: 'Đường đi của một đời dino bridge không còn giữ',
    path: '/next/#map/path/76561198000000011/1',
    wait: 4000,
    run: `
      check('địa chỉ giữ nguyên', location.hash === '#map/path/76561198000000011/1');
      check('báo không còn đường đi', document.body.textContent.includes('Không còn đường đi của đời dino này'));
      h.click(h.byText('Đóng', 'button')); await h.sleep(500);
      check('đóng: về bản đồ', location.hash === '#map' && !document.body.textContent.includes('Không còn đường đi'));
    `,
  },
  {
    name: 'Kéo một vùng trên bản đồ (không lưu)',
    path: '/next/#map',
    wait: 4000,
    run: `${CLICK}
      tab('Vùng AI'); await h.sleep(200);
      const z0 = (await h.api('/api/ai-zones')).zones[0];
      h.click(h.$$('li').find((li) => li.textContent.includes(z0.name))); await h.sleep(400);
      check('chọn vùng: gợi ý kéo', document.body.textContent.includes(z0.name + ': kéo bên trong để dời'));
      // The list flies the zone to the middle: press inside it, move, let go.
      const c = h.$('canvas[aria-label="Bản đồ"]'); const r = c.getBoundingClientRect();
      const at = (fx, fy) => ({ bubbles: true, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, pointerId: 9, button: 0 });
      c.dispatchEvent(new PointerEvent('pointerdown', at(0.5, 0.5))); await h.sleep(50);
      c.dispatchEvent(new PointerEvent('pointermove', at(0.56, 0.52))); await h.sleep(50);
      c.dispatchEvent(new PointerEvent('pointerup', at(0.56, 0.52))); await h.sleep(300);
      check('vùng đã dời, chưa lưu', document.body.textContent.includes('Có thay đổi chưa lưu.') && document.body.textContent.includes('chưa lưu'));
      check('chưa lưu lên server', JSON.stringify((await h.api('/api/ai-zones')).zones[0]) === JSON.stringify(z0));
    `,
  },
];
