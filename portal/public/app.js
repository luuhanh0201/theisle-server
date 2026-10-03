// The Isle Evrima · Cổng Thông Tin Người Chơi (Portal UI)
// Quản lý 6 trang: Home, Game, Gara, Bản đồ, Bảng xếp hạng, Skin.

import { createMap, loadWaypoints } from './map.js';
import { DEFAULT_COLORS, REGIONS, hex, linearOf, mountPresets, mountRegions } from './skin-editor.js';

const $ = (id) => document.getElementById(id);
// Launcher game mode (main.js): in the background the page does not draw at all.
let gameMode = window.isleLauncher?.gameModeGet?.() ?? { on: false, keep: {} };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (g) => (typeof g === 'number' ? `${Math.round(g * 100)}%` : '0%');
const when = (t) => (t ? new Date(t * 1000).toLocaleString('vi-VN', { hour12: false }) : '');
function dur(sec) {
  sec = Math.max(0, Math.round(sec ?? 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}g ${m}p` : `${m}p ${sec % 60}s`;
}

// Check login error
const params = new URLSearchParams(location.search);
if (params.get('login_error')) {
  $('error').hidden = false;
  $('error').textContent = `Đăng nhập không thành công: ${params.get('login_error')}`;
  history.replaceState(null, '', '/');
}

// Test mode ("lab"): features not released to players yet: skin effects,
// glow, kept colours, the 3D on the Game tab, show only in a browser
// opened once with ?lab=1 (remembered; ?lab=0 turns it off).
const LAB = (() => {
  try {
    const q = new URLSearchParams(location.search).get('lab');
    if (q === '1') localStorage.setItem('xg.lab', '1');
    if (q === '0') localStorage.removeItem('xg.lab');
    return localStorage.getItem('xg.lab') === '1';
  } catch { return false; }
})();
document.documentElement.classList.toggle('lab', LAB);

async function getJson(url) {
  const r = await fetch(url, { credentials: 'same-origin' });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// ============================================================================
// 1. Navigation / Tab Routing
// ============================================================================
const VALID_TABS = ['home', 'game', 'gara', 'map', 'ranking', 'skin', 'bag', 'voice', 'overlay'];
let currentTab = 'home';

function switchTab(tabId, updateHash = true) {
  if (!VALID_TABS.includes(tabId)) tabId = 'home';
  currentTab = tabId;

  // Update nav buttons
  for (const btn of document.querySelectorAll('.nav-btn')) {
    btn.classList.toggle('active', btn.dataset.nav === tabId);
  }

  // Update page sections
  for (const sec of document.querySelectorAll('.page-content')) {
    sec.hidden = sec.id !== `page-${tabId}`;
  }

  if (updateHash && location.hash !== `#${tabId}`) {
    location.hash = tabId;
  }

  // If switched to map, make sure canvas updates
  if (tabId === 'map' && map && lastMeData?.dino) {
    map.update(lastMeData.dino);
  }
}

// Listen to hash changes
window.addEventListener('hashchange', () => {
  const hash = location.hash.replace(/^#/, '');
  if (VALID_TABS.includes(hash)) switchTab(hash, false);
});

// The launcher download on Home: the Windows installer straight away (most
// players); Linux and the install help are on /tai.html ("xem thêm").
(async () => {
  if (window.isleLauncher) return;
  try {
    const r = await fetch('/tai/version.json', { cache: 'no-cache' });
    if (!r.ok) return;
    const v = await r.json();
    if (typeof v.version === 'string') $('lp-version').textContent = `v${v.version}`;
    const f = v.windows;
    if (f && f.file) {
      $('lp-btn').href = `/tai/${encodeURIComponent(f.file)}`;
      $('lp-os').textContent = `cho Windows${f.size ? ` · ${Math.round(f.size / 1048576)} MB` : ''} · miễn phí`;
    }
  } catch { /* the button keeps pointing at the download page */ }
})();

// Inside Xóm Gáy Launcher the window often sits behind the game: while it is
// not the focused window, looping CSS animations pause (index.html
// html.app-idle), so the launcher draws only when data changes.
if (window.isleLauncher) {
  const idle = () => document.documentElement.classList.toggle('app-idle', !document.hasFocus() || document.hidden);
  window.addEventListener('focus', () => { lastDrawn = 0; refresh(); });
  window.addEventListener('focus', idle);
  window.addEventListener('blur', idle);
  document.addEventListener('visibilitychange', idle);
  idle();
}

// Inside Xóm Gáy Launcher (Electron preload): a play button instead of the download link.
if (window.isleLauncher) {
  // Nothing about downloading the launcher, inside it (rule: AGENTS.md "Launcher"; CSS .web-only too).
  for (const el of document.querySelectorAll('.web-only')) el.hidden = true;
  // The overlay is the launcher's: its tab only shows there.
  document.getElementById('nav-overlay').hidden = false;
  const play = document.getElementById('play-game');
  if (play) {
    play.hidden = false;
    play.addEventListener('click', () => window.isleLauncher.playGame());
  }
  // Game mode: one click puts the launcher out of the way (main.js).
  const gm = document.getElementById('game-mode');
  if (window.isleLauncher.gameModeGet) {
    gm.hidden = false;
    const showGm = () => gm.setAttribute('aria-pressed', String(gameMode.on));
    showGm();
    gm.addEventListener('click', () => window.isleLauncher.gameModeSet(!gameMode.on));
    window.isleLauncher.onGameMode((st) => {
      gameMode = st;
      showGm();
      readOverlayAi(null);
      window.dispatchEvent(new CustomEvent('isle-gamemode', { detail: st }));
    });
  }
  // Which launcher build this is, under the server name, and (1.0.7+) a
  // button to look for a newer one now, then install it.
  const sub = document.querySelector('.brand-info p');
  if (sub && window.isleLauncher.version) {
    const v = document.createElement('span');
    v.className = 'launcher-version';
    v.textContent = `Launcher v${window.isleLauncher.version}`;
    sub.append(' · ', v);
    if (window.isleLauncher.updateGet) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'launcher-update';
      const show = (st) => {
        if (!st) return;
        const text = {
          dev: '', idle: '⟳ Kiểm tra cập nhật', checking: 'Đang kiểm tra…', latest: '✓ Bản mới nhất · kiểm tra lại',
          downloading: `Đang tải v${st.version}… ${st.percent ?? 0}%`, ready: `⬆ Cập nhật lên v${st.version}`,
          error: '⚠ Không kiểm tra được · thử lại',
        }[st.phase] ?? '⟳ Kiểm tra cập nhật';
        b.hidden = text === '';
        b.textContent = text;
        b.disabled = st.phase === 'checking' || st.phase === 'downloading';
        b.classList.toggle('ready', st.phase === 'ready');
        b.title = st.phase === 'ready' ? 'Launcher sẽ tắt, cài bản mới rồi tự mở lại (voice ngắt vài giây)'
          : st.phase === 'error' ? `Lỗi: ${st.error || 'không rõ'}` : `Đang dùng v${st.current}`;
      };
      b.addEventListener('click', () => {
        const st = window.isleLauncher.updateGet();
        if (st && st.phase === 'ready') window.isleLauncher.updateInstall();
        else window.isleLauncher.updateCheck();
      });
      window.isleLauncher.onUpdate(show);
      show(window.isleLauncher.updateGet());
      sub.append(' ', b);
    }
  }

  // Bind Launcher Hub quick buttons if present
  const hubGm = document.getElementById('hub-gamemode-btn');
  if (hubGm && window.isleLauncher.gameModeGet) {
    hubGm.addEventListener('click', () => window.isleLauncher.gameModeSet(!gameMode.on));
  }
  const hubUpd = document.getElementById('hub-update-btn');
  if (hubUpd && window.isleLauncher.updateGet) {
    hubUpd.addEventListener('click', () => {
      const st = window.isleLauncher.updateGet();
      if (st && st.phase === 'ready') window.isleLauncher.updateInstall();
      else window.isleLauncher.updateCheck();
    });
  }
}

// Setup click handlers for nav
for (const btn of document.querySelectorAll('.nav-btn[data-nav]')) {
  btn.addEventListener('click', () => switchTab(btn.dataset.nav));
}

// Any button with data-switch-tab
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-switch-tab]');
  if (t) {
    e.preventDefault();
    switchTab(t.dataset.switchTab);
  }
});

// Quick Toast feedback helper
function showToast(msg) {
  const t = $('global-toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => { t.hidden = true; }, 200);
  }, 2200);
}

async function copyAndToast(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`Đã sao chép: ${text}`);
  } catch {
    prompt('Nhấn Ctrl+C để sao chép lệnh:', text);
  }
}

// 1-Click Copy Command buttons
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copy]');
  if (b) {
    const text = b.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
      const original = b.textContent;
      b.textContent = 'Đã chép!';
      b.style.color = '#34d399';
      showToast(`Đã sao chép: ${text}`);
      setTimeout(() => {
        b.textContent = original;
        b.style.color = '';
      }, 1500);
    } catch {
      prompt('Nhấn Ctrl+C để sao chép lệnh:', text);
    }
  }
});

// Open Rules Action button
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action="open-rules"]');
  if (t) {
    e.preventDefault();
    switchTab('home');
    const sec = $('server-rules-section');
    if (sec) {
      sec.scrollIntoView({ behavior: 'smooth' });
      sec.classList.add('highlight-section');
      setTimeout(() => sec.classList.remove('highlight-section'), 2000);
    }
  }
});

// Vertical Sidebar Navigation Controller
function initSidebar() {
  const sidebar = $('portal-sidebar');
  const toggle = $('sidebar-toggle');
  const desktopExpand = $('desktop-sidebar-expand');
  const backdrop = $('drawer-backdrop');
  const mobileMenu = $('mobile-menu-toggle');
  const bottomMenu = $('bottom-menu-toggle');

  if (!sidebar) return;

  const updateToggleTitle = () => {
    const isCol = document.body.classList.contains('sidebar-collapsed');
    if (toggle) {
      toggle.title = isCol ? 'Mở rộng menu bên trái' : 'Thu gọn menu bên trái';
      toggle.setAttribute('aria-label', toggle.title);
    }
  };

  try {
    const isCollapsed = localStorage.getItem('xg.sidebar_collapsed') === '1';
    if (isCollapsed) {
      document.body.classList.add('sidebar-collapsed');
    }
  } catch {}
  updateToggleTitle();

  if (toggle) {
    toggle.addEventListener('click', () => {
      const next = !document.body.classList.contains('sidebar-collapsed');
      document.body.classList.toggle('sidebar-collapsed', next);
      try {
        if (next) localStorage.setItem('xg.sidebar_collapsed', '1');
        else localStorage.removeItem('xg.sidebar_collapsed');
      } catch {}
      updateToggleTitle();
    });
  }

  if (desktopExpand) {
    desktopExpand.addEventListener('click', () => {
      document.body.classList.remove('sidebar-collapsed');
      try {
        localStorage.removeItem('xg.sidebar_collapsed');
      } catch {}
      updateToggleTitle();
    });
  }

  const openDrawer = () => {
    sidebar.classList.add('drawer-open');
    if (backdrop) backdrop.classList.add('open');
  };
  const closeDrawer = () => {
    sidebar.classList.remove('drawer-open');
    if (backdrop) backdrop.classList.remove('open');
  };

  if (mobileMenu) mobileMenu.addEventListener('click', openDrawer);
  if (bottomMenu) bottomMenu.addEventListener('click', openDrawer);
  if (backdrop) backdrop.addEventListener('click', closeDrawer);

  for (const btn of sidebar.querySelectorAll('.nav-btn')) {
    btn.addEventListener('click', closeDrawer);
  }
}

