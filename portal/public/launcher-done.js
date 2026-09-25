'use strict';
// launcher-done.html: what the browser shows after a launcher's Steam login.
(() => {
  const error = new URLSearchParams(location.search).get('error');
  if (!error) {
    // Hand the player back to the launcher: the OS brings its window to the
    // front (the launcher also comes forward by itself once it has the session).
    setTimeout(() => { location.href = 'xomgay-launcher://login-done'; }, 400);
    // A tab opened by another app can usually not close itself; try anyway.
    setTimeout(() => { window.close(); }, 2500);
    return;
  }
  document.getElementById('ok').hidden = true;
  document.getElementById('bad').hidden = false;
  if (error === 'steam') {
    document.getElementById('bad-title').textContent = 'Steam không phản hồi';
    document.getElementById('bad-text').textContent = 'Máy chủ chưa xác nhận được lần đăng nhập với Steam (mạng tới Steam chập chờn). Quay lại launcher và bấm "Đăng nhập bằng Steam" lần nữa.';
  } else if (error === 'refused') {
    document.getElementById('bad-title').textContent = 'Steam không xác nhận lần đăng nhập này';
    document.getElementById('bad-text').textContent = 'Quay lại launcher và đăng nhập lại từ đầu.';
  } else if (error === 'other-address') {
    document.getElementById('bad-title').textContent = 'Trình duyệt này không cùng mạng với launcher';
    document.getElementById('bad-text').textContent = 'Đăng nhập phải làm trên cùng máy (cùng mạng) đang mở launcher. Nếu bạn không bấm đăng nhập trong launcher của mình, hãy bỏ qua trang này.';
  }
})();
