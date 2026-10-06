// Server: Vận hành (schedule, growth event, DDoS warning: each saved and put back; the power buttons
// are only looked at, never pressed), Cấu hình game and Dữ liệu as they are moved. LOCAL copy only
// (e2e/local-bridge.sh: SYSTEMCTL=true, no RCON): never the live bridge.
export default [
  {
    name: 'Vận hành: trạng thái, nút bật / tắt đúng theo trạng thái, sẵn sàng trên game',
    path: '/next/#server/ops',
    run: `
      const st = await h.api('/api/server/status');
      check('hiện trạng thái', document.body.textContent.includes(st.phase === 'running' ? 'Đang chạy' : st.phase === 'stopped' ? 'Đã tắt' : 'Không rõ trạng thái'));
      const busy = st.operation !== null;
      check('nút Bật đúng trạng thái', h.byText('▶ Bật server', 'button').disabled === (busy || st.phase === 'running' || st.phase === 'starting'));
      check('nút Tắt đúng trạng thái', h.byText('■ Tắt server', 'button').disabled === (busy || st.phase === 'stopped'));
      const rd = await h.api('/api/server/readiness');
      check('mọi điều kiện sẵn sàng hiện ra', rd.checks.every((c) => document.body.textContent.includes(c.label)));
      check('dòng dưới tiêu đề có tên unit và múi giờ', document.body.textContent.includes(st.unitName + ' · múi giờ VPS ' + st.timeZone));
    `,
  },
  {
    name: 'Lịch khởi động lại: thêm giờ, lưu, trả lại',
    path: '/next/#server/ops',
    run: `
      const before = (await h.api('/api/server/status')).schedule;
      h.click(h.$('button[aria-label="Giờ"]')); await h.sleep(200);
      h.click(h.byText('06:00', 'button')); await h.sleep(100);
      h.click(h.byText('Xong', 'button')); await h.sleep(200);
      h.click(h.byText('+ Thêm giờ', 'button')); await h.sleep(200);
      check('giờ mới hiện ra', !!h.$('button[aria-label="Bỏ 06:00"]'));
      h.click(h.byText('Lưu lịch', 'button')); await h.sleep(1500);
      const after = (await h.api('/api/server/status')).schedule;
      check('đã lưu 06:00', after.daily.includes('06:00'), after.daily);
      check('có lần tới', after.next !== null && document.body.textContent.includes('lần tới:'));
      if (!before.daily.includes('06:00')) { h.click(h.$('button[aria-label="Bỏ 06:00"]')); await h.sleep(200); }
      h.click(h.byText('Lưu lịch', 'button')); await h.sleep(1500);
      check('trả lại như cũ', JSON.stringify((await h.api('/api/server/status')).schedule.daily) === JSON.stringify(before.daily));
    `,
  },
  {
    name: 'Sự kiện tốc độ lớn: thêm (cuối tuần tới, ×2), hiện trong danh sách, xoá',
    path: '/next/#server/ops',
    run: `
      const n0 = (await h.api('/api/server/growth-events')).events.length;
      h.type(h.$('input[placeholder="vd: Cuối tuần x2"]'), 'e2e x2'); await h.sleep(100);
      h.click(h.byText('+ Thêm sự kiện', 'button')); await h.sleep(1500);
      const evs = (await h.api('/api/server/growth-events')).events;
      const ev = evs.find((e) => e.note === 'e2e x2');
      check('đã thêm, hệ số 2', !!ev && ev.multiplier === 2 && evs.length === n0 + 1, ev);
      check('hiện trong danh sách', document.body.textContent.includes('e2e x2'));
      const row = h.$$('div').find((d) => d.textContent.includes('e2e x2') && d.querySelector('button') && d.children.length <= 3);
      h.click([...row.querySelectorAll('button')].find((b) => b.textContent === 'Xoá')); await h.sleep(300);
      h.click([...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent === 'Xoá')); await h.sleep(1500);
      check('đã xoá', !(await h.api('/api/server/growth-events')).events.some((e) => e.note === 'e2e x2'));
    `,
  },
  {
    name: 'Cảnh báo DDoS: đổi ngưỡng, lưu, trả lại',
    path: '/next/#server/ops',
    run: `
      const before = await h.api('/api/ddos');
      h.click(h.$('input[aria-label="Từ (gói/giây)"]').parentElement.querySelector('[aria-label="Tăng"]')); await h.sleep(200);
      h.click(h.byText('Lưu cảnh báo DDoS', 'button')); await h.sleep(1500);
      const mid = await h.api('/api/ddos');
      check('đã lưu ngưỡng +1000', mid.pps === before.pps + 1000, mid.pps);
      h.click(h.$('input[aria-label="Từ (gói/giây)"]').parentElement.querySelector('[aria-label="Giảm"]')); await h.sleep(200);
      h.click(h.byText('Lưu cảnh báo DDoS', 'button')); await h.sleep(1500);
      check('trả lại như cũ', (await h.api('/api/ddos')).pps === before.pps);
    `,
  },
  {
    name: 'Cấu hình game: mở thẳng một nhóm, đổi số người chơi tối đa, lưu, trả lại (không khởi động lại)',
    path: '/next/#server/cfg%3Aserver',
    run: `
      const c0 = await h.api('/api/game-config');
      check('mở đúng nhóm Máy chủ', document.body.textContent.includes('Cấu hình game · Máy chủ'));
      const before = c0.settings.MaxPlayerCount ?? c0.effective.MaxPlayerCount ?? c0.schema.MaxPlayerCount.default;
      check('hiện đúng giá trị', h.value('Số người chơi tối đa') === String(before), h.value('Số người chơi tối đa'));
      h.click(h.minus('Số người chơi tối đa')); await h.sleep(300);
      check('nhóm có chấm thay đổi', !!h.$('nav[aria-label="Nhóm cấu hình game"] [title="Có thay đổi chưa lưu"]'));
      h.click(h.byText('Lưu cấu hình', 'button')); await h.sleep(1500);
      const c1 = await h.api('/api/game-config');
      check('đã lưu -1', c1.settings.MaxPlayerCount === before - 1, c1.settings.MaxPlayerCount);
      check('không khởi động lại', (await h.api('/api/server/status')).operation === null);
      h.click(h.plus('Số người chơi tối đa')); await h.sleep(300);
      h.click(h.byText('Lưu cấu hình', 'button')); await h.sleep(1500);
      check('trả lại như cũ', (await h.api('/api/game-config')).settings.MaxPlayerCount === before);
      h.click(h.$('a[href="#server/cfg%3Aspawn"]')); await h.sleep(800);
      check('sang nhóm Loài & điểm spawn', document.body.textContent.includes('Cấu hình game · Loài & điểm spawn') && location.hash.includes('spawn'));
    `,
  },
  {
    name: 'Dữ liệu: backup ngay, hiện trong danh sách, đổi số bản giữ, trả lại, xoá bản vừa tạo (không khôi phục, không xoá dữ liệu)',
    path: '/next/#server/data',
    run: `
      const d0 = await h.api('/api/backups');
      check('khoá khôi phục / xoá dữ liệu khi server chưa tắt', d0.phase === 'stopped' || h.byText('Xoá dữ liệu…', 'button').disabled);
      h.click(h.byText('Backup ngay', 'button')); await h.sleep(2000);
      const d1 = await h.api('/api/backups');
      const made = d1.backups.find((b) => !d0.backups.some((x) => x.name === b.name));
      check('đã tạo một bản', !!made, d1.backups.length);
      check('hiện trong danh sách', !!made && document.body.textContent.includes(made.name));
      h.click(h.$('input[aria-label="Số bản giữ lại"]').parentElement.querySelector('[aria-label="Tăng"]')); await h.sleep(200);
      h.click(h.byText('Lưu', 'button')); await h.sleep(1200);
      check('đã lưu giữ +1', (await h.api('/api/backups')).settings.keep === d0.settings.keep + 1);
      h.click(h.$('input[aria-label="Số bản giữ lại"]').parentElement.querySelector('[aria-label="Giảm"]')); await h.sleep(200);
      h.click(h.byText('Lưu', 'button')); await h.sleep(1200);
      check('trả lại như cũ', (await h.api('/api/backups')).settings.keep === d0.settings.keep);
      const row = h.$$('tr').find((tr) => tr.textContent.includes(made.name));
      h.click([...row.querySelectorAll('button')].find((b) => b.textContent === 'Xoá')); await h.sleep(300);
      h.click([...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent === 'Xoá')); await h.sleep(1500);
      check('đã xoá bản vừa tạo', !(await h.api('/api/backups')).backups.some((b) => b.name === made.name));
    `,
  },
];