// Command Palette (Ctrl + K)
const PALETTE_DATA = [
  // 1. Chuyển trang & Hành động nhanh
  { id: 'action-join-direct', cat: 'pages', catName: 'Hành động nhanh', title: 'Bắt Đầu Chuyến Sinh Tồn (Steam Direct)', desc: 'Tự động mở The Isle Evrima và kết nối thẳng vào máy chủ Xóm Gáy', badge: 'Chơi ngay', action: () => { window.location.href = 'steam://connect/play.xomgay.online:7777'; showToast('Đang kết nối vào game qua Steam...'); } },
  { id: 'page-home', cat: 'pages', catName: 'Chuyển trang nhanh', title: 'Trang chủ', desc: 'Bảng tin máy chủ Xóm Gáy, thông số và hướng dẫn', badge: 'Trang', action: () => switchTab('home') },
  { id: 'page-game', cat: 'pages', catName: 'Chuyển trang nhanh', title: 'Dino Live Monitor (Game HUD)', desc: 'Theo dõi sinh tồn GAS realtime: Máu, đói, khát, Prime Elder', badge: 'Trang', action: () => switchTab('game') },
  { id: 'page-map', cat: 'pages', catName: 'Chuyển trang nhanh', title: 'Bản đồ Gateway Live', desc: 'Bản đồ vệ tinh thời gian thực, waypoint và radar định vị', badge: 'Trang', action: () => switchTab('map') },
  { id: 'page-gara', cat: 'pages', catName: 'Chuyển trang nhanh', title: 'Gara Khủng Long', desc: 'Kho lưu trữ an toàn, cất và lấy dino chơi', badge: 'Trang', action: () => switchTab('gara') },
  { id: 'page-ranking', cat: 'pages', catName: 'Chuyển trang nhanh', title: 'Bảng Xếp Hạng & Chiến Tích', desc: 'Top hạ gục, kỷ lục sống lâu, lịch sử sinh tồn', badge: 'Trang', action: () => switchTab('ranking') },
  { id: 'page-skin', cat: 'pages', catName: 'Chuyển trang nhanh', title: 'Skin Studio', desc: 'Phối màu 10 phân vùng khủng long, xuất mã màu ingame', badge: 'Trang', action: () => switchTab('skin') },
  { id: 'page-voice', cat: 'pages', catName: 'Chuyển trang nhanh', title: 'Voice 3D', desc: 'Đàm thoại định hướng 3D theo khoảng cách trong game', badge: 'Trang', action: () => switchTab('voice') },
  { id: 'action-tour', cat: 'pages', catName: 'Hành động nhanh', title: 'Tour Hướng Dẫn Tính Năng & Bản Đồ AI', desc: 'Bắt đầu chuyến tham quan các tính năng Gara, Bản đồ AI trực tiếp, Voice 3D và Overlay', badge: 'Tour', action: () => startTour(0) },
  { id: 'page-overlay', cat: 'pages', catName: 'Chuyển trang nhanh', title: 'Game Overlay HUD', desc: 'Cấu hình khung đè mini map, vitals lên màn hình', badge: 'Trang', action: () => switchTab('overlay') },

  // 2. Tra cứu loài khủng long
  { id: 'dino-carno', cat: 'species', catName: 'Loài Khủng Long', title: 'Carnotaurus (Carno)', desc: 'Ăn thịt · Tốc độ phi nước đại cực nhanh, cú húc sừng tàn khốc', badge: 'Ăn thịt', action: () => { switchTab('skin'); window.skin3d?.selectSpecies?.('Carnotaurus'); showToast('Đã chọn loài Carnotaurus trong Skin Studio'); } },
  { id: 'dino-cera', cat: 'species', catName: 'Loài Khủng Long', title: 'Ceratosaurus (Cera)', desc: 'Ăn thịt · Ăn xác thối kháng bệnh, cú cắn khóa xương', badge: 'Ăn thịt', action: () => { switchTab('skin'); window.skin3d?.selectSpecies?.('Ceratosaurus'); showToast('Đã chọn loài Ceratosaurus trong Skin Studio'); } },
  { id: 'dino-trex', cat: 'species', catName: 'Loài Khủng Long', title: 'Tyrannosaurus Rex (T-Rex)', desc: 'Ăn thịt · Đỉnh chuỗi thức ăn kỷ Jura, lực cắn nghiền nát con mồi', badge: 'Ăn thịt', action: () => { switchTab('skin'); window.skin3d?.selectSpecies?.('Tyrannosaurus'); showToast('Đã chọn loài T-Rex trong Skin Studio'); } },
  { id: 'dino-deino', cat: 'species', catName: 'Loài Khủng Long', title: 'Deinosuchus (Cá sấu Deino)', desc: 'Ăn thịt · Thủy quái đầm lầy phục kích, cú đớp tử thần lôi xuống nước', badge: 'Thủy quái', action: () => { switchTab('skin'); window.skin3d?.selectSpecies?.('Deinosuchus'); showToast('Đã chọn loài Deinosuchus trong Skin Studio'); } },
  { id: 'dino-stego', cat: 'species', catName: 'Loài Khủng Long', title: 'Stegosaurus (Stego)', desc: 'Ăn cỏ · Giáp gai kiên cố, đuôi chùy gai quất chết kẻ săn mồi', badge: 'Ăn cỏ', action: () => { switchTab('skin'); window.skin3d?.selectSpecies?.('Stegosaurus'); showToast('Đã chọn loài Stegosaurus trong Skin Studio'); } },
  { id: 'dino-galli', cat: 'species', catName: 'Loài Khủng Long', title: 'Gallimimus (Galli)', desc: 'Ăn tạp · Nhanh nhất trên thảo nguyên, trốn thoát kẻ thù siêu hạng', badge: 'Ăn tạp', action: () => { switchTab('skin'); window.skin3d?.selectSpecies?.('Gallimimus'); showToast('Đã chọn loài Gallimimus trong Skin Studio'); } },
  { id: 'dino-dilo', cat: 'species', catName: 'Loài Khủng Long', title: 'Dilophosaurus (Dilo)', desc: 'Ăn thịt · Sát thủ bóng đêm, tiêm chất độc gây ảo giác con mồi', badge: 'Ăn thịt', action: () => { switchTab('skin'); window.skin3d?.selectSpecies?.('Dilophosaurus'); showToast('Đã chọn loài Dilophosaurus trong Skin Studio'); } },
  { id: 'dino-pachy', cat: 'species', catName: 'Loài Khủng Long', title: 'Pachycephalosaurus (Pachy)', desc: 'Ăn cỏ · Hộp sọ vòm thép, cú húc đầu gây gãy xương choáng váng', badge: 'Ăn cỏ', action: () => { switchTab('skin'); window.skin3d?.selectSpecies?.('Pachycephalosaurus'); showToast('Đã chọn loài Pachy trong Skin Studio'); } },
  { id: 'dino-troodon', cat: 'species', catName: 'Loài Khủng Long', title: 'Troodon', desc: 'Ăn thịt · Thợ săn bầy đàn ban đêm, độc tố tích tụ gây tê liệt', badge: 'Ăn thịt', action: () => { switchTab('skin'); window.skin3d?.selectSpecies?.('Troodon'); showToast('Đã chọn loài Troodon trong Skin Studio'); } },
  { id: 'dino-herrera', cat: 'species', catName: 'Loài Khủng Long', title: 'Herrerasaurus (Herrera)', desc: 'Ăn thịt · Leo trèo thân cây, phục kích bổ nhào từ ngọn cao', badge: 'Ăn thịt', action: () => { switchTab('skin'); window.skin3d?.selectSpecies?.('Herrerasaurus'); showToast('Đã chọn loài Herrerasaurus trong Skin Studio'); } },
  { id: 'dino-beipi', cat: 'species', catName: 'Loài Khủng Long', title: 'Beipiaosaurus (Beipi)', desc: 'Ăn tạp · Bơi lội siêu đẳng dưới sông suối, săn cá và trốn thoát', badge: 'Ăn tạp', action: () => { switchTab('skin'); window.skin3d?.selectSpecies?.('Beipiaosaurus'); showToast('Đã chọn loài Beipiaosaurus trong Skin Studio'); } },
  { id: 'dino-tenonto', cat: 'species', catName: 'Loài Khủng Long', title: 'Tenontosaurus (Tenonto)', desc: 'Ăn cỏ · Cú đá hậu bẻ gãy hàm kẻ săn mồi và quật ngã bằng đuôi', badge: 'Ăn cỏ', action: () => { switchTab('skin'); window.skin3d?.selectSpecies?.('Tenontosaurus'); showToast('Đã chọn loài Tenontosaurus trong Skin Studio'); } },
  { id: 'dino-hypsi', cat: 'species', catName: 'Loài Khủng Long', title: 'Hypsilophodon (Hypsi)', desc: 'Ăn cỏ · Kích thước nhỏ, nhảy cao và phun dịch axit làm mù', badge: 'Ăn cỏ', action: () => { switchTab('skin'); window.skin3d?.selectSpecies?.('Hypsilophodon'); showToast('Đã chọn loài Hypsilophodon trong Skin Studio'); } },

  // 3. Tra cứu & Sao chép lệnh chat ingame
  { id: 'cmd-unstuck', cat: 'commands', catName: 'Lệnh Chat In-Game (1-Click Copy)', title: '!unstuck', desc: 'Cứu hộ kẹt địa hình - Dịch chuyển về mặt đất an toàn khi dính khe đá', badge: 'Lệnh chat', action: () => copyAndToast('!unstuck') },
  { id: 'cmd-slay', cat: 'commands', catName: 'Lệnh Chat In-Game (1-Click Copy)', title: '!slay', desc: 'Tự giải thoát - Tự sát an toàn để quay lại sảnh chọn loài mới', badge: 'Lệnh chat', action: () => copyAndToast('!slay') },
  { id: 'cmd-status', cat: 'commands', catName: 'Lệnh Chat In-Game (1-Click Copy)', title: '!status', desc: 'Kiểm tra chỉ số - In thông số máu, đói, khát và tọa độ GPS vào chat', badge: 'Lệnh chat', action: () => copyAndToast('!status') },
  { id: 'cmd-prime', cat: 'commands', catName: 'Lệnh Chat In-Game (1-Click Copy)', title: '!prime', desc: 'Nhiệm vụ Prime - Xem số điều kiện Prime Elder đã đạt trong đời sống', badge: 'Lệnh chat', action: () => copyAndToast('!prime') },
  { id: 'cmd-gara', cat: 'commands', catName: 'Lệnh Chat In-Game (1-Click Copy)', title: '!gara', desc: 'Gara Khủng Long - Mở lệnh cất hoặc khôi phục dino trong game', badge: 'Lệnh chat', action: () => copyAndToast('!gara') },
  { id: 'cmd-grow', cat: 'commands', catName: 'Lệnh Chat In-Game (1-Click Copy)', title: '!grow', desc: 'Tăng trưởng - Kiểm tra tỷ lệ tăng trưởng và phần trăm dinh dưỡng', badge: 'Lệnh chat', action: () => copyAndToast('!grow') },
  { id: 'cmd-coords', cat: 'commands', catName: 'Lệnh Chat In-Game (1-Click Copy)', title: '!coords', desc: 'Tọa độ GPS - Hiển thị vị trí X, Y, Z hiện tại của dino', badge: 'Lệnh chat', action: () => copyAndToast('!coords') },
  { id: 'cmd-pack', cat: 'commands', catName: 'Lệnh Chat In-Game (1-Click Copy)', title: '!pack', desc: 'Quản lý bầy đàn - Xem danh sách thành viên hoặc tạo lời mời vào đàn', badge: 'Lệnh chat', action: () => copyAndToast('!pack') },
  { id: 'cmd-skin', cat: 'commands', catName: 'Lệnh Chat In-Game (1-Click Copy)', title: '!skin', desc: 'Áp dụng skin - Nhập chuỗi mã màu đã phối từ Skin Studio vào nhân vật', badge: 'Lệnh chat', action: () => copyAndToast('!skin') },
  { id: 'cmd-rules', cat: 'commands', catName: 'Lệnh Chat In-Game (1-Click Copy)', title: '!rules', desc: 'Luật máy chủ - Xem tóm tắt quy định chống mix-pack, combat-log ingame', badge: 'Lệnh chat', action: () => copyAndToast('!rules') },

  // 4. Địa danh bản đồ Gateway
  { id: 'loc-highlands', cat: 'locations', catName: 'Địa Danh Bản Đồ Gateway', title: 'Hồ Highlands (Highlands Lake)', desc: 'Điểm nóng săn mồi và nguồn nước ngọt trung tâm hòn đảo Gateway', badge: 'Địa danh', action: () => { switchTab('map'); showToast('Đang xem bản đồ Gateway: Khu vực Hồ Highlands'); } },
  { id: 'loc-sanctuary', cat: 'locations', catName: 'Địa Danh Bản Đồ Gateway', title: 'Vòm Sanctuary (Vùng An Toàn)', desc: 'Vùng bảo hộ ong bướm, an toàn cho khủng long non (Juvi) lớn lên', badge: 'Địa danh', action: () => { switchTab('map'); showToast('Đang xem bản đồ Gateway: Vòm Bảo Hộ Sanctuary'); } },
  { id: 'loc-swamp', cat: 'locations', catName: 'Địa Danh Bản Đồ Gateway', title: 'Đầm Lầy North Swamp', desc: 'Vùng đầm lầy nước đục hiểm trở, lãnh địa rình mồi của Deinosuchus', badge: 'Địa danh', action: () => { switchTab('map'); showToast('Đang xem bản đồ Gateway: Đầm Lầy North Swamp'); } },
  { id: 'loc-salt', cat: 'locations', catName: 'Địa Danh Bản Đồ Gateway', title: 'Bãi Muối Liếm (Salt Lick)', desc: 'Khoáng chất thiết yếu cho khủng long ăn cỏ hồi phục thể lực', badge: 'Địa danh', action: () => { switchTab('map'); showToast('Đang xem bản đồ Gateway: Bãi Muối Liếm'); } },
  { id: 'loc-salmon', cat: 'locations', catName: 'Địa Danh Bản Đồ Gateway', title: 'Suối Cá Hồi (Salmon Stream)', desc: 'Nguồn thức ăn dồi dào cho các loài bơi lội Beipi và bay Ptera', badge: 'Địa danh', action: () => { switchTab('map'); showToast('Đang xem bản đồ Gateway: Suối Cá Hồi'); } },
  { id: 'loc-dam', cat: 'locations', catName: 'Địa Danh Bản Đồ Gateway', title: 'Đập Nước Lớn (Water Dam)', desc: 'Công trình thủy điện trung tâm nối các bờ vực sâu', badge: 'Địa danh', action: () => { switchTab('map'); showToast('Đang xem bản đồ Gateway: Đập Nước Lớn'); } },
  { id: 'loc-plains', cat: 'locations', catName: 'Địa Danh Bản Đồ Gateway', title: 'Đồng Cỏ South Plains', desc: 'Thảo nguyên mênh mông, bầy đàn ăn cỏ tụ tập kiếm ăn', badge: 'Địa danh', action: () => { switchTab('map'); showToast('Đang xem bản đồ Gateway: Đồng Cỏ South Plains'); } },
];

function initCommandPalette() {
  const modal = $('cmd-palette-modal');
  const input = $('cmd-search-input');
  const list = $('cmd-results-list');
  const openBtn = $('cmd-open-btn');
  const closeBtn = $('cmd-close-btn');

  if (!modal || !input || !list) return;

  const openPalette = () => {
    modal.hidden = false;
    input.value = '';
    renderPalette('');
    setTimeout(() => input.focus(), 40);
  };

  const closePalette = () => {
    modal.hidden = true;
  };

  if (openBtn) openBtn.addEventListener('click', openPalette);
  if (closeBtn) closeBtn.addEventListener('click', closePalette);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closePalette();
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (modal.hidden) openPalette();
      else closePalette();
    } else if (e.key === 'Escape' && !modal.hidden) {
      e.preventDefault();
      closePalette();
    }
  });

  input.addEventListener('input', () => {
    renderPalette(input.value.trim().toLowerCase());
  });

  input.addEventListener('keydown', (e) => {
    const items = list.querySelectorAll('.cmd-item');
    if (items.length === 0) return;
    let activeIdx = Array.from(items).findIndex((el) => el.classList.contains('active'));

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = activeIdx < items.length - 1 ? activeIdx + 1 : 0;
      items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
      items[activeIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = activeIdx > 0 ? activeIdx - 1 : items.length - 1;
      items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
      items[activeIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && items[activeIdx]) {
        items[activeIdx].click();
      }
    }
  });

  function renderPalette(query) {
    const filtered = PALETTE_DATA.filter((item) => {
      if (!query) return true;
      return (
        item.title.toLowerCase().includes(query) ||
        item.desc.toLowerCase().includes(query) ||
        item.catName.toLowerCase().includes(query)
      );
    });

    if (filtered.length === 0) {
      list.innerHTML = `
        <div style="padding:28px 16px;text-align:center;color:var(--text-muted)">
          <div style="font-size:24px;margin-bottom:8px">🔍</div>
          <div>Không tìm thấy kết quả phù hợp với "<b>${esc(query)}</b>"</div>
        </div>`;
      return;
    }

    const cats = ['pages', 'species', 'commands', 'locations'];
    let html = '';
    let globalIdx = 0;

    for (const c of cats) {
      const groupItems = filtered.filter((i) => i.cat === c);
      if (groupItems.length === 0) continue;

      html += `<div class="cmd-group-label">${esc(groupItems[0].catName)}</div>`;
      for (const item of groupItems) {
        const isFirst = globalIdx === 0;
        const iconSvg = c === 'pages' ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
          : c === 'species' ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>'
          : c === 'commands' ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>'
          : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/></svg>';

        html += `
          <div class="cmd-item${isFirst ? ' active' : ''}" data-cmd-id="${esc(item.id)}">
            <div class="cmd-item-left">
              <div class="cmd-item-icon">${iconSvg}</div>
              <div style="min-width:0">
                <div class="cmd-item-title">${esc(item.title)}</div>
                <div class="cmd-item-desc">${esc(item.desc)}</div>
              </div>
            </div>
            <span class="cmd-item-badge">${esc(item.badge)}</span>
          </div>`;
        globalIdx++;
      }
    }

    list.innerHTML = html;

    list.querySelectorAll('.cmd-item').forEach((el) => {
      el.addEventListener('click', () => {
        const item = PALETTE_DATA.find((i) => i.id === el.dataset.cmdId);
        if (item) {
          closePalette();
          item.action();
        }
      });
      el.addEventListener('mouseenter', () => {
        list.querySelectorAll('.cmd-item').forEach((i) => i.classList.remove('active'));
        el.classList.add('active');
      });
    });
  }
}

function initGarageFilter() {
  const searchInput = $('gara-search-input');
  const filterBtns = document.querySelectorAll('.gara-diet-tabs .gara-filter-btn');
  const previewBtn = $('gara-preview-btn');

  let currentDiet = 'all';
  let currentSearch = '';

  const CARNIVORES = ['carnotaurus', 'ceratosaurus', 'tyrannosaurus', 't-rex', 'deinosuchus', 'dilophosaurus', 'troodon', 'herrerasaurus', 'pteranodon'];
  const HERBIVORES = ['stegosaurus', 'tenontosaurus', 'pachycephalosaurus', 'gallimimus', 'beipiaosaurus', 'hypsilophodon', 'diabloceratops', 'maiasaura', 'ankylosaurus'];

  const applyFilter = () => {
    const cards = document.querySelectorAll('#gara-slots-list .garage-slot-card');
    cards.forEach((card) => {
      const text = card.textContent.toLowerCase();
      const matchSearch = !currentSearch || text.includes(currentSearch);
      let matchDiet = true;
      if (currentDiet === 'carnivore') {
        matchDiet = CARNIVORES.some((c) => text.includes(c));
      } else if (currentDiet === 'herbivore') {
        matchDiet = HERBIVORES.some((h) => text.includes(h));
      }
      card.style.display = matchSearch && matchDiet ? '' : 'none';
    });
  };

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearch = e.target.value.trim().toLowerCase();
      applyFilter();
    });
  }

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentDiet = btn.dataset.diet || 'all';
      applyFilter();
    });
  });

  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      garagePreviewTiers = !garagePreviewTiers;
      previewBtn.classList.toggle('active', garagePreviewTiers);
      previewBtn.textContent = garagePreviewTiers ? '✕ Tắt xem hiệu ứng' : '👁️ Xem hiệu ứng thẻ';
      const list = $('gara-slots-list');
      if (list) delete list.dataset.key;
      renderGara(lastMeData);
    });
  }

  window._reapplyGarageFilter = applyFilter;
}

// ============================================================================
// 2. Vitals & Prime & Skin Utilities
// ============================================================================
const VITALS = [
  ['health', 'Máu (Health)', '#ef4444'],
  ['stamina', 'Thể lực (Stamina)', '#f59e0b'],
  ['hunger', 'Dạ dày (Hunger)', '#84cc16'],
  ['thirst', 'Nước (Thirst)', '#3b82f6'],
  ['blood', 'Huyết (Blood)', '#b91c1c'],
  ['oxygen', 'Oxy (Oxygen)', '#06b6d4'],
];

function buildVitalsGrid(dino) {
  return VITALS.map(([k, label, color]) => `
    <div class="vital-card" data-v="${k}">
      <div class="vital-header">
        <span class="vital-name">${label}</span>
        <span class="vital-val">--</span>
      </div>
      <div class="vital-track">
        <div class="vital-fill" style="background:${color};width:0%"></div>
      </div>
    </div>
  `).join('');
}

function updateVitals(dino) {
  if (!dino || !dino.vitals) return;
  for (const card of document.querySelectorAll('#game-vitals .vital-card')) {
    const k = card.dataset.v;
    const cur = dino.vitals[k];
    const max = dino.max?.[k];
    const ratio = typeof max === 'number' && max > 0 && typeof cur === 'number' ? Math.max(0, Math.min(1, cur / max)) : null;

    const fill = card.querySelector('.vital-fill');
    const val = card.querySelector('.vital-val');

    fill.style.width = ratio === null ? '100%' : `${(ratio * 100).toFixed(1)}%`;
    fill.style.opacity = ratio === null ? '0.4' : '1';
    val.textContent = typeof cur !== 'number' ? '?' : ratio === null ? `${Math.round(cur)}` : `${Math.round(cur)} / ${Math.round(max)}`;
    card.classList.toggle('low', ratio !== null && ratio < 0.25);
  }
}

