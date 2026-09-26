// The Isle Evrima — Cổng Thông Tin Người Chơi (Portal UI)
// Quản lý 6 trang: Home, Game, Gara, Bản đồ, Bảng xếp hạng, Skin.

import { createMap, loadWaypoints } from './map.js';

const $ = (id) => document.getElementById(id);
// Launcher game mode (main.js): in the background the page does not draw at all.
let gameMode = window.isleLauncher?.gameModeGet?.() ?? { on: false, keep: {} };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (g) => (typeof g === 'number' ? `${Math.round(g * 100)}%` : '0%');
const when = (t) => (t ? new Date(t * 1000).toLocaleString('vi-VN', { hour12: false }) : '—');
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

async function getJson(url) {
  const r = await fetch(url, { credentials: 'same-origin' });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// ============================================================================
// 1. Navigation / Tab Routing
// ============================================================================
const VALID_TABS = ['home', 'game', 'gara', 'map', 'ranking', 'skin', 'voice', 'overlay'];
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
  document.getElementById('get-launcher').hidden = true;
  document.getElementById('launcher-promo').hidden = true;
  // The overlay is the launcher's: its tab only shows there.
  document.getElementById('nav-overlay').hidden = false;
  const play = document.getElementById('play-game');
  play.hidden = false;
  play.addEventListener('click', () => window.isleLauncher.playGame());
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
  // Which launcher build this is, under the server name.
  const sub = document.querySelector('.brand-info p');
  if (sub && window.isleLauncher.version) {
    const v = document.createElement('span');
    v.className = 'launcher-version';
    v.textContent = `Launcher v${window.isleLauncher.version}`;
    sub.append(' · ', v);
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
      setTimeout(() => {
        b.textContent = original;
        b.style.color = '';
      }, 1500);
    } catch {
      prompt('Nhấn Ctrl+C để sao chép lệnh:', text);
    }
  }
});

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
    <div class="prime-deadline-track" title="Growth ${pct(g)} — Mốc ${pct(pb.deadline)}">
      <div class="prime-deadline-fill" style="width:${Math.min(100, g * 100).toFixed(1)}%"></div>
      <i class="prime-marker" style="left:${pb.deadline * 100}%"></i>
    </div>
    <div class="muted" style="font-size:12px;margin-bottom:14px">
      ${pb.locked ? `Growth ${pct(g)} — Đã qua mốc ${pct(pb.deadline)}: Kết quả Prime đã chốt.`
        : `Growth ${pct(g)} — Còn tới mốc ${pct(pb.deadline)} để hoàn thành tối thiểu 5 nhiệm vụ.`}
    </div>`;

  const rows = pb.conditions.map((c, i) => `
    <li class="quest-item ${c.met ? 'met' : ''}">
      <span class="quest-check">${c.met === null ? '?' : c.met ? '✓' : (i + 1)}</span>
      <div>
        <b>${esc(c.label)}</b>
        ${c.passive ? ' <span class="muted" style="font-size:11.5px">(thụ động — mặc định đạt nếu không vi phạm)</span>' : ''}
      </div>
    </li>
  `).join('');

  return `
    <div class="prime-summary">
      <div><b>${pb.met} / 10 điều kiện đạt</b> <span class="muted">(cần ${pb.needed ?? 5} — vài loài được tặng sẵn điều kiện 10)</span></div>
      <div>${verdict}</div>
    </div>
    ${deadline}
    <ul class="quest-list">${rows}</ul>
    <p class="muted" style="font-size:11.5px;margin:12px 0 0">
      Trạng thái ✓ được ghi nhận trực tiếp từ game engine (EligiblePrimeElderData).
    </p>`;
}

// 10 Unreal regions
const REGIONS = [
  ['Body', 'Thân (Body)'],
  ['Markings', 'Hoa văn (Markings)'],
  ['Flank', 'Sườn (Flank)'],
  ['Underbelly', 'Bụng (Underbelly)'],
  ['Detail1', 'Chi tiết (Detail 1)'],
  ['Eyes', 'Mắt (Eyes)'],
  ['MaleDisplay', 'Trưng bày (Display)'],
  ['Teeth', 'Răng (Teeth)'],
  ['Mouth', 'Miệng (Mouth)'],
  ['Claws', 'Móng (Claws)'],
];

function hex(c) {
  if (!c) return '#ffffff';
  const ch = (v) => {
    const x = Math.min(1, Math.max(0, Number(v) || 0));
    const s = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(s * 255).toString(16).padStart(2, '0');
  };
  return `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`;
}

const skinStrip = (skin) => {
  if (!skin || !skin.colors) return '';
  const colors = REGIONS.filter(([k]) => skin.colors[k]).slice(0, 5)
    .map(([k]) => `<i style="display:inline-block;width:12px;height:12px;border-radius:3px;border:1px solid rgba(255,255,255,0.2);background:${hex(skin.colors[k])}"></i>`)
    .join('');
  return `<span style="display:inline-flex;gap:3px;vertical-align:middle;margin-left:8px">${colors}</span>`;
};

// ============================================================================
// 3. Skin Color Picker & Presets Setup
// ============================================================================
const PRESETS = [
  { name: 'Rừng Rậm (Jungle)', color: '#2d6a4f' },
  { name: 'Sa Mạc (Savanna)', color: '#c68b59' },
  { name: 'Hắc Ám (Obsidian)', color: '#1a1d20' },
  { name: 'Bạch Tạng (Albino)', color: '#e2e8f0' },
  { name: 'Dung Nham (Volcanic)', color: '#9d0208' },
  { name: 'Đầm Lầy (Swamp)', color: '#588157' },
];

// What the editor starts with: a real Carnotaurus skin from this server
// (the game's linear colours), so the preview looks like a dino at once.
const DEFAULT_SKIN = {
  colors: {
    Body: { r: 0.347, g: 0.22, b: 0.156 }, Flank: { r: 0.195, g: 0.109, b: 0.091 },
    Underbelly: { r: 0.397, g: 0.314, b: 0.266 }, Markings: { r: 0.056, g: 0.045, b: 0.037 },
    Detail1: { r: 0.02, g: 0.017, b: 0.015 }, Eyes: { r: 0.25, g: 0.12, b: 0.02 },
    MaleDisplay: { r: 0.342, g: 0.1, b: 0.06 }, Teeth: { r: 0.62, g: 0.55, b: 0.42 },
    Mouth: { r: 0.4, g: 0.223, b: 0.179 }, Claws: { r: 0.05, g: 0.041, b: 0.033 },
  },
  patternIndex: 0,
  female: false,
};

/** Put a skin's colours (the game's linear values) in the pickers. */
function applySkin(skin) {
  for (const [id] of REGIONS) {
    const c = skin.colors?.[id];
    if (!c) continue;
    const col = hex(c);
    $(`picker-${id}`).value = col;
    $(`hex-${id}`).textContent = col;
  }
}

function initSkinEditor() {
  const grid = $('skin-regions-grid');
  grid.innerHTML = REGIONS.map(([id, label]) => {
    const col = hex(DEFAULT_SKIN.colors[id]);
    return `
    <div class="region-card" data-region="${id}">
      <div class="region-info">
        <h4>${label}</h4>
        <span class="muted">${id}</span>
      </div>
      <div class="region-controls">
        <input type="color" class="color-picker-input" id="picker-${id}" value="${col}">
        <span class="hex-display" id="hex-${id}">${col}</span>
      </div>
    </div>`;
  }).join('');

  for (const [id] of REGIONS) {
    const input = $(`picker-${id}`);
    const hexSpan = $(`hex-${id}`);
    input.addEventListener('input', () => {
      hexSpan.textContent = input.value;
    });
  }


  // Presets
  const presetsBar = $('skin-presets-bar');
  presetsBar.innerHTML = PRESETS.map((p) => `
    <button type="button" class="btn btn-ghost" style="padding:5px 12px;font-size:12px;gap:6px" data-preset="${p.color}">
      <i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${p.color}"></i>
      ${p.name}
    </button>
  `).join('');

  presetsBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (!btn) return;
    const col = btn.dataset.preset;
    for (const [id] of REGIONS) {
      const input = $(`picker-${id}`);
      const hexSpan = $(`hex-${id}`);
      if (input && hexSpan) {
        input.value = col;
        hexSpan.textContent = col;
      }
    }
  });

  // Load from active dino button
  $('btn-load-my-skin').addEventListener('click', () => {
    if (!lastMeData?.dino?.skin?.colors) {
      alert('Chưa có dữ liệu skin dino đang chơi. Hãy đăng nhập và vào game điều khiển dino!');
      return;
    }
    applySkin(lastMeData.dino.skin);
  });
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

    heroAuth.innerHTML = `
      <button type="button" class="btn btn-emerald" data-switch-tab="game">
        🦖 Vào Bảng Điều Khiển Dino
      </button>`;
  } else {
    authContainer.innerHTML = `
      <a class="btn btn-steam" href="/auth/steam" style="padding:7px 14px;font-size:12px">
        Đăng nhập Steam
      </a>`;
    heroAuth.innerHTML = `
      <a class="btn btn-steam" href="/auth/steam">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 1 10 10c0 4.88-3.5 8.94-8.1 9.8l-2.45-3.5c.34-.1.65-.27.9-.5l.05-.05c1.4-1.37 1.4-3.6 0-4.97a3.53 3.53 0 0 0-4.96 0c-.26.25-.43.55-.53.88L3.2 12.3A10 10 0 0 1 12 2zm-4.3 13.9a2.12 2.12 0 1 1 3-3 2.12 2.12 0 0 1-3 3zm10.7-3.9a1.41 1.41 0 1 1 0-2.82 1.41 1.41 0 0 1 0 2.82z"/></svg>
        Đăng nhập bằng Steam
      </a>`;
  }
}

function renderServer(srv) {
  if (!srv || srv.status !== 200) {
    $('srv-dot').className = 'dot';
    $('srv-status-text').textContent = 'Server đang tắt hoặc mất kết nối';
    $('srv-slots-text').textContent = '0 / 100';
    $('srv-meter-fill').style.width = '0%';
    return;
  }
  const isUp = srv.body.phase === 'running';
  const online = srv.body.online ?? 0;
  const max = srv.body.maxPlayers ?? 100;

  // Name and Discord from the server's Game.ini (bridge: publicServerInfo).
  if (srv.body.name) { $('srv-name').textContent = srv.body.name; document.title = srv.body.name; }
  const discord = $('srv-discord');
  if (typeof srv.body.discord === 'string' && /^https:\/\/discord(app)?\.(gg|com)\//.test(srv.body.discord)) {
    discord.href = srv.body.discord;
    discord.hidden = false;
  } else {
    discord.hidden = true;
  }
  const pctSlots = Math.min(100, Math.round((online / max) * 100));

  $('srv-dot').className = `dot${isUp ? ' up' : ''}`;
  $('srv-status-text').textContent = isUp ? 'Máy chủ đang hoạt động' : 'Máy chủ đang khởi động lại…';
  $('srv-slots-text').textContent = `${online} / ${max}`;
  $('srv-meter-fill').style.width = `${pctSlots}%`;
}

function renderGame(me) {
  const navBadge = $('nav-dino-badge');
  if (me.dino && me.online) {
    navBadge.hidden = false;
    $('game-dino-species').textContent = me.dino.species ?? 'Dino Đang Chơi';
    $('game-dino-status').textContent = 'Đang trực tuyến trên server Gateway';
    $('game-dino-growth').textContent = `Growth: ${pct(me.dino.growth)}`;
    $('game-growth-pct').textContent = pct(me.dino.growth);
    $('game-growth-fill').style.width = `${Math.min(100, Math.max(0, (me.dino.growth ?? 0) * 100))}%`;

    // Build vitals structure if not yet built
    if ($('game-vitals').children.length === 0) {
      $('game-vitals').innerHTML = buildVitalsGrid(me.dino);
    }
    updateVitals(me.dino);

    // Prime
    $('game-prime-content').innerHTML = renderPrimeBoard(me.dino.prime);

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
  } else {
    navBadge.hidden = true;
    $('game-dino-species').textContent = me.online ? 'Đang chọn loài' : 'Chưa vào server';
    $('game-dino-status').textContent = me.online ? 'Bạn đang ở sảnh chọn dino ingame.' : 'Vào game để hiển thị đầy đủ chỉ số và vị trí.';
    $('game-dino-growth').textContent = 'Growth: 0%';
    $('game-growth-pct').textContent = '0%';
    $('game-growth-fill').style.width = '0%';
    $('game-vitals').innerHTML = '<p class="muted" style="grid-column:1/-1;padding:12px 0;margin:0">Chưa có chỉ số sinh tồn của dino.</p>';
    $('game-prime-content').innerHTML = '<p class="muted" style="font-size:13px">Dino chưa spawn trên bản đồ.</p>';
    $('skin-active-swatches-box').hidden = true;
  }

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
  [/^Wrong species.*$/, () => 'Sai loài — respawn đúng loài đã cất rồi thử lại.'],
  [/^Restoring '.+' at the spot you stored it\..*$/, () => 'Đang khôi phục tại chỗ đã cất — đứng yên vài giây.'],
  [/^Restoring '.+'\..*$/, () => 'Đang khôi phục — đứng yên vài giây.'],
  [/^Slot '.+' has no stored position.*$/, () => 'Con này không có vị trí đã cất — khôi phục tại chỗ.'],
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
    garageStatus('', 'Đã gửi — chờ game xử lý…');
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
    garageStatus('', `⏳ Game đã nhận lệnh — đang đếm ngược.${msgs ? `<ul>${msgs}</ul>` : ''}`);
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

function renderGara(me) {
  if (!me) return;
  const rules = me.garageRules ?? { maxSlots: 2, redeemAt: 'current', storeCountdown: 30 };
  $('nav-gara-badge').textContent = me.garage.length;
  $('gara-count-tag').textContent = `${me.garage.length} / ${rules.maxSlots}`;
  $('gara-where-box').hidden = rules.redeemAt !== 'choice';

  // Store: needs a dino in game, a free place, nothing in flight.
  const playing = Boolean(me.online && me.dino);
  const full = me.garage.length >= rules.maxSlots;
  $('gara-store-btn').disabled = garageBusy || Boolean(storing) || !playing || full;
  $('gara-store-hint').textContent = storing
    ? `Đang cất: còn ${Math.max(0, Math.ceil((storing.until - Date.now()) / 1000))} giây — đứng yên trong bán kính 5 m, không đánh và không bị đánh.`
    : !me.online ? 'Vào game để cất / lấy dino.'
    : !me.dino ? 'Chọn loài và spawn dino trước.'
    : full ? `Gara đã đầy (${rules.maxSlots}) — lấy bớt một con ra trước.`
    : `Cất ${me.dino.species ?? 'dino'} đang chơi: đếm ngược ${rules.storeCountdown} giây, trong lúc đó đứng yên (trong 5 m), không đánh và không bị đánh.`;

  if (me.garage.length === 0) {
    delete $('gara-slots-list').dataset.key;
    $('gara-slots-list').innerHTML = `
      <li style="padding:32px 16px;text-align:center;background:var(--bg-surface);border-radius:12px;border:1px solid var(--border)">
        <div style="font-size:32px;margin-bottom:8px">🚗</div>
        <b>Gara của bạn đang trống</b>
        <p class="muted" style="margin:4px 0 0;font-size:12px">Bấm <b>Cất dino đang chơi</b> ở trên để cất.</p>
      </li>`;
    return;
  }

  const rows = me.garage.map((g) => {
    // Redeem: online, playing the SAME species (the mod checks it too).
    const same = me.dino && g.species && me.dino.species === g.species;
    const why = !me.online ? 'Vào game trước'
      : !me.dino ? `Spawn ${g.species ?? 'đúng loài'} trước`
      : !same ? `Respawn thành ${g.species ?? 'đúng loài'} để lấy ra`
      : '';
    return { g, why };
  });
  // Rebuild only when something shown changes.
  const key = JSON.stringify([rows.map(({ g, why }) => [g.slot, g.species, g.growth, g.storedAt, g.gift, g.prime, g.vitals, g.max, g.skin, why]), garageBusy]);
  const list = $('gara-slots-list');
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.innerHTML = rows.map(({ g, why }) => `
    <li class="garage-slot-card stacked${g.prime ? ' prime' : ''}">
      <div class="garage-slot-body">
        <div style="flex:1;min-width:0">
          <b style="font-size:15px">${esc(g.species ?? 'Dino')}</b>
          <span class="tag" style="margin-left:6px">Growth ${pct(g.growth)}</span>
          ${skinStrip(g.skin)}
          ${g.prime ? '<span class="tag prime" style="margin-left:6px">👑 Prime</span>' : ''}
          ${g.gift ? '<span class="tag purple" style="margin-left:6px">Quà Admin</span>' : ''}
          <div class="muted" style="font-size:12px;margin-top:2px">Cất lúc: ${when(g.storedAt)}${why ? ` · ${esc(why)}` : ''}</div>
          ${slotVitals(g)}
        </div>
        <button type="button" class="btn btn-emerald slot-redeem" data-redeem="${esc(g.slot)}" ${why || garageBusy ? 'disabled' : ''}>📤 Lấy ra</button>
      </div>
    </li>`).join('');
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
    const END = { death: 'Tử vong', garage: 'Cất vào gara', admin: 'Admin can thiệp' };
    container.innerHTML = lives.map((l, i) => `
      <li class="leaderboard-item">
        <div style="display:flex;align-items:center;gap:12px">
          <span class="leaderboard-rank">#${i + 1}</span>
          <div>
            <b>${esc(l.species ?? 'Dino')}</b>
            <span class="tag" style="margin-left:6px">Growth ${pct(l.growth)}</span>
            <span class="muted" style="font-size:12px;margin-left:6px">⚔️ ${l.kills} kills</span>
            <div class="muted" style="font-size:11.5px;margin-top:2px">
              ${l.end ? `<span class="tag ${l.end === 'death' ? 'kill' : ''}">${END[l.end] ?? esc(l.end)}${l.killedBy ? ` bởi ${esc(l.killedBy)}` : ''}</span>` : '<span class="tag">Đang sống</span>'}
              · Sinh ra: ${when(l.spawnedAt)}
            </div>
          </div>
        </div>
      </li>
    `).join('');
    return;
  }

  const list = lastBoardData?.[currentRankingTab] ?? [];
  if (list.length === 0) {
    container.innerHTML = '<li class="muted" style="padding:24px;text-align:center">Chưa có người chơi trong danh sách.</li>';
    return;
  }

  const formatVal = (v) => currentRankingTab === 'playtime' || currentRankingTab === 'longestLife' ? dur(v) : `${v} kills`;

  container.innerHTML = list.map((item, idx) => `
    <li class="leaderboard-item">
      <div style="display:flex;align-items:center;gap:12px">
        <span class="leaderboard-rank ${idx === 0 ? 'top-1' : idx === 1 ? 'top-2' : idx === 2 ? 'top-3' : ''}">
          ${idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : (idx + 1)}
        </span>
        <div>
          <b>${esc(item.name ?? 'Ẩn danh')}</b>
          ${item.species ? `<span class="muted" style="font-size:12px;margin-left:6px">(${esc(item.species)})</span>` : ''}
        </div>
      </div>
      <b style="font-size:15px;color:var(--emerald-light)">${formatVal(item.value)}</b>
    </li>
  `).join('');
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
// the page itself is redrawn only every 5 s — nobody is looking at it. Coming
// back to the launcher redraws at once.
let lastDrawn = 0;
const BACKGROUND_DRAW_MS = 5000;
const inBackground = () => Boolean(window.isleLauncher) && (document.hidden || !document.hasFocus());

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
      pushOverlayGame(null);
      renderAuth(null);
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
function pushOverlayGame(dino) {
  if (!window.isleLauncher?.overlayGame) return;
  window.isleLauncher.overlayGame({
    dino: dino ? {
      species: dino.species, growth: dino.growth, vitals: dino.vitals, max: dino.max,
      position: dino.position, trail: dino.trail, prime: dino.prime,
    } : null,
    ai: lastAi,
    // The point set on the map (map.js): the mini map draws a line to it.
    target: map ? map.getTarget() : loadWaypoints().target,
  });
}

// Live AI on the map: every 2 s while the map page is open and seen, or (in
// the launcher) while the overlay's mini map is on and shows AI.
let aiBusy = false;
let miniMapAi = false;
let overlaySettings = null;
function readOverlayAi(settings) {
  if (settings) overlaySettings = settings;
  const m = overlaySettings && overlaySettings.widgets && overlaySettings.widgets.map;
  miniMapAi = Boolean(overlaySettings && overlaySettings.enabled && m && m.enabled && m.show && m.show.ai !== false
    && (!gameMode.on || gameMode.keep.map));
}
if (window.isleLauncher?.overlayGet) {
  readOverlayAi(window.isleLauncher.overlayGet()?.settings);
  window.isleLauncher.onOverlayChanged?.((saved) => readOverlayAi(saved));
  // Settings changed from the tray or the overlay card: look again now and then.
  setInterval(() => readOverlayAi(window.isleLauncher.overlayGet()?.settings), 10_000);
}
setInterval(async () => {
  const wanted = (currentTab === 'map' && !document.hidden) || miniMapAi;
  if (aiBusy || !wanted || !lastMeData || !map) return;
  aiBusy = true;
  try {
    const ai = await getJson('/api/ai');
    if (ai.status === 200) { lastAi = ai.body?.list ?? []; map.setAi(lastAi); }
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

// Initial setup
initSkinEditor();

// Route initial tab from URL hash
const initialHash = location.hash.replace(/^#/, '');
if (VALID_TABS.includes(initialHash)) {
  switchTab(initialHash, false);
} else {
  switchTab('home', false);
}

refresh();
setInterval(refresh, 1000);
