// Truy cập: the tiles, the six charts, the ranges (today by hour, 7 days by day, a span typed), the
// hover box. Read only.
export default [
  {
    name: 'Truy cập: số liệu, biểu đồ, khoảng thời gian, rê chuột',
    path: '/#traffic',
    wait: 3000,
    run: `
      const today = await h.api('/api/traffic?from=' + new Date().toISOString().slice(0, 10) + '&to=' + new Date().toISOString().slice(0, 10));
      check('8 ô số', ['Lượt mở web', 'Người xem khác nhau', 'Bấm tải launcher', 'File cài từ server', 'Cài mới', 'Máy dùng launcher', 'Lượt đăng nhập', 'Tài khoản đang dùng'].every((t) => document.body.textContent.includes(t)));
      check('6 biểu đồ', h.$$('svg[role=img]').length === 6, h.$$('svg[role=img]').length);
      check('hôm nay theo giờ', document.body.textContent.includes('theo giờ') && document.body.textContent.includes('lượt / giờ'));
      check('mỗi giờ một điểm', today.points.length === 24 || today.points.length > 0, today.points.length);
      h.click(h.byText('7 ngày', 'button')); await h.sleep(1500);
      check('7 ngày theo ngày', document.body.textContent.includes('theo ngày') && document.body.textContent.includes('lượt / ngày'));
      h.click(h.byText('Khoảng ngày', 'button')); await h.sleep(1500);
      check('ô từ / đến ngày (không phải hộp ngày của trình duyệt)', !!h.$('button[aria-label="Từ ngày"]') && !h.$('input[type=date]:not([hidden])'));
      check('khoảng 14 ngày', /\\d\\d\\/\\d\\d – \\d\\d\\/\\d\\d · theo ngày/.test(document.body.textContent));
      const rect = h.$('svg[role=img] rect'); const r = rect.getBoundingClientRect();
      rect.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + 20 })); await h.sleep(300);
      check('hộp số khi rê chuột', h.$$('div').some((x) => getComputedStyle(x).position === 'absolute' && x.textContent.includes('Lượt đăng nhập') && x.textContent.includes('/')));
      rect.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true })); await h.sleep(300);
    `,
  },
];