function renderPrimeBoard(pb) {
  if (!pb) {
    return '<p class="muted" style="font-size:13px">Dino của bạn chưa mở khóa hệ thống nhiệm vụ Prime Elder.</p>';
  }
  const verdict = pb.isPrime ? '<span class="tag">Đã là Prime Elder</span>'
    : pb.eligible ? '<span class="tag">Game: Đủ điều kiện Prime</span>'
    : '<span class="tag kill">Game: Chưa đủ điều kiện</span>';

  const g = typeof pb.growth === 'number' ? pb.growth : null;
  const deadline = g === null ? '' : `
    <div class="prime-deadline-track" title="Growth ${pct(g)} / Mốc ${pct(pb.deadline)}">
      <div class="prime-deadline-fill" style="width:${Math.min(100, g * 100).toFixed(1)}%"></div>
      <i class="prime-marker" style="left:${pb.deadline * 100}%"></i>
    </div>
    <div class="muted" style="font-size:12px;margin-bottom:14px">
      ${pb.locked ? `Growth ${pct(g)}: Đã qua mốc ${pct(pb.deadline)}: Kết quả Prime đã chốt.`
        : `Growth ${pct(g)}: Còn tới mốc ${pct(pb.deadline)} để hoàn thành tối thiểu 5 nhiệm vụ.`}
    </div>`;

  const rows = pb.conditions.map((c, i) => `
    <li class="quest-item ${c.met ? 'met' : ''}">
      <span class="quest-check">${c.met === null ? '?' : c.met ? '✓' : (i + 1)}</span>
      <div>
        <b>${esc(c.label)}</b>
        ${c.passive ? ' <span class="muted" style="font-size:11.5px">(thụ động: mặc định đạt nếu không vi phạm)</span>' : ''}
      </div>
    </li>
  `).join('');

  return `
    <div class="prime-summary">
      <div><b>${pb.met} / 10 điều kiện đạt</b> <span class="muted">(cần ${pb.needed ?? 5}, vài loài được tặng sẵn điều kiện 10)</span></div>
      <div>${verdict}</div>
    </div>
    ${deadline}
    <ul class="quest-list">${rows}</ul>
    <p class="muted" style="font-size:11.5px;margin:12px 0 0">
      Trạng thái ✓ được ghi nhận trực tiếp từ game engine (EligiblePrimeElderData).
    </p>`;
}

// The 10 skin regions, the palettes and the colour conversions: shared with the admin panel (skin-editor.js).


// Skin effects a player may set (pawn.SkinEffects), 0–1; they dry / fade in game.
const EFFECTS = [['Wet', 'Ướt'], ['Mud', 'Bùn'], ['Blood', 'Máu'], ['Dirt', 'Bẩn'], ['Dust', 'Bụi'], ['Duckweed', 'Bèo']];
/**
 * Glow ("brighter than white") is made by admins only now (panel → Vật phẩm → Skin: a skin
 * item a player is given, then wears): the bridge takes 0–1 from this editor. Kept at 1.
 */
const GLOW_MAX = 1;


const skinStrip = (skin) => {
  if (!skin || !skin.colors) return '';
  const colors = REGIONS.filter(([k]) => skin.colors[k]).slice(0, 5)
    .map(([k]) => `<i style="display:inline-block;width:12px;height:12px;border-radius:3px;border:1px solid rgba(255,255,255,0.2);background:${hex(skin.colors[k])}"></i>`)
    .join('');
  return `<span style="display:inline-flex;gap:3px;vertical-align:middle;margin-left:8px">${colors}</span>`;
};

// ============================================================================
// 3. Skin editor: colours per region, pattern / theme / variation, a preview,
//    and "apply" onto the dino played now (POST /api/skin → the game).
// ============================================================================

// What the editor starts with: a real Carnotaurus skin from this server
// (the game's linear colours), so the preview looks like a dino at once.
const DEFAULT_SKIN = {
  colors: DEFAULT_COLORS,
  patternIndex: 0, themeIndex: 0, variation: 0,
};


/** The editor's skin now: colours as "#rrggbb" per region, pattern, theme, variation. */
function editorSkin() {
  const colors = {};
  for (const [id] of REGIONS) colors[id] = $(`picker-${id}`).value;
  return {
    colors,
    pattern: Math.max(0, Math.min(2, Math.round(Number($('skin-pattern').value) || 0))),
    theme: Math.max(0, Math.min(20, Math.round(Number($('skin-theme').value) || 0))),
    variation: Math.max(0, Math.min(20, Math.round(Number($('skin-variation').value) || 0))),
    glow: Math.max(1, Math.min(GLOW_MAX, Number($('skin-glow').value) || 1)),
    effects: $('skin-fx-on').checked
      ? Object.fromEntries(EFFECTS.map(([id]) => [id, Math.max(0, Math.min(1, (Number($(`fx-${id}`).value) || 0) / 100))]))
      : null,
  };
}

/** Put a skin in the editor: `colors` in the game's linear values (from the game) or "#rrggbb" (a code, a saved skin). */
function applySkin(skin) {
  for (const [id] of REGIONS) {
    const c = skin.colors?.[id];
    if (!c) continue;
    const col = typeof c === 'string' ? c : hex(c);
    $(`picker-${id}`).value = col;
    $(`hex-${id}`).value = col;
  }
  const pattern = skin.pattern ?? skin.patternIndex;
  const theme = skin.theme ?? skin.themeIndex;
  if (typeof pattern === 'number') $('skin-pattern').value = String(pattern);
  if (typeof theme === 'number') $('skin-theme').value = String(theme);
  if (typeof skin.variation === 'number') {
    $('skin-variation').value = String(Math.round(skin.variation));
    $('skin-variation-val').textContent = String(Math.round(skin.variation));
  }
  if (typeof skin.glow === 'number') setGlow(skin.glow);
  if (skin.effects && typeof skin.effects === 'object') {
    $('skin-fx-on').checked = true;
    for (const [id] of EFFECTS) setEffect(id, Math.round((Number(skin.effects[id]) || 0) * 100));
  }
  skinChanged();
}

function setGlow(g) {
  const v = Math.max(1, Math.min(GLOW_MAX, Number(g) || 1));
  $('skin-glow').value = String(v);
  $('skin-glow-val').textContent = `${v.toFixed(1)}×`;
}
function setEffect(id, pct) {
  $(`fx-${id}`).value = String(pct);
  $(`fx-${id}-val`).textContent = `${pct}%`;
}

/** The preview follows the editor: the 3D model (skin3d.js) when there is one, else the colours side by side. */
function skinChanged() {
  const sk = editorSkin();
  $('skin-flat').innerHTML = REGIONS.map(([id, label]) =>
    `<div style="background:${sk.colors[id]}">${esc(label)}</div>`).join('');
  window.skin3dLastSkin = sk;          // for skin3d.js if it loads after this
  window.skin3d?.setSkin?.(sk);
}

function skinStatus(kind, html) {
  const el = $('skin-status');
  el.hidden = !html;
  el.className = `garage-status${kind ? ` ${kind}` : ''}`;
  el.innerHTML = html ?? '';
}

let skinBusy = false;
async function sendSkin() {
  if (skinBusy) return;
  if (!lastMeData?.dino) { skinStatus('bad', 'Vào game và điều khiển một con dino để áp dụng. Bạn vẫn chỉnh và xem trước được.'); return; }
  skinBusy = true;
  $('btn-skin-apply').disabled = true;
  const sk = editorSkin();
  const body = { pattern: sk.pattern, theme: sk.theme, variation: sk.variation, colors: {} };
  const k = (v) => Math.min(GLOW_MAX, Math.round(v * sk.glow * 10000) / 10000);
  for (const [id] of REGIONS) { const c = linearOf(sk.colors[id]); body.colors[id] = { r: k(c.r), g: k(c.g), b: k(c.b) }; }
  if (LAB) {
    if (sk.effects) body.effects = sk.effects;
    body.keep = $('skin-keep').checked;
  } else {
    // Not released yet: plain colours only.
    for (const [id] of REGIONS) body.colors[id] = linearOf(sk.colors[id]);
  }
  skinStatus('', 'Đang gửi…');
  try {
    const r = await fetch('/api/skin', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res = await r.json().catch(() => null);
    if (r.status === 429) { skinStatus('bad', 'Chậm lại chút: mỗi vài giây chỉ một lần.'); return; }
    if (r.status !== 202 || typeof res?.id !== 'number') {
      skinStatus('bad', `Không gửi được${res?.error ? `: ${esc(res.error)}` : ''}.`);
      return;
    }
    skinStatus('', 'Đã gửi, chờ game đổi màu…');
    const done = await waitCommand(res.id, 20, (b) => b?.status === 'done');
    if (done === null) { skinStatus('bad', 'Chưa thấy game trả lời. Thử lại sau ít phút.'); return; }
    const msgs = (done.messages ?? []).map((m) => esc(m)).join(' ');
    if (!done.ok) {
      const err = done.error ? esc(ERROR_VI[done.error] ?? done.error) : '';
      skinStatus('bad', `❌ ${msgs || err || 'Game không đổi được màu.'}`);
      return;
    }
    skinStatus('ok', `✅ ${msgs || 'Đã đổi màu dino.'} Nhìn lại dino trong game.`);
  } catch {
    skinStatus('bad', 'Mất kết nối, thử lại.');
  } finally {
    skinBusy = false;
    $('btn-skin-apply').disabled = false;
  }
}

// A skin code: "XG1." + base64url of { p, t, v, c: { Body: "rrggbb", … } }, short enough to paste in chat.
function skinCode(sk) {
  const c = {};
  for (const [id] of REGIONS) c[id] = sk.colors[id].replace('#', '');
  const extra = {};
  if (sk.glow > 1) extra.g = Math.round(sk.glow * 10) / 10;
  if (sk.effects) extra.e = Object.fromEntries(Object.entries(sk.effects).map(([id, v]) => [id, Math.round(v * 100)]));
  const b64 = btoa(JSON.stringify({ p: sk.pattern, t: sk.theme, v: sk.variation, c, ...extra }));
  return `XG1.${b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
function parseSkinCode(text) {
  const m = /^XG1\.([A-Za-z0-9_-]+)$/.exec(String(text).trim());
  if (!m) return null;
  try {
    const d = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
    const colors = {};
    for (const [id] of REGIONS) if (/^[0-9a-f]{6}$/i.test(d.c?.[id] ?? '')) colors[id] = `#${d.c[id].toLowerCase()}`;
    if (Object.keys(colors).length === 0) return null;
    const effects = d.e && typeof d.e === 'object'
      ? Object.fromEntries(EFFECTS.map(([id]) => [id, Math.max(0, Math.min(100, Number(d.e[id]) || 0)) / 100])) : null;
    return { colors, pattern: Number(d.p) || 0, theme: Number(d.t) || 0, variation: Number(d.v) || 0,
      glow: Number(d.g) || 1, ...(effects ? { effects } : {}) };
  } catch {
    return null;
  }
}

// Saved skins: this browser only (localStorage may be off: then nothing is kept).
const SKINS_KEY = 'xg.skins.v1';
function loadSaved() {
  try { const v = JSON.parse(localStorage.getItem(SKINS_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function storeSaved(list) {
  try { localStorage.setItem(SKINS_KEY, JSON.stringify(list.slice(0, 30))); } catch { /* private window: not kept */ }
}
function renderSaved() {
  const list = loadSaved();
  const listEl = $('skin-saved-list');
  if (!listEl) return;
  if (list.length === 0) {
    listEl.innerHTML = '<li class="muted" style="font-size:12.5px;padding:12px 0;text-align:center">Chưa có skin nào được lưu trên trình duyệt này.</li>';
    return;
  }
  listEl.innerHTML = list.map((it, i) => {
    const parsed = parseSkinCode(it.code);
    const colors = parsed?.colors ?? {};
    const stripes = REGIONS.map(([id]) => {
      const c = colors[id] ?? '#333';
      return `<i style="background:${esc(c)}" title="${id}: ${esc(c)}"></i>`;
    }).join('');
    return `
      <li class="saved-skin-card">
        <div class="saved-skin-header">
          <div class="preset-stripe saved-stripe">${stripes}</div>
          <span class="saved-skin-name" title="${esc(it.name)}">${esc(it.name)}</span>
        </div>
        <div class="saved-skin-actions">
          <button type="button" class="btn btn-ghost btn-saved-load" data-load="${i}" title="Nạp skin này">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            <span>Nạp</span>
          </button>
          <button type="button" class="btn btn-ghost btn-saved-del" data-del="${i}" title="Xoá skin này">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            <span>Xoá</span>
          </button>
        </div>
      </li>`;
  }).join('');
}

/** The colours kept for the next times (/api/me keptSkins), with a way to stop keeping them. */
function renderKept(kept) {
  const names = Object.keys(kept ?? {});
  const box = $('skin-kept');
  const key = JSON.stringify(kept ?? {});
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.hidden = names.length === 0;
  box.innerHTML = names.length === 0 ? '' : `<span class="muted">Đang giữ màu cho:</span> ${names.map((sp) => {
    const kColors = kept[sp]?.colors ?? {};
    const stripes = REGIONS.map(([id]) => {
      const c = kColors[id] ? hex(kColors[id]) : '#555';
      return `<i style="background:${c}"></i>`;
    }).join('');
    return `<span class="kept-chip">
      <div class="preset-stripe" style="width:48px;height:12px;display:inline-flex;border-radius:3px;overflow:hidden;vertical-align:middle;margin-right:6px">${stripes}</div>
      ${esc(sp.replace(/^BP_/, '').replace(/_C$/, ''))}
      <button type="button" data-forget="${esc(sp)}" title="Bỏ giữ màu">✕</button>
    </span>`;
  }).join('')}`;
}

function initSkinEditor() {
  // The region list (picker-<Region> / hex-<Region>): the shared editor, as the panel's.
  mountRegions($('skin-regions-grid'), { colors: Object.fromEntries(REGIONS.map(([id]) => [id, hex(DEFAULT_SKIN.colors[id])])), onChange: skinChanged });
  for (const id of ['skin-pattern', 'skin-theme']) $(id).addEventListener('input', skinChanged);

  // Skin effects: sliders, off until ticked (then sent with "Áp dụng").
  $('skin-fx-grid').innerHTML = EFFECTS.map(([id, label]) => `
    <label class="fx-item"><span>${label}</span><b id="fx-${id}-val">0%</b>
      <input type="range" id="fx-${id}" min="0" max="100" step="5" value="0"></label>`).join('');
  const fxOn = () => $('skin-fx-grid').classList.toggle('off', !$('skin-fx-on').checked);
  $('skin-fx-on').addEventListener('change', () => { fxOn(); skinChanged(); });
  for (const [id] of EFFECTS) {
    $(`fx-${id}`).addEventListener('input', () => {
      $(`fx-${id}-val`).textContent = `${$(`fx-${id}`).value}%`;
      if (!$('skin-fx-on').checked) { $('skin-fx-on').checked = true; fxOn(); }
      skinChanged();
    });
  }
  fxOn();
  $('skin-glow').addEventListener('input', () => { setGlow($('skin-glow').value); skinChanged(); });
  $('skin-variation').addEventListener('input', () => {
    $('skin-variation-val').textContent = $('skin-variation').value;
    skinChanged();
  });

  // Presets: a whole palette per theme (the shared editor's): the preview shows it; "Áp dụng" puts it in game.
  mountPresets($('skin-presets-bar'), (colors) => applySkin({ colors }));


  // Load from the dino played now.
  $('btn-load-my-skin').addEventListener('click', () => {
    if (!lastMeData?.dino?.skin?.colors) {
      skinStatus('bad', 'Chưa có dữ liệu skin của dino đang chơi. Hãy vào game và điều khiển dino.');
      return;
    }
    // Through fromGame: a region the species does not use (0, 0, 0 in game) gets a stand-in, not black.
    const g = lastMeData.dino.skin;
    const view = window.Dino3D?.fromGame(g);
    applySkin(view ? { ...view, pattern: g.patternIndex, theme: g.themeIndex, variation: g.variation } : g);
    skinStatus('', 'Đã lấy màu từ dino đang chơi.');
  });

  $('btn-skin-apply').addEventListener('click', () => { void sendSkin(); });
  $('skin-kept').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-forget]');
    if (!b) return;
    b.disabled = true;
    const r = await fetch('/api/skin', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ forget: b.dataset.forget }) }).catch(() => null);
    if (r?.ok) { b.closest('.kept-chip')?.remove(); skinStatus('', 'Đã bỏ giữ màu cho loài đó.'); } else b.disabled = false;
  });

  $('btn-skin-export').addEventListener('click', () => {
    const code = skinCode(editorSkin());
    $('skin-code').value = code;
    navigator.clipboard?.writeText(code).then(() => skinStatus('ok', 'Đã chép mã skin.'), () => undefined);
  });
  $('btn-skin-import').addEventListener('click', () => {
    const sk = parseSkinCode($('skin-code').value);
    if (!sk) { skinStatus('bad', 'Mã skin không hợp lệ.'); return; }
    applySkin(sk);
    skinStatus('ok', 'Đã nạp mã skin. Bấm "Áp dụng" để đổi màu trong game.');
  });

  $('btn-skin-save').addEventListener('click', () => {
    const name = $('skin-save-name').value.trim() || `Skin ${new Date().toLocaleString('vi-VN')}`;
    const list = loadSaved().filter((it) => it.name !== name);
    list.unshift({ name, code: skinCode(editorSkin()) });
    storeSaved(list);
    $('skin-save-name').value = '';
    renderSaved();
  });
  $('skin-saved-list').addEventListener('click', (e) => {
    const load = e.target.closest('[data-load]');
    const del = e.target.closest('[data-del]');
    const list = loadSaved();
    if (load) { const sk = parseSkinCode(list[Number(load.dataset.load)]?.code); if (sk) applySkin(sk); }
    if (del) { list.splice(Number(del.dataset.del), 1); storeSaved(list); renderSaved(); }
  });

  renderSaved();
  applySkin(DEFAULT_SKIN);
}

