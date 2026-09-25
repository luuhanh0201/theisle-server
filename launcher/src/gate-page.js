'use strict';
// gate.html: the server's status, and Steam login. The launcher opens only after it.
(() => {
  const $ = (id) => document.getElementById(id);
  const G = window.gate;
  $('version').textContent = G.version ? `Xóm Gáy Launcher v${G.version}` : 'Xóm Gáy Launcher';
  const PHASE = {
    running: ['ok', 'Máy chủ đang chạy'],
    starting: ['warn', 'Máy chủ đang khởi động…'],
    stopping: ['warn', 'Máy chủ đang tắt / khởi động lại…'],
    stopped: ['bad', 'Máy chủ đang tắt'],
    failed: ['bad', 'Máy chủ gặp lỗi'],
  };
  let discord = null;

  G.onServer((s) => {
    if (!s || s.error) {
      $('state').className = 'state bad';
      $('state-text').textContent = 'Không kết nối được máy chủ';
      $('online').textContent = '–';
      $('slots').textContent = 'kiểm tra mạng của bạn';
      $('meter').style.width = '0';
      return;
    }
    const [kind, text] = PHASE[s.phase] || ['', 'Chưa rõ trạng thái'];
    $('state').className = `state ${kind}`;
    $('state-text').textContent = text;
    const online = Number.isInteger(s.online) ? s.online : 0;
    const max = Number.isInteger(s.maxPlayers) && s.maxPlayers > 0 ? s.maxPlayers : null;
    $('online').textContent = max ? `${online} / ${max}` : String(online);
    $('slots').textContent = 'người đang chơi';
    $('meter').style.width = max ? `${Math.min(100, (online / max) * 100)}%` : '0';
    if (typeof s.name === 'string' && s.name) $('srv-name').textContent = s.name;
    discord = typeof s.discord === 'string' && /^https:\/\/discord(\.gg|\.com\/invite)\//.test(s.discord) ? s.discord : null;
    $('discord').hidden = discord === null;
  });

  const ERR = {
    expired: 'Hết thời gian đăng nhập (10 phút) — bấm đăng nhập lại.',
    'other-address': 'Trình duyệt vừa đăng nhập ở mạng khác với launcher — hãy đăng nhập bằng trình duyệt trên chính máy này.',
    error: 'Không kết nối được máy chủ để đăng nhập — kiểm tra mạng rồi thử lại.',
    steam: 'Steam không phản hồi khi máy chủ xác nhận lần đăng nhập — bấm đăng nhập lại.',
  };
  G.onLogin((state) => {
    $('wait').hidden = state !== 'waiting';
    $('pick').hidden = state === 'waiting';
    $('err').hidden = !ERR[state];
    $('err').textContent = ERR[state] || '';
  });

  // Pause the looping animations while another window (the game) has the focus.
  const idle = () => document.documentElement.classList.toggle('idle', !document.hasFocus() || document.hidden);
  window.addEventListener('focus', idle);
  window.addEventListener('blur', idle);
  document.addEventListener('visibilitychange', idle);
  idle();

  $('steam').addEventListener('click', () => G.login());
  $('reopen').addEventListener('click', () => G.reopen());
  $('cancel').addEventListener('click', () => G.cancel());
  $('discord').addEventListener('click', () => { if (discord) G.open(discord); });
  $('quit').addEventListener('click', () => G.quit());
})();