// ============================================================================
// 4. Data Rendering Functions
// ============================================================================
let map = null;
let lastMeData = null;
let lastBoardData = null;
let currentRankingTab = 'kills';

function renderAuth(me) {
  const authContainer = $('auth-actions');
  const heroAuth = $('hero-auth-btn');

  if (me) {
    authContainer.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <span class="muted" style="font-size:13px;font-weight:600">👤 ${esc(me.name ?? me.steamId)}</span>
        <button type="button" class="btn btn-ghost" id="logout-btn" style="padding:6px 12px;font-size:12px">Đăng xuất</button>
      </div>`;
    $('logout-btn').addEventListener('click', async () => {
      await fetch('/auth/logout', { method: 'POST' });
      location.reload();
    });

    if (heroAuth) {
      heroAuth.innerHTML = `
        <button type="button" class="btn btn-emerald" data-switch-tab="game">
          🦖 Vào Bảng Điều Khiển Dino
        </button>`;
    }
  } else {
    authContainer.innerHTML = `
      <a class="btn btn-steam" href="/auth/steam" style="padding:7px 14px;font-size:12px">
        Đăng nhập Steam
      </a>`;
    if (heroAuth) {
      heroAuth.innerHTML = `
        <a class="btn btn-steam" href="/auth/steam">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 1 10 10c0 4.88-3.5 8.94-8.1 9.8l-2.45-3.5c.34-.1.65-.27.9-.5l.05-.05c1.4-1.37 1.4-3.6 0-4.97a3.53 3.53 0 0 0-4.96 0c-.26.25-.43.55-.53.88L3.2 12.3A10 10 0 0 1 12 2zm-4.3 13.9a2.12 2.12 0 1 1 3-3 2.12 2.12 0 0 1-3 3zm10.7-3.9a1.41 1.41 0 1 1 0-2.82 1.41 1.41 0 0 1 0 2.82z"/></svg>
          Đăng nhập bằng Steam
        </a>`;
    }
  }
}

function renderServer(srv) {
  const sidebarSlots = $('sidebar-slots');
  if (!srv || srv.status !== 200) {
    $('srv-dot').className = 'dot';
    $('srv-status-text').textContent = 'Server đang tắt hoặc mất kết nối';
    $('srv-slots-text').textContent = '0 / 100';
    $('srv-meter-fill').style.width = '0%';
    if (sidebarSlots) sidebarSlots.textContent = '0 / 100 slot';
    return;
  }
  const isUp = srv.body.phase === 'running';
  const online = srv.body.online ?? 0;
  const max = srv.body.maxPlayers ?? 100;

  // Name and Discord from the server's Game.ini (bridge: publicServerInfo).
  if (srv.body.name) { $('srv-name').textContent = srv.body.name; document.title = srv.body.name; }
  const discord = $('srv-discord');
  if (discord) {
    if (typeof srv.body.discord === 'string' && /^https:\/\/discord(app)?\.(gg|com)\//.test(srv.body.discord)) {
      discord.href = srv.body.discord;
      discord.hidden = false;
    } else {
      discord.hidden = true;
    }
  }
  const pctSlots = Math.min(100, Math.round((online / max) * 100));

  $('srv-dot').className = `dot${isUp ? ' up' : ''}`;
  $('srv-status-text').textContent = isUp ? 'Máy chủ đang hoạt động' : 'Máy chủ đang khởi động lại…';
  $('srv-slots-text').textContent = `${online} / ${max}`;
  $('srv-meter-fill').style.width = `${pctSlots}%`;
  if (sidebarSlots) sidebarSlots.textContent = `${online} / ${max} slot`;
}

function getHeroCardTier(dino) {
  if (!dino) return DINO_TIERS.fossil;
  const stacks = typeof dino.prime?.elderStacks === 'number' ? dino.prime.elderStacks
    : typeof dino.elderStacks === 'number' ? dino.elderStacks
    : typeof dino.generation === 'number' ? Math.max(0, dino.generation - 1)
    : 0;

  if (stacks >= 3) return DINO_TIERS.apex;
  if (stacks === 2) return DINO_TIERS.rex;
  if (stacks === 1) return DINO_TIERS.dna;
  const isPrime = dino.prime?.prime === true || dino.prime === true;
  if (isPrime) return DINO_TIERS.amber;
  return DINO_TIERS.fossil;
}

function updateHeroTierFx(dino) {
  const card = $('game-hero-card');
  const fx = $('game-hero-fx');
  const badge = $('game-dino-tier-badge');
  if (!card || !fx) return;

  const tier = getHeroCardTier(dino);

  card.classList.remove('tier-fossil', 'tier-amber', 'tier-dna', 'tier-rex', 'tier-apex', 'prime');
  card.classList.add(tier.key === 'amber' ? 'tier-amber' : tier.className);
  if (tier.level > 0) card.classList.add('prime');

  fx.innerHTML = renderSlotFx(tier);

  if (badge) {
    badge.className = `ftag f${tier.level}`;
    badge.textContent = `F${tier.level}`;
    badge.title = `F${tier.level} · ${TIER_NAME[tier.level] ?? ''}`;
    badge.hidden = false;
  }

  const hubCard = $('hub-dino-card');
  if (hubCard) {
    hubCard.classList.remove('tier-fossil', 'tier-amber', 'tier-dna', 'tier-rex', 'tier-apex', 'prime');
    hubCard.classList.add(tier.key === 'amber' ? 'tier-amber' : tier.className);
    if (tier.level > 0) hubCard.classList.add('prime');
  }
}

/** "1 giờ 5 phút" / "45 phút", as the server says it. */
function prisonDur(sec) {
  const m = Math.max(1, Math.round(Math.max(0, sec) / 60));
  const h = Math.floor(m / 60);
  return h === 0 ? `${m} phút` : m % 60 === 0 ? `${h} giờ` : `${h} giờ ${m % 60} phút`;
}
/** Serving a prison sentence (bridge prison.ts): what is left, and how it runs. */
function renderPrison(p) {
  const el = $('game-prison');
  if (!el) return;
  el.hidden = !p;
  if (!p) return;
  el.classList.toggle('escaped', p.escaped === true);
  el.innerHTML = p.escaped
    ? `<b>🚨 Bạn đang vượt ngục</b> — cả server thấy vị trí của bạn trên bản đồ, ai hạ được bạn sẽ được ghi công. Án còn <b>${esc(prisonDur(p.remainingSec))}</b>, chỉ trừ khi bạn quay lại khu tù.`
    : `<b>🔒 Bạn đang ở tù</b> — còn <b>${esc(prisonDur(p.remainingSec))}</b> (${esc(p.offense)}: ${esc(p.reason)}). Án chỉ trừ khi bạn online và ở trong khu tù; trong tù không lớn, không đói khát, không mất máu, không dùng được gara.`;
}
function renderGame(me) {
  renderPrison(me.prison ?? null);
  const navBadge = $('nav-dino-badge');
  if (me.dino && me.online) {
    navBadge.hidden = false;
    $('game-dino-species').textContent = me.dino.species ?? 'Dino Đang Chơi';
    $('game-dino-status').textContent = 'Đang trực tuyến trên server Gateway';
    { const st = growthStage(me.dino.growth); $('game-dino-growth').textContent = `${st.icon} Growth: ${pct(me.dino.growth)}`; $('game-dino-growth').title = st.name; }
    $('game-growth-pct').textContent = pct(me.dino.growth);
    $('game-growth-fill').style.width = `${Math.min(100, Math.max(0, (me.dino.growth ?? 0) * 100))}%`;

    // Build vitals structure if not yet built
    if ($('game-vitals').children.length === 0) {
      $('game-vitals').innerHTML = buildVitalsGrid(me.dino);
    }
    updateVitals(me.dino);

    // Prime
    $('game-prime-content').innerHTML = renderPrimeBoard(me.dino.prime);

    renderGame3d(me.dino);

    // The skin preview shows the dino played now (skin3d.js), unless the player picked another.
    window.skin3dLive = { species: me.dino.species, female: me.dino.skin?.female };
    window.skin3d?.follow?.(me.dino.species, me.dino.skin?.female);

    // Active skin swatches
    if (me.dino.skin && me.dino.skin.colors) {
      $('skin-active-swatches-box').hidden = false;
      const chips = REGIONS.filter(([k]) => me.dino.skin.colors[k]).map(([k, label]) => `
        <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:8px;background:var(--bg-surface);border:1px solid var(--border);font-size:12px">
          <i style="width:12px;height:12px;border-radius:3px;background:${hex(me.dino.skin.colors[k])}"></i>
          <span>${label}: <b>${hex(me.dino.skin.colors[k])}</b></span>
        </div>
      `).join('');
      $('skin-active-swatches').innerHTML = chips;
    }
    // Sync Launcher Hub card if present
    const hubSp = $('hub-dino-species');
    if (hubSp) {
      hubSp.textContent = me.dino.species ?? 'Dino Đang Chơi';
      if ($('hub-dino-badge')) { $('hub-dino-badge').textContent = '● ĐANG CHƠI'; $('hub-dino-badge').className = 'hub-chip-live online'; }
      if ($('hub-dino-status')) $('hub-dino-status').textContent = 'Đang trực tuyến trên server Gateway';
      if ($('hub-dino-growth')) { const st = growthStage(me.dino.growth); $('hub-dino-growth').textContent = `${st.icon} Growth: ${pct(me.dino.growth)}`; $('hub-dino-growth').title = st.name; }
      if ($('hub-growth-pct')) $('hub-growth-pct').textContent = pct(me.dino.growth);
      if ($('hub-growth-fill')) $('hub-growth-fill').style.width = `${Math.min(100, Math.max(0, (me.dino.growth ?? 0) * 100))}%`;
      const vit = me.dino.vitals ?? {};
      const mx = me.dino.max ?? {};
      for (const [k, idVal, idFill] of [
        ['health', 'hub-val-health', 'hub-fill-health'],
        ['stamina', 'hub-val-stamina', 'hub-fill-stamina'],
        ['hunger', 'hub-val-hunger', 'hub-fill-hunger'],
        ['thirst', 'hub-val-thirst', 'hub-fill-thirst'],
      ]) {
        const cur = vit[k], m = mx[k];
        const valEl = $(idVal), fillEl = $(idFill);
        if (valEl) valEl.textContent = typeof cur === 'number' ? Math.round(cur) : '--';
        if (fillEl) fillEl.style.width = typeof cur === 'number' && m > 0 ? `${Math.min(100, Math.max(0, Math.round(cur / m * 100)))}%` : '0%';
      }
      if ($('hub-prime-text')) $('hub-prime-text').textContent = me.dino.prime ? '👑 Đã đạt danh hiệu Prime' : 'Nhiệm vụ Prime đang theo dõi';
    }
  } else {
    navBadge.hidden = true;
    $('game-dino-species').textContent = me.online ? 'Đang chọn loài' : 'Chưa vào server';
    $('game-dino-status').textContent = me.online ? 'Bạn đang ở sảnh chọn dino ingame.' : 'Vào game để hiển thị đầy đủ chỉ số và vị trí.';
    $('game-dino-growth').textContent = '🥚 Growth: 0%';
    $('game-growth-pct').textContent = '0%';
    $('game-growth-fill').style.width = '0%';
    $('game-vitals').innerHTML = '<p class="muted" style="grid-column:1/-1;padding:12px 0;margin:0">Chưa có chỉ số sinh tồn của dino.</p>';
    $('game-prime-content').innerHTML = '<p class="muted" style="font-size:13px">Dino chưa spawn trên bản đồ.</p>';
    $('skin-active-swatches-box').hidden = true;
    renderGame3d(null);

    const hubSp = $('hub-dino-species');
    if (hubSp) {
      hubSp.textContent = me.online ? 'Đang chọn loài' : 'Chưa vào server';
      if ($('hub-dino-badge')) { $('hub-dino-badge').textContent = me.online ? '○ SẢNH CHỜ' : '○ CHƯA VÀO'; $('hub-dino-badge').className = 'hub-chip-live offline'; }
      if ($('hub-dino-status')) $('hub-dino-status').textContent = me.online ? 'Bạn đang ở sảnh chọn dino ingame.' : 'Bấm Chơi Ngay ở trên để kết nối vào máy chủ.';
      if ($('hub-dino-growth')) $('hub-dino-growth').textContent = '🥚 Growth: 0%';
      if ($('hub-growth-pct')) $('hub-growth-pct').textContent = '0%';
      if ($('hub-growth-fill')) $('hub-growth-fill').style.width = '0%';
      for (const idVal of ['hub-val-health', 'hub-val-stamina', 'hub-val-hunger', 'hub-val-thirst']) {
        if ($(idVal)) $(idVal).textContent = '--';
      }
      for (const idFill of ['hub-fill-health', 'hub-fill-stamina', 'hub-fill-hunger', 'hub-fill-thirst']) {
        if ($(idFill)) $(idFill).style.width = '0%';
      }
      if ($('hub-prime-text')) $('hub-prime-text').textContent = 'Vào game để kích hoạt nhiệm vụ';
    }
  }
  renderKept(me.keptSkins);
  updateHeroTierFx(me.online && me.dino ? me.dino : null);

  // Lifetime Stats
  const s = me.stats;
  $('game-stats-grid').innerHTML = [
    ['⚔️ Số Mạng Hạ Gục (Kills)', s.kills],
    ['💀 Số Lần Tử Vong (Deaths)', s.deaths],
    ['🥚 Số Lần Sinh Ra (Spawns)', s.spawns],
    ['⏱️ Tổng Giờ Chơi', dur(s.playtime)],
    ['👑 Đời Sống Lâu Nhất', dur(s.longestLife)],
    ['🎮 Số Phiên Chơi', s.sessions],
  ].map(([title, val]) => `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:14px 18px;text-align:center">
      <div class="muted" style="font-size:12px;margin-bottom:4px">${title}</div>
      <b style="font-size:20px;letter-spacing:-0.01em">${esc(val)}</b>
    </div>
  `).join('');
}

// ---- Web garage: the player's own store / redeem --------------------------
// POST /api/garage → the bridge queues it → DinoGarage runs it in game. A
// store counts down while the dino stands still (5 m, no damage dealt or
// taken); /api/command/<id> gives the start (accepted or refused, with the
// game's reply) and then how the countdown ended. Slots are numbered by the
// game (1, 2, 3…) and not shown: the player just stores and redeems.

let garageBusy = false;          // a command in flight (buttons disabled)
let storing = null;              // { until: ms } while a store counts down

// Redeem replies come in English; the store ones are already Vietnamese.
const REPLY_VI = [
  [/^Garage cooldown: wait (\d+) s\.$/, (m) => `Gara đang hồi: chờ ${m[1]} giây.`],
  [/^Your garage is empty\.$/, () => 'Gara của bạn đang trống.'],
  [/^Slot '.+' is empty or unreadable\.$/, () => 'Con dino này không còn trong gara.'],
  [/^Respawn first, then type !redeem\.$/, () => 'Hãy respawn trước rồi mới lấy ra.'],
  [/^Wrong species.*$/, () => 'Sai loài. Respawn đúng loài đã cất rồi thử lại.'],
  [/^Restoring '.+' at the spot you stored it\..*$/, () => 'Đang khôi phục tại chỗ đã cất, đứng yên vài giây.'],
  [/^Restoring '.+'\..*$/, () => 'Đang khôi phục, đứng yên vài giây.'],
  [/^Slot '.+' has no stored position.*$/, () => 'Con này không có vị trí đã cất: khôi phục tại chỗ.'],
  [/^Slot '.+' could not be taken out.*$/, () => 'Không lấy được con dino này ra. Thử lại.'],
];
const reply = (m) => {
  for (const [re, fn] of REPLY_VI) { const x = re.exec(m); if (x) return fn(x); }
  return m;
};
const ERROR_VI = {
  offline: 'Bạn cần đang ở trong game (server không thấy bạn online).',
  expired: 'Game không kịp nhận lệnh (server bận hoặc đang khởi động lại). Thử lại sau.',
  bad_arguments: 'Lựa chọn không hợp lệ.',
  failed: 'Lệnh gặp lỗi trong game. Thử lại.',
};
// How a store countdown ended (DinoGarage garage_store_result reasons).
const FINAL_VI = {
  moved: 'bạn đã rời khỏi bán kính 5 m',
  damage_dealt: 'bạn đã gây sát thương',
  damage_taken: 'bạn đã chịu sát thương',
  left: 'bạn đã thoát game hoặc dino đã chết',
  not_same_dino: 'không còn là con dino lúc bắt đầu cất',
  full: 'gara đã đầy',
  capture_failed: 'không đọc được trạng thái dino',
  save_failed: 'không lưu được vào gara',
  kill_failed: 'không gỡ được dino khỏi game',
};

function garageStatus(kind, html) {
  const el = $('gara-status');
  el.hidden = !html;
  el.className = `garage-status${kind ? ` ${kind}` : ''}`;
  el.innerHTML = html ?? '';
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** Poll one command until `done(body)` says so or `seconds` pass; null on timeout. */
async function waitCommand(id, seconds, done) {
  for (let i = 0; i < seconds; i++) {
    await sleep(1000);
    const c = await getJson(`/api/command/${id}`);
    if (c.status === 200 && done(c.body)) return c.body;
  }
  return null;
}

async function sendGarage(action, slot, where) {
  if (garageBusy) return;
  garageBusy = true;
  renderGara(lastMeData);
  garageStatus('', action === 'store' ? 'Đang gửi lệnh cất…' : 'Đang gửi lệnh lấy ra…');
  try {
    const r = await fetch('/api/garage', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...(slot ? { slot } : {}), ...(where ? { where } : {}) }),
    });
    const body = await r.json().catch(() => null);
    if (r.status === 429) { garageStatus('bad', 'Chậm lại chút: mỗi vài giây chỉ một lệnh.'); return; }
    if (r.status !== 202 || typeof body?.id !== 'number') {
      garageStatus('bad', `Không gửi được lệnh${body?.error ? `: ${esc(body.error)}` : ''}.`);
      return;
    }
    garageStatus('', 'Đã gửi, chờ game xử lý…');
    // 1) Did the game take it? (the mod polls its inbox every 2 s)
    const start = await waitCommand(body.id, 20, (b) => b?.status === 'done');
    if (start === null) { garageStatus('bad', 'Chưa thấy game trả lời. Thử lại sau ít phút.'); return; }
    const msgs = (start.messages ?? []).map((m) => `<li>${esc(reply(m))}</li>`).join('');
    if (!start.ok) {
      const err = start.error ? esc(ERROR_VI[start.error] ?? start.error) : '';
      garageStatus('bad', `❌ ${err || 'Game từ chối lệnh.'}${msgs ? `<ul>${msgs}</ul>` : ''}`);
      return;
    }
    if (action === 'redeem') {
      garageStatus('ok', `✅ Game đang khôi phục dino.${msgs ? `<ul>${msgs}</ul>` : ''}`);
      return;
    }
    // 2) A store: the countdown runs in game; wait for how it ends.
    const secs = lastMeData?.garageRules?.storeCountdown ?? 30;
    storing = { until: Date.now() + secs * 1000 };
    garageStatus('', `⏳ Game đã nhận lệnh, đang đếm ngược.${msgs ? `<ul>${msgs}</ul>` : ''}`);
    garageBusy = false;
    renderGara(lastMeData);
    const end = await waitCommand(body.id, secs + 20, (b) => b?.final != null);
    storing = null;
    if (end === null) {
      garageStatus('bad', 'Không nhận được kết quả cất. Kiểm tra lại gara sau ít giây.');
    } else if (end.final.ok) {
      garageStatus('ok', '✅ Đã cất dino vào gara. Respawn đúng loài rồi bấm <b>Lấy ra</b> khi muốn chơi lại.');
    } else {
      garageStatus('bad', `❌ Cất thất bại: ${esc(FINAL_VI[end.final.reason] ?? end.final.reason ?? 'không rõ lý do')}. Bạn có thể cất lại ngay.`);
    }
  } catch {
    garageStatus('bad', 'Mất kết nối khi gửi lệnh. Thử lại.');
  } finally {
    garageBusy = false;
    renderGara(lastMeData);
  }
}

$('gara-store-btn').addEventListener('click', () => sendGarage('store'));
$('gara-slots-list').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-redeem]');
  if (!b || b.disabled) return;
  const rules = lastMeData?.garageRules;
  sendGarage('redeem', b.dataset.redeem, rules?.redeemAt === 'choice' ? $('gara-where').value : undefined);
});

// What a stored dino has LEFT (as stored = as it comes back): the remaining
// amount, and how full that is (the maximum is only used for the %). Old
// slots have no max health: the amount alone then, never a made-up bar.
const SLOT_VITALS = [['health', 'Máu', '#ef4444'], ['stamina', 'Stamina', '#f59e0b'], ['thirst', 'Nước', '#3b82f6']];
function slotVitals(g) {
  if (!g.vitals || SLOT_VITALS.every(([k]) => typeof g.vitals[k] !== 'number')) {
    return g.gift ? '<div class="muted" style="font-size:11.5px;margin-top:8px">Chỉ số do admin đặt khi tạo.</div>' : '';
  }
  return `<div class="slot-vitals">${SLOT_VITALS.map(([k, label, color]) => {
    const v = g.vitals[k]; const m = g.max?.[k];
    if (typeof v !== 'number') return '';
    const ratio = typeof m === 'number' && m > 0 ? Math.max(0, Math.min(1, v / m)) : null;
    return `<div class="sv"><span>${label}</span>
      <div class="sv-track"><i style="width:${ratio === null ? 100 : (ratio * 100).toFixed(0)}%;background:${color};opacity:${ratio === null ? 0.35 : 1}"></i></div>
      <b title="${ratio === null ? '' : `còn ${Math.round(v)} / tối đa ${Math.round(m)}`}">${Math.round(v).toLocaleString('vi-VN')}${ratio === null ? '' : ` · ${Math.round(ratio * 100)}%`}</b></div>`;
  }).join('')}</div>`;
}

// ============================================================================
// 5 Cấp độ tiến hoá Gara: Khảo cổ học chuyển mình thành sinh vật sống
// ============================================================================
const DINO_TIERS = {
  fossil: { level: 0, key: 'fossil', className: 'tier-fossil' },
  amber: { level: 1, key: 'amber', className: 'tier-amber prime' },
  dna: { level: 2, key: 'dna', className: 'tier-dna' },
  rex: { level: 3, key: 'rex', className: 'tier-rex' },
  apex: { level: 4, key: 'apex', className: 'tier-apex' },
};

/**
 * The growth stage beside a growth %: the marks where the game opens the
 * mutation slots (25 / 50 / 75 %, measured on this server) and the full grown.
 * The launcher's overlay has the same table (overlay-page.js GROWTH_STAGES).
 */
const GROWTH_STAGES = [[1, '🦖', 'Trưởng thành'], [0.75, '🦕', 'Cận lớn'], [0.5, '🦎', 'Thiếu niên'], [0.25, '🐣', 'Con non'], [0, '🥚', 'Sơ sinh']];
function growthStage(g) {
  const v = typeof g === 'number' ? g : 0;
  const [, icon, name] = GROWTH_STAGES.find(([min]) => v + 1e-6 >= min) ?? GROWTH_STAGES[GROWTH_STAGES.length - 1];
  return { icon, name };
}

/**
 * The tier as a badge: F0 (not prime) … F4 (đời 4), the text moving in the
 * tier's own colours (index.html .ftag) — on the garage cards and the dino panel.
 */
const TIER_NAME = ['Cơ bản', 'Prime', 'Prime đời 2', 'Prime đời 3', 'Prime đời 4'];
function tierBadge(tier, extra = '') {
  return `<span class="ftag f${tier.level}${extra ? ` ${extra}` : ''}" title="F${tier.level} · ${TIER_NAME[tier.level] ?? ''}">F${tier.level}</span>`;
}

function getDinoTier(g) {
  if (g.tier === 'apex' || g.tier === 4) return DINO_TIERS.apex;
  if (g.tier === 'rex' || g.tier === 3) return DINO_TIERS.rex;
  if (g.tier === 'dna' || g.tier === 2) return DINO_TIERS.dna;
  if (g.tier === 'amber' || g.tier === 1) return DINO_TIERS.amber;
  if (g.tier === 'fossil' || g.tier === 0) return DINO_TIERS.fossil;

  const stacks = typeof g.elderStacks === 'number' ? g.elderStacks
    : typeof g.generation === 'number' ? Math.max(0, g.generation - 1)
    : 0;

  if (stacks >= 3) return DINO_TIERS.apex;
  if (stacks === 2) return DINO_TIERS.rex;
  if (stacks === 1) return DINO_TIERS.dna;
  if (g.prime) return DINO_TIERS.amber;
  return DINO_TIERS.fossil;
}

function renderSlotFx(tier) {
  if (tier.key === 'amber') {
    return `
      <div class="slot-tier-fx tier-amber-fx" aria-hidden="true">
        <div class="amber-gloss-sheen"></div>
        <div class="amber-specular-light"></div>
        <svg class="amber-crackle-svg" viewBox="0 0 320 200" preserveAspectRatio="none">
          <path d="M 0,35 L 50,60 L 85,45 L 125,80 L 145,70 M 85,45 L 100,18 M 125,80 L 160,125 L 195,115 L 245,160 M 195,115 L 215,90 L 280,75 M 245,160 L 285,195 M 160,125 L 145,170 L 170,195 M 215,90 L 250,40" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </div>`;
  }
  if (tier.key === 'dna') {
    return `
      <div class="slot-tier-fx tier-dna-fx" aria-hidden="true">
        <svg class="dna-veins-svg" viewBox="0 0 320 200" preserveAspectRatio="none">
          <path class="dna-capillary c1" d="M -10,120 Q 35,95 65,115 T 135,88 T 215,118 T 330,80" fill="none" />
          <path class="dna-capillary c2" d="M 40,-5 Q 65,50 115,65 T 185,48 T 265,78 T 325,25" fill="none" />
          <path class="dna-capillary c3" d="M 75,205 Q 120,150 170,162 T 255,138 T 315,175" fill="none" />
          <path class="dna-capillary c4" d="M 115,65 Q 145,105 135,88" fill="none" />
          <circle class="dna-node n1" cx="65" cy="115" r="3.2" />
          <circle class="dna-node n2" cx="185" cy="48" r="3.2" />
          <circle class="dna-node n3" cx="255" cy="138" r="3.2" />
        </svg>
      </div>`;
  }
  if (tier.key === 'rex') {
    return `
      <div class="slot-tier-fx tier-rex-fx" aria-hidden="true">
        <div class="rex-flame-aura"></div>
        <svg class="rex-cracks-svg" viewBox="0 0 320 120" preserveAspectRatio="none">
          <path d="M 160,120 L 148,88 L 115,72 L 78,82 M 148,88 L 175,62 L 162,35 L 202,15 M 175,62 L 218,72 L 260,55 M 115,72 L 95,45 L 60,38" fill="none" stroke="currentColor" stroke-width="1.8" />
        </svg>
      </div>`;
  }
  if (tier.key === 'apex') {
    return `
      <div class="slot-tier-fx tier-apex-fx" aria-hidden="true">
        <div class="apex-fire-sweep"></div>
        <div class="apex-eye-box">
          <svg class="apex-eye-svg" viewBox="0 0 100 50">
            <defs>
              <radialGradient id="apexIrisGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#fef08a" />
                <stop offset="40%" stop-color="#f97316" />
                <stop offset="80%" stop-color="#dc2626" />
                <stop offset="100%" stop-color="#450a0a" />
              </radialGradient>
            </defs>
            <path class="eye-lid-upper" d="M 6,25 Q 50,-4 94,25" fill="none" stroke="rgba(239,68,68,0.75)" stroke-width="1.6" />
            <path class="eye-lid-lower" d="M 6,25 Q 50,54 94,25" fill="none" stroke="rgba(239,68,68,0.75)" stroke-width="1.6" />
            <ellipse class="eye-sclera" cx="50" cy="25" rx="36" ry="16" fill="rgba(185,28,28,0.32)" />
            <ellipse class="eye-iris" cx="50" cy="25" rx="18" ry="15" fill="url(#apexIrisGrad)" />
            <polygon class="eye-pupil" points="49,11 51,11 52,25 51,39 49,39 48,25" fill="#050101" />
            <ellipse class="eye-glint" cx="44" cy="20" rx="3" ry="1.5" fill="#ffffff" />
          </svg>
        </div>
        <svg class="apex-claws-svg" viewBox="0 0 160 160" preserveAspectRatio="none">
          <path class="claw-slash s1" d="M 22,6 L 148,132" fill="none" />
          <path class="claw-slash s2" d="M 38,0 L 162,126" fill="none" />
          <path class="claw-slash s3" d="M 10,26 L 132,148" fill="none" />
        </svg>
      </div>`;
  }
  return `
    <div class="slot-tier-fx tier-fossil-fx" aria-hidden="true">
      <div class="fossil-grit-overlay"></div>
    </div>`;
}

let garagePreviewTiers = false;
const DEMO_TIER_SLOTS = [
  {
    slot: 'demo-fossil',
    species: 'Carnotaurus',
    growth: 0.65,
    storedAt: Date.now() - 3600_000 * 3,
    gift: false,
    prime: false,
    primeTasks: { done: 3, eligible: false },
    vitals: { health: 950, stamina: 85, thirst: 75 },
    max: { health: 1400, stamina: 100, thirst: 100 },
    tier: 'fossil',
    skin: null,
  },
  {
    slot: 'demo-amber',
    species: 'Stegosaurus',
    growth: 1.0,
    storedAt: Date.now() - 3600_000 * 20,
    gift: false,
    prime: true,
    primeTasks: { done: 10, eligible: true },
    vitals: { health: 3200, stamina: 100, thirst: 100 },
    max: { health: 3200, stamina: 100, thirst: 100 },
    tier: 'amber',
    skin: null,
  },
  {
    slot: 'demo-dna',
    species: 'Ceratosaurus',
    growth: 1.0,
    storedAt: Date.now() - 3600_000 * 35,
    gift: false,
    prime: true,
    elderStacks: 1,
    primeTasks: { done: 10, eligible: true },
    vitals: { health: 2100, stamina: 100, thirst: 90 },
    max: { health: 2100, stamina: 100, thirst: 100 },
    tier: 'dna',
    skin: null,
  },
  {
    slot: 'demo-rex',
    species: 'Tyrannosaurus',
    growth: 1.0,
    storedAt: Date.now() - 3600_000 * 60,
    gift: false,
    prime: true,
    elderStacks: 2,
    primeTasks: { done: 10, eligible: true },
    vitals: { health: 5800, stamina: 95, thirst: 95 },
    max: { health: 5800, stamina: 100, thirst: 100 },
    tier: 'rex',
    skin: null,
  },
  {
    slot: 'demo-apex',
    species: 'Deinosuchus',
    growth: 1.0,
    storedAt: Date.now() - 3600_000 * 90,
    gift: false,
    prime: true,
    elderStacks: 3,
    primeTasks: { done: 10, eligible: true },
    vitals: { health: 8000, stamina: 100, thirst: 100 },
    max: { health: 8000, stamina: 100, thirst: 100 },
    tier: 'apex',
    skin: null,
  },
];

function renderGara(me) {
  if (!me) return;
  const rules = me.garageRules ?? { maxSlots: 2, redeemAt: 'current', storeCountdown: 30 };
  $('nav-gara-badge').textContent = me.garage.length;
  $('gara-count-tag').textContent = garagePreviewTiers ? 'Demo hiệu ứng' : `${me.garage.length} / ${rules.maxSlots}`;
  $('gara-where-box').hidden = rules.redeemAt !== 'choice';
  const hubGaraSub = $('hub-gara-sub');
  if (hubGaraSub) {
    hubGaraSub.textContent = me.garage.length > 0 ? `${me.garage.length}/${rules.maxSlots} dino` : 'Cất & Khôi phục';
  }

  // Store: needs a dino in game, a free place, nothing in flight.
  const playing = Boolean(me.online && me.dino);
  const full = me.garage.length >= rules.maxSlots;
  // The admin's minimums (the game checks them again when storing).
  const d = me.dino;
  const hpPct = d && typeof d.vitals?.health === 'number' && d.max?.health > 0 ? d.vitals.health / d.max.health * 100 : null;
  const growPct = d && typeof d.growth === 'number' ? d.growth * 100 : null;
  const lowHp = rules.minHealthPct > 0 && hpPct !== null && hpPct < rules.minHealthPct;
  const young = rules.minGrowthPct > 0 && growPct !== null && growPct < rules.minGrowthPct - 1e-6;
  $('gara-store-btn').disabled = garageBusy || Boolean(storing) || !playing || full || lowHp || young;
  $('gara-store-hint').textContent = storing
    ? `Đang cất: còn ${Math.max(0, Math.ceil((storing.until - Date.now()) / 1000))} giây: đứng yên trong bán kính 5 m, không đánh và không bị đánh.`
    : !me.online ? 'Vào game để cất / lấy dino.'
    : !me.dino ? 'Chọn loài và spawn dino trước.'
    : full ? `Gara đã đầy (${rules.maxSlots}), lấy bớt một con ra trước.`
    : lowHp ? `Máu phải từ ${rules.minHealthPct}% trở lên mới cất được (đang ${Math.floor(hpPct)}%).`
    : young ? `Dino phải lớn từ ${rules.minGrowthPct}% trở lên mới cất được (đang ${Math.floor(growPct)}%).`
    : `Cất ${me.dino.species ?? 'dino'} đang chơi: đếm ngược ${rules.storeCountdown} giây, trong lúc đó đứng yên (trong 5 m), không đánh và không bị đánh.`;

  const sourceGarage = garagePreviewTiers ? DEMO_TIER_SLOTS : me.garage;

  if (sourceGarage.length === 0) {
    delete $('gara-slots-list').dataset.key;
    $('gara-slots-list').innerHTML = `
      <li style="padding:32px 16px;text-align:center;background:var(--bg-surface);border-radius:12px;border:1px solid var(--border)">
        <div style="font-size:32px;margin-bottom:8px">🚗</div>
        <b>Gara của bạn đang trống</b>
        <p class="muted" style="margin:4px 0 0;font-size:12px">Bấm <b>Cất dino đang chơi</b> ở trên để cất, hoặc bấm <b>Xem hiệu ứng thẻ</b> để xem hoạt ảnh.</p>
      </li>`;
    return;
  }

  const rows = sourceGarage.map((g) => {
    // Redeem: online, playing the SAME species (the mod checks it too).
    const isDemo = Boolean(garagePreviewTiers);
    const same = me.dino && g.species && me.dino.species === g.species;
    const why = isDemo ? 'Mẫu thử nghiệm cấp độ'
      : !me.online ? 'Vào game trước'
      : !me.dino ? `Spawn ${g.species ?? 'đúng loài'} trước`
      : !same ? `Respawn thành ${g.species ?? 'đúng loài'} để lấy ra`
      : '';
    const tier = getDinoTier(g);
    return { g, why, tier, isDemo };
  });
  // Rebuild only when something shown changes.
  const key = JSON.stringify([
    garagePreviewTiers,
    rows.map(({ g, why, tier }) => [g.slot, g.species, g.growth, g.storedAt, g.gift, g.prime, g.primeTasks, g.vitals, g.max, g.skin, g.elderStacks, tier.key, why]),
    garageBusy,
  ]);
  const list = $('gara-slots-list');
  if (list.dataset.key === key) { placeSlot3d(rows.map(({ g }) => g)); return; }
  list.dataset.key = key;
  list.innerHTML = rows.map(({ g, why, tier, isDemo }) => `
    <li class="garage-slot-card stacked ${tier.className}" data-tier="${tier.key}">
      ${renderSlotFx(tier)}
      <div class="garage-slot-body">
        <div class="slot-3d-spot" data-slot3d="${esc(g.slot)}"></div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px">
            <b style="font-size:15px">${esc(g.species ?? 'Dino')}</b>
            <span class="tag" title="${growthStage(g.growth).name}">${growthStage(g.growth).icon} Growth ${pct(g.growth)}</span>
            ${tierBadge(tier)}
            ${g.gift ? '<span class="tag purple">Quà Admin</span>' : ''}
          </div>
          ${skinStrip(g.skin)}
          ${g.primeTasks ? `<div style="margin-top:6px"><span class="tag${g.primeTasks.eligible ? '' : ' warning'}" title="Nhiệm vụ prime đã hoàn thành">Nhiệm vụ ${g.primeTasks.done}/10${g.primeTasks.eligible ? ' · đủ điều kiện' : ''}</span></div>` : ''}
          <div class="muted" style="font-size:12px;margin-top:4px">Cất lúc: ${when(g.storedAt)}${why ? ` · ${esc(why)}` : ''}</div>
          ${slotVitals(g)}
        </div>
        <button type="button" class="btn btn-emerald slot-redeem" data-redeem="${esc(g.slot)}" ${why || garageBusy || isDemo ? 'disabled' : ''}>${isDemo ? '👁️ Mẫu demo' : '📤 Lấy ra'}</button>
      </div>
    </li>`).join('');
  placeSlot3d(rows.map(({ g }) => g));
  window._reapplyGarageFilter?.();
}

// Each garage slot in 3D, in the colours it was stored with. A slot keeps its
// viewer (and its canvas) across list rebuilds: the box is moved, not re-made.
// Released to everyone (2026-10-01), the launcher included: no longer lab-only.
const slotViewers = new Map();   // slot -> { box, viewer, key }
function placeSlot3d(slots) {
  // Only while the Gara tab is shown (renderGara runs every second): a model is loaded when first seen.
  if (!window.Dino3D || !$('gara-slots-list').offsetParent) return;
  const keep = new Set();
  for (const g of slots) {
    if (!g.species) continue;
    const spot = document.querySelector(`[data-slot3d="${CSS.escape(g.slot)}"]`);
    let v = slotViewers.get(g.slot);
    if (!spot && !v?.box.isConnected) continue;      // not in the list (yet)
    keep.add(g.slot);
    if (!v) {
      const box = document.createElement('div');
      box.className = 'slot-3d';
      v = { box, viewer: window.Dino3D.create(box, { interactive: false, autoRotate: true, fit: 0.95 }), key: null };
      slotViewers.set(g.slot, v);
    }
    if (spot) spot.replaceWith(v.box);
    const key = JSON.stringify([g.species, g.skin]);
    if (v.key !== key) {
      v.key = key;
      // Not shown (the files did not come, even after skin3d's retries): tried again a little later.
      void v.viewer.show(g.species, window.Dino3D.fromGame(g.skin) ?? { colors: {} })
        .then((ok) => { if (!ok) setTimeout(() => { if (v.key === key) v.key = null; }, 20000); });
    }
  }
  for (const slot of [...slotViewers.keys()]) if (!keep.has(slot)) slotViewers.delete(slot);
}

// The dino played now, in 3D (tab Game): shown while there is one, re-coloured when its skin changes.
let gameViewer = null, gameViewerKey = null;
function renderGame3d(dino) {
  const box = $('game-3d');
  if (!LAB || !dino?.species || !window.Dino3D) { box.hidden = true; return; }
  box.hidden = false;
  if (!box.offsetParent) return;          // the Game tab is not shown: load nothing yet
  if (!gameViewer) gameViewer = window.Dino3D.create(box, { autoRotate: true, fit: 1.15 });
  const key = JSON.stringify([dino.species, dino.skin]);
  if (key === gameViewerKey) return;
  gameViewerKey = key;
  void gameViewer.show(dino.species, window.Dino3D.fromGame(dino.skin) ?? { colors: {} }).then((ok) => { if (!ok) box.hidden = true; });
}


function renderMap(me) {
  if (!map) {
    map = createMap($('map'));
    loadAiZones();
    // A new target shows on the launcher's mini map at once, not a second later.
    map.onTargetChange(() => pushOverlayGame(lastMeData?.dino ?? null));
  }
  map.update(me.dino);

  if (me.dino?.position) {
    const p = me.dino.position;
    $('map-status-tag').textContent = 'Dino trực tuyến';
    $('map-status-tag').className = 'tag';
    const coordsBadge = document.querySelector('.map-coords-badge');
    if (coordsBadge) {
      coordsBadge.textContent = `Y: ${Math.round(p.y)}, X: ${Math.round(p.x)}, Z: ${Math.round(p.z ?? 0)} · Góc: ${Math.round(p.yaw ?? 0)}°`;
    }
  } else {
    $('map-status-tag').textContent = 'Chưa có vị trí';
    $('map-status-tag').className = 'tag warning';
  }
}

function renderRankFx(rank) {
  if (rank === 1) {
    return `
      <div class="slot-tier-fx tier-apex-fx rank-fx" aria-hidden="true">
        <div class="apex-fire-sweep rank-fire-sweep"></div>
        <div class="rank-eye-wrap">
          <div class="apex-eye-box rank-eye">
            <svg class="apex-eye-svg" viewBox="0 0 100 50">
              <defs>
                <radialGradient id="rankEyeGrad1" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stop-color="#fef08a" />
                  <stop offset="40%" stop-color="#f97316" />
                  <stop offset="80%" stop-color="#dc2626" />
                  <stop offset="100%" stop-color="#450a0a" />
                </radialGradient>
              </defs>
              <path class="eye-lid-upper" d="M 6,25 Q 50,-4 94,25" fill="none" stroke="rgba(239,68,68,0.75)" stroke-width="1.6" />
              <path class="eye-lid-lower" d="M 6,25 Q 50,54 94,25" fill="none" stroke="rgba(239,68,68,0.75)" stroke-width="1.6" />
              <ellipse class="eye-sclera" cx="50" cy="25" rx="36" ry="16" fill="rgba(185,28,28,0.32)" />
              <ellipse class="eye-iris" cx="50" cy="25" rx="18" ry="15" fill="url(#rankEyeGrad1)" />
              <polygon class="eye-pupil" points="49,11 51,11 52,25 51,39 49,39 48,25" fill="#050101" />
              <ellipse class="eye-glint" cx="44" cy="20" rx="3" ry="1.5" fill="#ffffff" />
            </svg>
          </div>
        </div>
        <svg class="apex-claws-svg rank-claws" viewBox="0 0 160 160" preserveAspectRatio="none">
          <path class="claw-slash s1" d="M 22,6 L 148,132" fill="none" />
          <path class="claw-slash s2" d="M 38,0 L 162,126" fill="none" />
          <path class="claw-slash s3" d="M 10,26 L 132,148" fill="none" />
        </svg>
      </div>`;
  }
  if (rank === 2) {
    return `
      <div class="slot-tier-fx tier-rex-fx rank-fx" aria-hidden="true">
        <div class="rex-flame-aura"></div>
        <svg class="rex-cracks-svg rank-cracks" viewBox="0 0 600 60" preserveAspectRatio="none">
          <path d="M 0,60 L 60,35 L 120,48 L 190,25 L 260,40 L 340,15 L 420,38 L 510,20 L 600,45" fill="none" stroke="currentColor" stroke-width="2.2" />
          <path d="M 120,48 L 150,60 M 260,40 L 290,60 M 420,38 L 460,60" fill="none" stroke="currentColor" stroke-width="1.8" />
        </svg>
      </div>`;
  }
  if (rank === 3) {
    return `
      <div class="slot-tier-fx tier-dna-fx rank-fx" aria-hidden="true">
        <svg class="dna-veins-svg rank-dna-veins" viewBox="0 0 600 60" preserveAspectRatio="none">
          <path class="dna-capillary c1" d="M -10,30 Q 80,10 160,35 T 320,20 T 480,40 T 610,25" fill="none" />
          <path class="dna-capillary c2" d="M 40,55 Q 140,20 240,45 T 400,25 T 560,50" fill="none" />
          <circle class="dna-node n1" cx="160" cy="35" r="3.2" />
          <circle class="dna-node n2" cx="320" cy="20" r="3.2" />
          <circle class="dna-node n3" cx="480" cy="40" r="3.2" />
        </svg>
      </div>`;
  }
  return `
    <div class="slot-tier-fx tier-fossil-fx rank-fx" aria-hidden="true">
      <div class="fossil-grit-overlay"></div>
    </div>`;
}

function renderRanking() {
  const container = $('ranking-list');
  if (!lastBoardData && currentRankingTab !== 'lives') {
    container.innerHTML = '<li class="muted" style="padding:16px;text-align:center">Đang tải bảng xếp hạng…</li>';
    return;
  }

  if (currentRankingTab === 'lives') {
    const lives = lastMeData?.lives ?? [];
    if (lives.length === 0) {
      container.innerHTML = '<li class="muted" style="padding:24px;text-align:center">Chưa có lịch sử đời dino nào.</li>';
      return;
    }
    // One row per dino (bridge dinoRows): its relogs, garage trips and rebirths together.
    const STATUS = {
      alive: ['Đang sống', 'info'], garage: ['Đang trong gara', ''], left: ['Đã thoát game (chưa chết)', ''],
      death: ['Đã chết', 'kill'], admin: ['Admin xoá', 'kill'], rebirth: ['Chuyển sinh', 'prime'],
    };
    container.innerHTML = lives.map((l, i) => {
      const tier = getDinoTier(l);
      const isTop = i < 3;
      const [label, tone] = STATUS[l.status] ?? [l.end ?? 'Không rõ', ''];
      const by = l.status === 'death' && l.killedBy ? ` bởi ${esc(l.killedBy)}${l.killedBySpecies ? ` (${esc(l.killedBySpecies)})` : ''}` : '';
      const reborn = l.rebirths > 0 ? ` · chuyển sinh ${l.rebirths} lần` : '';
      return `
      <li class="leaderboard-item ${tier.key === 'amber' ? 'tier-amber' : tier.className}">
        ${renderSlotFx(tier)}
        <div class="leaderboard-item-left">
          <span class="leaderboard-rank ${isTop ? (i === 0 ? 'top-1' : i === 1 ? 'top-2' : 'top-3') : ''}">#${i + 1}</span>
          <div class="leaderboard-item-details">
            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px">
              <b class="leaderboard-player-name">${esc(l.species ?? 'Dino')}</b>
              ${tierBadge(tier)}
              <span class="tag" style="font-size:11px">${growthStage(l.growth).icon} ${pct(l.growth)}</span>
            </div>
            <div class="muted" style="font-size:11.5px;margin-top:2px">
              <span class="tag ${tone}">${esc(label)}${by}</span>
              · sống ${dur(l.seconds)}${reborn}
            </div>
            <div class="muted" style="font-size:11px;margin-top:2px">Sinh ra ${when(l.spawnedAt)}${l.status === 'alive' ? '' : ` · lần cuối ${when(l.lastAt)}`}</div>
          </div>
        </div>
        <b class="leaderboard-val-num">⚔️ ${l.kills} kills</b>
      </li>`;
    }).join('');
    return;
  }

  const list = lastBoardData?.[currentRankingTab] ?? [];
  if (list.length === 0) {
    container.innerHTML = '<li class="muted" style="padding:24px;text-align:center">Chưa có người chơi trong danh sách.</li>';
    return;
  }

  const formatVal = (v) => currentRankingTab === 'playtime' || currentRankingTab === 'longestLife' ? dur(v)
    : currentRankingTab === 'hunters' ? `🏹 ${v} lần` : `${v} kills`;

  container.innerHTML = list.map((item, idx) => {
    const rankNum = idx + 1;
    const isTop = rankNum <= 3;
    const tierClass = rankNum === 1 ? 'tier-apex' : rankNum === 2 ? 'tier-rex' : rankNum === 3 ? 'tier-dna' : 'tier-fossil';
    const rankClass = isTop ? `rank-top rank-${rankNum}` : 'rank-rest';
    const badgeClass = rankNum === 1 ? 'top-1' : rankNum === 2 ? 'top-2' : rankNum === 3 ? 'top-3' : '';
    const badgeIcon = rankNum === 1 ? '👑 #1' : rankNum === 2 ? '👑 #2' : rankNum === 3 ? '👑 #3' : `#${rankNum}`;
    const crownTag = rankNum === 1 ? '<span class="tag tier-apex" style="margin-left:6px;font-size:11px">👑 Top 1</span>'
      : rankNum === 2 ? '<span class="tag tier-rex" style="margin-left:6px;font-size:11px">👑 Top 2</span>'
      : rankNum === 3 ? '<span class="tag tier-dna" style="margin-left:6px;font-size:11px">👑 Top 3</span>'
      : '';

    return `
      <li class="leaderboard-item ${tierClass} ${rankClass}">
        ${renderRankFx(rankNum)}
        <div class="leaderboard-item-left">
          <span class="leaderboard-rank ${badgeClass}">${badgeIcon}</span>
          <div class="leaderboard-item-details">
            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px">
              <b class="leaderboard-player-name">${esc(item.name ?? 'Ẩn danh')}</b>
              ${crownTag}
            </div>
            ${item.species ? `<span class="muted leaderboard-species" style="font-size:12px">${esc(item.species)}</span>` : ''}
          </div>
        </div>
        <b class="leaderboard-val-num">${formatVal(item.value)}</b>
      </li>`;
  }).join('');
}

// Ranking Sub-tabs handlers
for (const btn of document.querySelectorAll('.ranking-tab-btn')) {
  btn.addEventListener('click', () => {
    for (const b of document.querySelectorAll('.ranking-tab-btn')) b.classList.toggle('active', b === btn);
    currentRankingTab = btn.dataset.rtab;
    renderRanking();
  });
}

// ============================================================================
// 5. Polling and Refresh Loop
// ============================================================================
let lastSlow = 0;
let busy = false;
// In the launcher, while its window is behind the game (not focused) or in the
// tray: the data still comes every second (the overlay and voice need it), but
// the page itself is redrawn only every 5 s, nobody is looking at it. Coming
// back to the launcher redraws at once.
let lastDrawn = 0;
const BACKGROUND_DRAW_MS = 5000;
const inBackground = () => Boolean(window.isleLauncher) && (document.hidden || !document.hasFocus());

// ============================================================================
// Túi đồ (/me items; the bridge says whether the bag is open to this account —
// admins only for now). A mutation: "Dùng" opens a box (GET /api/items/preview)
// — into a slot, with what is there now and its value beside the new one; or,
// the dino has it already, +1 đời with every mutation before → after, refused
// at that mutation's max. Gone once the game confirms. A skin: worn on its species.
// ============================================================================
const BAG_DIET = { all: 'Mọi loài', carnivore: 'Ăn thịt', herbivore: 'Ăn cỏ', herbivore_omnivore: 'Ăn cỏ / ăn tạp' };
const BAG_RARITY = { common: 'Thường', rare: 'Hiếm', epic: 'Sử thi', legendary: 'Huyền thoại', special: 'Đặc biệt' };
const bag = { filter: 'all', busy: false, sig: '', open: null };
/** The tickets (items.ts): what each card says. */
const BAG_TICKET = {
  mutation_ticket: { icon: '🎟️', desc: (g) => `Đổi ra một mutation tự chọn (đúng chế độ ăn của loài${g.maxRarity === 'special' ? ', <b>cả mutation nhiệm vụ</b>' : ''}) vào một ô đã mở.` },
  mutation_clear: { icon: '🧹', desc: () => 'Bỏ mutation ở một ô để chọn lại trong game.' },
  prime_ticket: { icon: '👑', desc: () => 'Dino 100% chưa prime: dùng là lên prime (đủ 10 điều kiện).' },
};
const bagKey = (s) => String(s ?? '').replace(/^BP_/, '').replace(/_C$/, '').toLowerCase();
/** The icon of a mutation (img/mutations/<slug>.svg, the owner's set). */
const mutSlug = (name) => String(name ?? '').replace(/^MUT_/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// The icon is filled in by mut-icons.js (all icons in one request, kept in memory).
const mutIcon = (name, cls = '') => `<img class="mut-ico ${cls}" data-mut-icon="${esc(mutSlug(name))}" alt="">`;
const bagHex = (c) => {
  // The skin's game colours are linear and may go above 1 (lighter than a picker): shown clamped, sRGB.
  const ch = (v) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)));
  return `rgb(${ch(c.r)},${ch(c.g)},${ch(c.b)})`;
};
function bagStatus(kind, html) {
  const el = $('bag-status');
  el.hidden = !html;
  el.className = `garage-status${kind ? ` ${kind}` : ''}`;
  el.innerHTML = html ?? '';
}
/** One card a kind of item: copies of the same item grouped, with how many. */
function bagGroups(items) {
  const by = new Map();
  for (const it of items) {
    const g = by.get(it.id);
    if (g) g.uids.push(it.uid); else by.set(it.id, { ...it, uids: [it.uid] });
  }
  return [...by.values()];
}
function renderBag(me) {
  const open = Boolean(me?.bag);
  $('nav-bag').hidden = !open;
  if (!open) {
    if (currentTab === 'bag') switchTab('home');
    return;
  }
  const items = Array.isArray(me.items) ? me.items : [];
  const groups = bagGroups(items);
  const dino = me.dino?.species ?? null;
  const usable = (g) => (g.type === 'mutation' ? dino !== null && !g.refusal && !me.prison
    : g.type === 'skin' ? dino !== null && bagKey(g.species) === bagKey(dino) : dino !== null && !me.prison);
  $('nav-bag-badge').hidden = items.length === 0;
  $('nav-bag-badge').textContent = String(items.length);
  $('bag-count').textContent = me.bagUnlimited ? `${groups.length} loại · ∞ (admin)` : `${items.length} món`;
  $('bag-dino').innerHTML = me.prison ? '⛓️ Bạn đang ở tù: không dùng được vật phẩm.'
    : dino ? `Đang chơi: <b>${esc(dino)}</b>${me.dino.growth != null ? ` · ${Math.round(me.dino.growth * 100)}%` : ''}`
      : 'Vào game và điều khiển một con dino để dùng vật phẩm.';
  const q = $('bag-q').value.trim().toLowerCase();
  const shown = groups.filter((g) => (bag.filter === 'all' || (bag.filter === 'usable' ? usable(g) : g.type === bag.filter))
    && (!q || `${g.name} ${g.mutation ?? ''} ${g.species ?? ''}`.toLowerCase().includes(q)));
  // Redraw only when something changed (the page refreshes every second).
  const sig = JSON.stringify([shown.map((g) => [g.id, g.uids.length, usable(g), g.rarity]), dino, Boolean(me.prison), bag.busy, Boolean(me.bagUnlimited)]);
  if (sig === bag.sig) return;
  bag.sig = sig;
  // A card is dimmed only when it does not fit the dino played now (diet, species); out of
  // the game (or in prison) it keeps its look — only its button is off and says why.
  const mismatch = (g) => dino !== null && (g.type === 'mutation' ? Boolean(g.refusal) : g.type === 'skin' ? bagKey(g.species) !== bagKey(dino) : false);
  const blocked = me.prison ? 'Đang ở tù' : dino === null ? 'Vào game để dùng' : null;
  const button = (g, cls, attr, label) => {
    const ok = usable(g) && !bag.busy;
    const text = ok || mismatch(g) || !blocked ? label : blocked;
    return `<button type="button" class="btn ${cls}" ${attr}="${esc(g.id)}" ${ok ? '' : `disabled title="${esc(blocked && !mismatch(g) ? `${blocked}: điều khiển một con dino trong game` : '')}"`}>${esc(text)}</button>`;
  };
  $('bag-list').innerHTML = shown.map((g) => {
    const ok = !mismatch(g);
    const rar = `<span class="rar-label rar-${esc(g.rarity)}">${esc(BAG_RARITY[g.rarity] ?? g.rarity)}</span>`;
    const qty = me.bagUnlimited ? '<span class="qty" title="Túi admin: dùng không hết">∞</span>' : g.uids.length > 1 ? `<span class="qty">×${g.uids.length}</span>` : '';
    if (g.type === 'mutation') {
      return `<li class="bag-item rar-${esc(g.rarity)}${ok ? '' : ' off'}">
        <div class="top">${mutIcon(g.mutation)}<div class="nm"><b>${esc(g.name)}</b>${rar}</div>${qty}</div>
        <div class="meta">${g.mutation !== g.name ? `<span>🧬 ${esc(g.mutation)}</span>` : ''}<span>${esc(BAG_DIET[g.diet] ?? g.diet)}</span>${g.slot2 ? '<span>Chỉ ô 2 / 4</span>' : ''}${g.rarity === 'special' ? '<span>Mutation nhiệm vụ</span>' : ''}</div>
        ${g.description ? `<div class="desc">${esc(g.description)}</div>` : ''}
        ${g.refusal && dino ? `<div class="why">Không dùng được cho ${esc(dino)}: ${esc(g.refusal)}.</div>` : ''}
        <div class="act">${button(g, 'btn-emerald', 'data-bag-use', 'Dùng')}</div>
      </li>`;
    }
    if (BAG_TICKET[g.type]) {
      const t = BAG_TICKET[g.type];
      return `<li class="bag-item rar-${esc(g.rarity)}${ok ? '' : ' off'}">
        <div class="top"><span class="mut-ico tk-ico" aria-hidden="true">${t.icon}</span><div class="nm"><b>${esc(g.name)}</b>${rar}</div>${qty}</div>
        <div class="desc">${t.desc(g)}</div>
        <div class="act">${button(g, 'btn-emerald', 'data-bag-use', 'Dùng')}</div>
      </li>`;
    }
    const colors = g.skin?.colors ?? {};
    return `<li class="bag-item rar-${esc(g.rarity)}${ok ? '' : ' off'}">
      <div class="top"><div class="nm"><b>${esc(g.name)}</b>${rar}</div>${qty}</div>
      <div class="meta"><span>🎨 Skin ${esc(g.species ?? '')}</span></div>
      <div class="sw">${['Body', 'Flank', 'Underbelly', 'Markings', 'Eyes'].filter((k) => colors[k]).map((k) => `<i style="background:${bagHex(colors[k])}"></i>`).join('')}</div>
      ${!ok && dino ? `<div class="why">Chỉ mặc được khi đang chơi ${esc(g.species ?? '')}.</div>` : ''}
      <div class="act">${button(g, 'btn-ghost', 'data-bag-wear', 'Mặc')}</div>
    </li>`;
  }).join('') || `<li class="muted" style="padding:16px;text-align:center;grid-column:1/-1">${items.length ? 'Không có vật phẩm nào khớp.' : 'Túi đồ trống.'}</li>`;
}

// --- the use box ---------------------------------------------------------------
const bagVal = (v) => (v == null ? '<span class="muted">chưa rõ số liệu</span>' : esc(v));
function renderBagDialog() {
  const o = bag.open;
  if (!o) return;
  const { g, pv, slot } = o;
  const gen = pv.stacks == null ? '?' : pv.stacks + 1;
  const head = `<div class="hd">${g.type === 'mutation' ? mutIcon(g.mutation) : `<span class="mut-ico tk-ico" aria-hidden="true">${BAG_TICKET[g.type]?.icon ?? ''}</span>`}<div><b id="bag-dlg-title">${esc(g.name)}</b>
      <span class="rar-label rar-${esc(g.rarity)}">${esc(BAG_RARITY[g.rarity] ?? g.rarity)}</span>
      <div class="muted" style="font-size:12.5px">${esc(pv.species ?? '')} · ${pv.growth != null ? `${Math.round(pv.growth * 100)}%` : '?'} · đời ${esc(gen)}${pv.prime ? ' · prime' : ''}${lastMeData?.bagUnlimited ? ' · ∞ (túi admin)' : g.uids.length > 1 ? ` · còn ${g.uids.length} cái` : ''}</div></div>
      <button type="button" class="x" data-dlg="close" aria-label="Đóng">×</button></div>`;
  const status = '<div class="garage-status" id="bag-dlg-status" role="status" aria-live="polite" hidden></div>';
  if (g.type === 'prime_ticket') {
    const grown = pv.growth != null && pv.growth >= 0.999;
    const why = pv.prime ? 'Dino này đã là prime.' : !grown ? 'Cần dino 100% tăng trưởng.' : '';
    $('bag-dlg-in').innerHTML = `${head}<div class="sec"><h4>Lên prime</h4>
      <div class="cmp">Đánh dấu đủ 10 điều kiện prime và cho dino lên prime, như khi tự làm nhiệm vụ prime. Chỉ số prime có sau vài giây.</div>
      ${why ? `<div class="why" style="color:#fbbf24;font-size:13px">⚠️ ${esc(why)}</div>` : ''}
      <div class="row"><button type="button" class="btn btn-emerald" data-dlg="prime" ${why || bag.busy ? 'disabled' : ''}>Lên prime</button></div></div>${status}`;
    return;
  }
  const isClear = g.type === 'mutation_clear';
  const isTicket = g.type === 'mutation_ticket';
  const incomingName = isTicket ? o.pick?.name ?? null : g.mutation ?? null;
  const incoming = isTicket ? o.pick : null;
  const slot2 = isTicket ? Boolean(incoming?.slot2) : Boolean(pv.slot2);
  const has = incomingName ? pv.slots.find((x) => x.name && mutSlug(x.name) === mutSlug(incomingName)) : null;
  let body = '';
  if (isTicket) {
    body += `<div class="sec"><h4>1. Chọn mutation</h4><div class="tk-pool">${(pv.pool ?? []).map((m) => `<button type="button" class="tk-pick rar-${esc(m.rarity)}${incomingName === m.name ? ' on' : ''}" data-dlg-pick="${esc(m.name)}" title="${esc(m.description ?? '')}">${mutIcon(m.name, 'sm')}<span>${esc(m.name)}${m.slot2 ? ' <small>(ô 2/4)</small>' : ''}</span></button>`).join('')
      || '<div class="muted">Không có mutation nào hợp với loài này trong độ hiếm của phiếu.</div>'}</div></div>`;
  }
  const choosable = (x) => (isClear ? Boolean(x.name) : x.open && (!slot2 || x.slot === 2 || x.slot === 4));
  const picked = pv.slots.find((x) => x.slot === slot) ?? null;
  body += `<div class="sec"><h4>${isTicket ? '2. ' : ''}${isClear ? 'Chọn ô cần bỏ' : 'Chọn ô'}</h4>
    ${has && !isClear ? `<div class="cmp muted">Dino đã có ${esc(incomingName)} ở ô ${has.slot}: dùng thêm không mạnh hơn.</div>` : ''}
    <div class="slots">${pv.slots.map((x) => `<button type="button" class="slot${x.slot === slot ? ' on' : ''}" data-dlg-slot="${x.slot}" ${choosable(x) ? '' : 'disabled'}>
      ${x.name ? mutIcon(x.name, 'sm') : ''}<span><b>Ô ${x.slot}</b>${x.open ? '' : ` <small>mở từ ${Math.round(x.minGrowth * 100)}%</small>`}<br>${x.name ? `${esc(x.name)} · ${bagVal(x.value)}` : '<span class="muted">trống</span>'}</span></button>`).join('')}</div>
    ${picked && choosable(picked) ? `<div class="cmp">${isClear ? `Bỏ <b>${esc(picked.name)}</b> khỏi ô ${picked.slot}.`
      : incomingName ? `${picked.name ? `Thay <b>${esc(picked.name)}</b> (${bagVal(picked.value)})` : `Ô ${picked.slot} đang trống`} → <b>${esc(incomingName)}</b> <span class="muted">· độ mạnh theo đời của dino (đời ${esc(gen)})</span>` : 'Chọn mutation trước.'}</div>`
      : `<div class="cmp muted">${isClear ? 'Chọn một ô đang có mutation.' : 'Chọn một ô đã mở (ô 1 từ 25%, ô 2 từ 50%, ô 3–4 từ 75% tăng trưởng).'}</div>`}
    <div class="row"><button type="button" class="btn btn-emerald" data-dlg="${isClear ? 'clear' : 'place'}" ${picked && choosable(picked) && (isClear || (incomingName && !has)) && !bag.busy ? '' : 'disabled'}>${isClear ? (picked?.name ? `Bỏ khỏi ô ${picked.slot}` : 'Bỏ') : picked?.name ? `Thay vào ô ${picked.slot}` : picked ? `Thêm vào ô ${picked.slot}` : 'Thêm'}</button></div></div>`;
  $('bag-dlg-in').innerHTML = head + body + status;
}
function bagDlgStatus(kind, html) {
  const el = $('bag-dlg-status');
  if (!el) return;
  el.hidden = !html;
  el.className = `garage-status${kind ? ` ${kind}` : ''}`;
  el.innerHTML = html ?? '';
}
async function openBagDialog(g) {
  const r = await getJson(`/api/items/preview/${encodeURIComponent(g.uids[0])}`).catch(() => null);
  if (r?.status !== 200 || !r.body) { bagStatus('bad', `❌ ${esc(r?.body?.error ?? 'Không đọc được dino đang chơi.')}`); return; }
  const slots = r.body.slots ?? [];
  const first = g.type === 'mutation_clear' ? slots.find((x) => x.name)?.slot ?? null
    : slots.find((x) => x.open && !x.name && (!g.slot2 || x.slot === 2 || x.slot === 4))?.slot ?? null;
  bag.open = { g, pv: r.body, slot: first, pick: null };
  renderBagDialog();
  if (!$('bag-dlg').open) $('bag-dlg').showModal();
}
async function bagSend(url, body, what, inDialog = false) {
  const say = inDialog ? bagDlgStatus : bagStatus;
  bag.busy = true;
  if (inDialog) renderBagDialog();
  renderBag(lastMeData);
  say('', `Đang gửi ${what}…`);
  try {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const b = await r.json().catch(() => null);
    if (r.status === 429) { say('bad', 'Chậm lại chút: mỗi vài giây chỉ một lệnh.'); return; }
    if (r.status !== 202 || typeof b?.id !== 'number') { say('bad', `❌ ${esc(b?.error ?? 'Không gửi được lệnh.')}`); return; }
    say('', 'Đã gửi, chờ game xử lý…');
    const done = await waitCommand(b.id, 20, (c) => c?.status === 'done');
    if (done === null) { say('bad', 'Chưa thấy game trả lời. Vật phẩm vẫn còn trong túi — thử lại sau.'); return; }
    const msgs = (done.messages ?? []).map((m) => esc(reply(m))).join('<br>');
    if (!done.ok) { say('bad', `❌ ${msgs || esc(ERROR_VI[done.error] ?? done.error ?? 'Game từ chối.')} Vật phẩm vẫn còn trong túi.`); return; }
    if (inDialog) { $('bag-dlg').close(); bag.open = null; }
    bagStatus('ok', `✅ ${msgs || 'Xong.'}`);
  } catch {
    say('bad', 'Mất kết nối khi gửi lệnh. Thử lại.');
  } finally {
    bag.busy = false;
    bag.sig = '';
    if (bag.open) renderBagDialog();
    // The used copy leaves the bag once the game confirmed: read /me again now.
    const me = await getJson('/api/me').catch(() => null);
    if (me?.status === 200) lastMeData = me.body;
    renderBag(lastMeData);
  }
}
$('bag-list').addEventListener('click', (e) => {
  const u = e.target.closest('[data-bag-use]');
  if (u && !u.disabled) {
    const g = bagGroups(lastMeData?.items ?? []).find((x) => x.id === u.dataset.bagUse);
    if (g) void openBagDialog(g);
    return;
  }
  const w = e.target.closest('[data-bag-wear]');
  if (w && !w.disabled) void bagSend('/api/skin', { item: w.dataset.bagWear }, 'skin');
});
$('bag-dlg').addEventListener('click', (e) => {
  if (e.target === $('bag-dlg') || e.target.closest('[data-dlg="close"]')) { $('bag-dlg').close(); return; }
  const o = bag.open;
  if (!o || bag.busy) return;
  const s = e.target.closest('[data-dlg-slot]');
  if (s && !s.disabled) { o.slot = Number(s.dataset.dlgSlot); renderBagDialog(); return; }
  const pk = e.target.closest('[data-dlg-pick]');
  if (pk) {
    o.pick = (o.pv.pool ?? []).find((m) => m.name === pk.dataset.dlgPick) ?? null;
    // A slot-2 kind leaves a slot it cannot take.
    if (o.pick?.slot2 && o.slot !== 2 && o.slot !== 4) o.slot = o.pv.slots.find((x) => x.open && (x.slot === 2 || x.slot === 4))?.slot ?? null;
    renderBagDialog(); return;
  }
  if (e.target.closest('[data-dlg="prime"]')) { void bagSend('/api/items/use', { uid: o.g.uids[0] }, 'phiếu Prime', true); return; }
  if (e.target.closest('[data-dlg="clear"]') && o.slot) { void bagSend('/api/items/use', { uid: o.g.uids[0], slot: o.slot }, `bỏ mutation ô ${o.slot}`, true); return; }
  if (e.target.closest('[data-dlg="place"]') && o.slot && o.g.type === 'mutation_ticket' && o.pick) {
    void bagSend('/api/items/use', { uid: o.g.uids[0], slot: o.slot, mutation: o.pick.name }, `mutation ${o.pick.name}`, true); return;
  }
  if (e.target.closest('[data-dlg="upgrade"]')) { void bagSend('/api/items/use', { uid: o.g.uids[0], upgrade: true }, `nâng cấp ${o.g.mutation}`, true); return; }
  if (e.target.closest('[data-dlg="place"]') && o.slot) void bagSend('/api/items/use', { uid: o.g.uids[0], slot: o.slot }, `mutation ${o.g.mutation}`, true);
});
$('bag-dlg').addEventListener('close', () => { if (!bag.busy) bag.open = null; });
$('bag-filter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-bag]');
  if (!b) return;
  bag.filter = b.dataset.bag;
  for (const x of $('bag-filter').querySelectorAll('[data-bag]')) x.classList.toggle('active', x === b);
  bag.sig = '';
  renderBag(lastMeData);
});
$('bag-q').addEventListener('input', () => { bag.sig = ''; renderBag(lastMeData); });

async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const slow = Date.now() - lastSlow > 15_000;
    const [srv, me, board] = await Promise.all([
      slow ? getJson('/api/server') : null,
      getJson('/api/me'),
      slow ? getJson('/api/leaderboard') : null,
    ]);

    if (slow) lastSlow = Date.now();

    if (srv !== null) renderServer(srv);

    if (me.status === 401) {
      lastMeData = null;
      pushOverlayGame(null, null);
      renderAuth(null);
      renderBag(null);
      // Disable guest restrictions gracefully
    } else if (me.status === 200) {
      lastMeData = me.body;
      pushOverlayGame(me.body.dino);
      if (!inBackground() || (!gameMode.on && Date.now() - lastDrawn >= BACKGROUND_DRAW_MS)) {
        lastDrawn = Date.now();
        renderAuth(me.body);
        renderGame(me.body);
        renderGara(me.body);
        renderMap(me.body);
        renderBag(me.body);
      }
    }

    if (board !== null && board.status === 200) {
      lastBoardData = board.body;
      renderRanking();
    }
  } catch (err) {
    console.error('Error refreshing portal data:', err);
  } finally {
    busy = false;
  }
}

// Xóm Gáy Launcher's overlay (mini map, dino numbers, prime quests): the same
// data this page shows, handed over each second. Nothing else leaves the page.
let lastAi = [];
// Escaped inmates (the prison): on the map page and the overlay's mini map for everyone to hunt.
let lastEscapees = [];
function pushOverlayGame(dino, me = lastMeData) {
  if (!window.isleLauncher?.overlayGame) return;
  window.isleLauncher.overlayGame({
    // Whose account the launcher is on: the widgets say it when no dino shows.
    player: me ? { name: me.name ?? null, online: me.online === true } : null,
    dino: dino ? {
      species: dino.species, growth: dino.growth, vitals: dino.vitals, max: dino.max,
      position: dino.position, trail: dino.trail, prime: dino.prime,
    } : null,
    ai: lastAi,
    escapees: lastEscapees,
    // The point set on the map (map.js): the mini map draws a line to it.
    target: map ? map.getTarget() : loadWaypoints().target,
  });
}

// Live AI on the map: every 2 s while the map page is open and seen, or (in
// the launcher) while the overlay's mini map is on and shows AI.
let aiBusy = false;
let miniMapAi = false;
let miniMapOn = false;
let overlaySettings = null;
function readOverlayAi(settings) {
  if (settings) overlaySettings = settings;
  const m = overlaySettings && overlaySettings.widgets && overlaySettings.widgets.map;
  // The mini map shown at all: escaped inmates are drawn on it whatever the AI setting.
  miniMapOn = Boolean(overlaySettings && overlaySettings.enabled && m && m.enabled && (!gameMode.on || gameMode.keep.map));
  miniMapAi = Boolean(miniMapOn && m.show && m.show.ai !== false);
}
if (window.isleLauncher?.overlayGet) {
  readOverlayAi(window.isleLauncher.overlayGet()?.settings);
  window.isleLauncher.onOverlayChanged?.((saved) => readOverlayAi(saved));
  // Settings changed from the tray or the overlay card: look again now and then.
  setInterval(() => readOverlayAi(window.isleLauncher.overlayGet()?.settings), 10_000);
}
setInterval(async () => {
  const wanted = (currentTab === 'map' && !document.hidden) || miniMapAi || miniMapOn;
  if (aiBusy || !wanted || !lastMeData || !map) return;
  aiBusy = true;
  try {
    const ai = await getJson('/api/ai');
    if (ai.status === 200) {
      lastAi = ai.body?.list ?? [];
      lastEscapees = Array.isArray(ai.body?.escapees) ? ai.body.escapees : [];
      map.setAi(lastAi); map.setFish(ai.body?.fish ?? []); map.setEscapees(lastEscapees);
    }
  } catch {
    // The next tick tries again.
  } finally {
    aiBusy = false;
  }
}, 2000);

// AI zones the admins drew (public, like the map): now and then, not every second.
async function loadAiZones() {
  if (!map) return;
  try {
    const r = await getJson('/api/ai-zones');
    if (r.status === 200) map.setAiZones(r.body?.zones ?? []);
  } catch { /* the next try */ }
}
setInterval(() => { if (currentTab === 'map' && !document.hidden) loadAiZones(); }, 60_000);

// ============================================================================
// Interactive Onboarding Tour (Zero-dependency, skippable, live AI highlight)
// ============================================================================
const TOUR_STEPS = [
  {
    badge: 'Bước 1 / 5 · Tổng Quan',
    title: '🦖 Chào mừng đến với Xóm Gáy Gateway',
    target: () => document.querySelector('.brand') || document.querySelector('.top-header'),
    tab: 'home',
    body: `
      <p>Cổng thông tin & Launcher tích hợp chuyên biệt cho The Isle Evrima Xóm Gáy.</p>
      <p>Hệ thống hỗ trợ đầy đủ công cụ sinh tồn: Gara cất dino an toàn, Bản đồ Gateway Live với <b>Radar AI trực tiếp</b>, Voice 3D định hướng và Overlay HUD trong game.</p>
      <p style="margin-bottom:0;color:var(--text-sub);font-size:12px">💡 <i>Bạn có thể bấm <b>✕ Bỏ qua</b> ở góc bất kỳ lúc nào hoặc bấm phím <b>ESC</b> để đóng.</i></p>
    `,
  },
  {
    badge: 'Bước 2 / 5 · Gara Khủng Long',
    title: '🦕 Gara Khủng Long An Toàn',
    target: () => document.querySelector('.nav-btn[data-nav="gara"]') || document.querySelector('.thumb-btn[data-nav="gara"]'),
    tab: 'gara',
    body: `
      <p><b>Bảo lưu 100% chỉ số:</b> Cất dino trước khi rời game để bảo vệ chú khủng long của bạn an toàn khỏi nguy cơ đói khát hay bị tấn công khi offline.</p>
      <p><b>Đa dạng chủng loài:</b> Lưu trữ nhiều con cùng lúc, chuyển đổi linh hoạt mà không sợ mất con cũ.</p>
      <p style="margin-bottom:0"><b>Mở khoá Slot Prime:</b> Đạt đủ điều kiện tiến hoá để mở thêm slot khủng long cao cấp.</p>
    `,
  },
  {
    badge: 'Bước 3 / 5 · Bản Đồ Gateway Live',
    title: '🗺️ Bản Đồ Live — Radar AI Trực Tiếp',
    target: () => document.querySelector('.nav-btn[data-nav="map"]') || document.querySelector('.thumb-btn[data-nav="map"]'),
    tab: 'map',
    body: `
      <div class="tour-ai-callout">
        <span class="tour-ai-tag"><span class="tour-ai-tag-dot"></span>🌟 ĐẶC BIỆT: HIỂN THỊ AI TRỰC TIẾP</span>
        <span class="tour-ai-desc">Bản đồ quét và hiển thị <b>vị trí chính xác của Heo Rừng (Boar), Hươu (Deer), Khủng long AI và Cá</b> đang sống trên máy chủ được cập nhật trực tiếp mỗi 2 giây! Bạn sẽ không còn lo bị đói hay lạc bầy.</span>
      </div>
      <p style="margin-top:10px"><b>🧭 Định vị GPS & Hướng nhìn:</b> Theo dõi toạ độ thực tế, góc xoay la bàn và vệt đường di chuyển của dino.</p>
      <p style="margin-bottom:0"><b>💧 Nguồn nước & Vùng di cư:</b> Đánh dấu nguồn nước sạch, Sanctuary an toàn cho con non và các vùng di cư Mass Migration.</p>
    `,
  },
  {
    badge: 'Bước 4 / 5 · Voice 3D Không Gian',
    title: '🎙️ Hệ Thống Voice 3D Không Gian',
    target: () => document.querySelector('.nav-btn[data-nav="voice"]'),
    tab: 'voice',
    body: `
      <p><b>Âm thanh định hướng 3D:</b> Nghe giọng nói của đồng đội và các loài khủng long khác theo đúng góc phương vị (trái/phải) và khoảng cách thực tế trong game.</p>
      <p><b>3 Mức tầm giọng linh hoạt:</b>
        <br>• <i>Thì thầm (8m):</i> Trao đổi kín đáo khi săn mồi hoặc trốn kẻ thù.
        <br>• <i>Nói thường (30m):</i> Đàm thoại bầy đàn thông thường.
        <br>• <i>Hét to (90m):</i> Gọi bầy đàn từ xa hoặc cảnh báo nguy hiểm.
      </p>
      <p style="margin-bottom:0"><b>Phím mặc định:</b> Giữ phím <code>V</code> để nói, nhấn phím <code>~</code> để chuyển đổi tầm giọng.</p>
    `,
  },
  {
    badge: 'Bước 5 / 5 · Overlay & Chế Độ Chơi Game',
    title: '🎮 Game Overlay HUD & Phím Tắt',
    target: () => document.getElementById('game-mode') || document.getElementById('nav-overlay') || document.querySelector('.top-header'),
    tab: 'home',
    body: `
      <p><b>HUD nổi trong game:</b> Hiển thị Mini Map (kèm AI xung quanh), thanh Máu/Thể lực/Đói/Nước và mic Voice nổi ngay trên màn hình The Isle.</p>
      <p><b>⌨️ Phím tắt tiện ích:</b>
        <br>• <code>F1</code>: Bật / Tắt nhanh toàn bộ Overlay HUD.
        <br>• <code>F2</code> (hoặc <code>F9</code>): Mở chế độ di chuyển & kéo mép để tuỳ chỉnh vị trí, kích thước từng khung.
      </p>
      <p style="margin-bottom:0"><b>⚡ Chế độ chơi game:</b> Bấm nút "Chế độ chơi game" trên góc để thu nhỏ Launcher xuống khay hệ thống, tối ưu 100% tài nguyên CPU/RAM cho máy tính!</p>
    `,
  },
];

let tourStepIndex = 0;
let isTourActive = false;

function startTour(fromStep = 0) {
  const backdrop = $('tour-backdrop');
  if (!backdrop) return;
  isTourActive = true;
  tourStepIndex = Math.max(0, Math.min(TOUR_STEPS.length - 1, fromStep));
  backdrop.hidden = false;
  renderTourStep();
}

function stopTour(completed = false) {
  const backdrop = $('tour-backdrop');
  if (!backdrop) return;
  isTourActive = false;
  backdrop.hidden = true;
  try {
    localStorage.setItem('isle_portal_tour_done', '1');
  } catch {}
  if (completed) {
    showToast('✓ Bạn đã hoàn thành tour hướng dẫn! Có thể mở lại bất cứ lúc nào ở nút 💡 Hướng dẫn.');
  }
}

function renderTourStep() {
  if (!isTourActive) return;
  const step = TOUR_STEPS[tourStepIndex];
  if (!step) return;

  if (step.tab && currentTab !== step.tab) {
    switchTab(step.tab, false);
  }

  const badgeEl = $('tour-step-badge');
  const titleEl = $('tour-title');
  const bodyEl = $('tour-body');
  const dotsEl = $('tour-dots');
  const prevBtn = $('tour-btn-prev');
  const nextBtn = $('tour-btn-next');

  if (badgeEl) badgeEl.textContent = step.badge;
  if (titleEl) titleEl.textContent = step.title;
  if (bodyEl) bodyEl.innerHTML = step.body;

  if (prevBtn) {
    prevBtn.disabled = tourStepIndex === 0;
  }
  if (nextBtn) {
    nextBtn.textContent = tourStepIndex === TOUR_STEPS.length - 1 ? '✓ Bắt đầu trải nghiệm' : 'Tiếp theo ▶';
  }

  if (dotsEl) {
    dotsEl.innerHTML = TOUR_STEPS.map((_, idx) =>
      `<span class="tour-dot${idx === tourStepIndex ? ' active' : ''}" title="Bước ${idx + 1}"></span>`
    ).join('');
  }

  positionTourElements(step);
}

function positionTourElements(step) {
  const spotlight = $('tour-spotlight');
  const popover = $('tour-popover');
  if (!spotlight || !popover) return;

  const targetEl = typeof step.target === 'function' ? step.target() : step.target;
  const isMobile = window.innerWidth <= 640;

  if (!targetEl || isMobile) {
    spotlight.style.display = 'none';
    if (!isMobile) {
      const popRect = popover.getBoundingClientRect();
      const top = Math.max(20, (window.innerHeight - (popRect.height || 260)) / 2);
      const left = Math.max(20, (window.innerWidth - (popRect.width || 440)) / 2);
      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
      popover.style.transform = 'none';
    }
    return;
  }

  const rect = targetEl.getBoundingClientRect();
  const pad = 6;

  spotlight.style.display = 'block';
  spotlight.style.top = `${Math.max(0, rect.top - pad)}px`;
  spotlight.style.left = `${Math.max(0, rect.left - pad)}px`;
  spotlight.style.width = `${rect.width + pad * 2}px`;
  spotlight.style.height = `${rect.height + pad * 2}px`;

  requestAnimationFrame(() => {
    const popRect = popover.getBoundingClientRect();
    let top = rect.bottom + 14;
    let left = rect.left;

    if (top + popRect.height > window.innerHeight - 20) {
      top = Math.max(20, rect.top - popRect.height - 14);
    }
    if (left + popRect.width > window.innerWidth - 20) {
      left = Math.max(20, window.innerWidth - popRect.width - 20);
    }
    left = Math.max(20, left);

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    popover.style.transform = 'none';
  });
}

function initTour() {
  const backdrop = $('tour-backdrop');
  if (!backdrop) return;

  $('tour-skip-btn')?.addEventListener('click', () => stopTour(false));
  $('tour-btn-prev')?.addEventListener('click', () => {
    if (tourStepIndex > 0) {
      tourStepIndex--;
      renderTourStep();
    }
  });
  $('tour-btn-next')?.addEventListener('click', () => {
    if (tourStepIndex < TOUR_STEPS.length - 1) {
      tourStepIndex++;
      renderTourStep();
    } else {
      stopTour(true);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!isTourActive) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      stopTour(false);
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      if (tourStepIndex < TOUR_STEPS.length - 1) {
        tourStepIndex++;
        renderTourStep();
      } else {
        stopTour(true);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (tourStepIndex > 0) {
        tourStepIndex--;
        renderTourStep();
      }
    }
  });

  window.addEventListener('resize', () => {
    if (isTourActive) {
      positionTourElements(TOUR_STEPS[tourStepIndex]);
    }
  });

  $('tour-dots')?.addEventListener('click', (e) => {
    const dot = e.target.closest('.tour-dot');
    if (!dot) return;
    const dots = Array.from($('tour-dots').children);
    const idx = dots.indexOf(dot);
    if (idx >= 0 && idx !== tourStepIndex) {
      tourStepIndex = idx;
      renderTourStep();
    }
  });

  $('tour-btn')?.addEventListener('click', () => startTour(0));
  $('sidebar-tour-btn')?.addEventListener('click', () => startTour(0));

  try {
    if (!localStorage.getItem('isle_portal_tour_done')) {
      setTimeout(() => {
        if (!isTourActive) startTour(0);
      }, 1000);
    }
  } catch {}
}

// Initial setup
initSidebar();
initCommandPalette();
initGarageFilter();
initSkinEditor();
initTour();

// Route initial tab from URL hash
const initialHash = location.hash.replace(/^#/, '');
if (VALID_TABS.includes(initialHash)) {
  switchTab(initialHash, false);
} else {
  switchTab('home', false);
}

refresh();
setInterval(refresh, 1000);
