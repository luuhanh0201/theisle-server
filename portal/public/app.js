// Isle Player — the page. Reads /api/me, /api/server, /api/leaderboard; every
// value comes from the server as data and is escaped before it is shown.

import { createMap } from './map.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (g) => (typeof g === 'number' ? `${Math.round(g * 100)}%` : '?');
const when = (t) => (t ? new Date(t * 1000).toLocaleString('vi-VN', { hour12: false }) : '—');
function dur(sec) {
  sec = Math.max(0, Math.round(sec ?? 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}g ${m}p` : `${m}p ${sec % 60}s`;
}

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

const VITALS = [['health', 'Máu', '#ef4444'], ['stamina', 'Stamina', '#f59e0b'], ['hunger', 'Dạ dày', '#84cc16'],
  ['thirst', 'Nước', '#3b82f6'], ['blood', 'Huyết', '#b91c1c'], ['oxygen', 'Oxy', '#06b6d4']];

/** Bars are built once per dino and then only resized, so the width animates. */
function vitalRows(dino) {
  return VITALS.filter(([k]) => dino.vitals[k] !== null).map(([k, label, color]) =>
    `<div class="vital" data-v="${k}"><span class="muted">${label}</span><div class="bar"><span style="background:${color};width:0%"></span></div><b></b></div>`).join('');
}
function updateVitals(dino) {
  for (const row of document.querySelectorAll('#dino .vital')) {
    const k = row.dataset.v;
    const cur = dino.vitals[k];
    const max = dino.max?.[k];
    const ratio = typeof max === 'number' && max > 0 && typeof cur === 'number' ? Math.max(0, Math.min(1, cur / max)) : null;
    row.querySelector('.bar > span').style.width = ratio === null ? '100%' : `${(ratio * 100).toFixed(1)}%`;
    row.querySelector('.bar > span').style.opacity = ratio === null ? '.35' : '';
    row.querySelector('b').textContent = typeof cur !== 'number' ? '?'
      : ratio === null ? `${Math.round(cur)}` : `${Math.round(cur)}/${Math.round(max)}`;
    row.classList.toggle('low', ratio !== null && ratio < 0.25);
  }
}
function primeBoard(pb) {
  if (!pb) return '';
  const verdict = pb.isPrime ? '<span class="tag">Đã là Prime elder</span>'
    : pb.eligible ? '<span class="tag">Game: đủ điều kiện prime</span>'
    : '<span class="tag kill">Game: chưa đủ điều kiện</span>';
  const g = typeof pb.growth === 'number' ? pb.growth : null;
  const deadline = g === null ? '' : `<div class="deadline" title="Growth ${pct(g)} — mốc ${pct(pb.deadline)}">
      <span style="width:${Math.min(100, g * 100).toFixed(1)}%"></span><i style="left:${pb.deadline * 100}%"></i></div>
    <div class="muted" style="font-size:12px">${pb.locked ? `Growth ${pct(g)} — đã qua mốc ${pct(pb.deadline)}: kết quả prime đã chốt.`
      : `Growth ${pct(g)} — còn tới mốc ${pct(pb.deadline)} để hoàn thành nhiệm vụ.`}</div>`;
  const rows = pb.conditions.map((c) => `<li class="${c.met ? 'met' : ''}"><span class="ck">${c.met === null ? '?' : c.met ? '✓' : ''}</span>
      <span>${esc(c.label)}${c.passive ? ' <span class="muted">(thụ động — mặc định đạt nếu không mắc)</span>' : ''}</span></li>`).join('');
  return `<div class="prime" style="margin-top:0"><b>${pb.met}/10 đạt</b> · cần 5 (loài nhỏ 4) ${verdict}</div>${deadline}
    <ul class="quests">${rows}</ul>
    <p class="muted" style="font-size:11.5px;margin:8px 0 0">Trạng thái ✓ lấy trực tiếp từ game. Tên từng điều kiện đang được xác minh — game chỉ đánh số 1–10.</p>`;
}

function primeLine(p) {
  if (!p) return '';
  const state = p.isPrime ? '<span class="tag">Prime elder</span>'
    : p.eligible ? '<span class="tag">Đủ điều kiện lên prime</span>'
    : '<span class="tag kill">Chưa đủ điều kiện prime</span>';
  return `<div class="prime"><b>Prime:</b> ${state}${p.elder ? '<span class="tag">Elder</span>' : ''} <span class="muted">${p.met}/10 nhiệm vụ</span></div>`;
}

// Skin regions as the game names them (pawn.CustomizerData, minus "Color").
const REGIONS = [['Body', 'Thân'], ['Markings', 'Hoa văn'], ['Flank', 'Sườn'], ['Underbelly', 'Bụng'],
  ['Detail1', 'Chi tiết'], ['Eyes', 'Mắt'], ['MaleDisplay', 'Trưng bày'], ['Teeth', 'Răng'], ['Mouth', 'Miệng'], ['Claws', 'Móng']];

/** Unreal FLinearColor (linear 0..1) → #rrggbb in sRGB, the way the screen shows it. */
function hex(c) {
  const ch = (v) => {
    const x = Math.min(1, Math.max(0, Number(v) || 0));
    const s = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(s * 255).toString(16).padStart(2, '0');
  };
  return `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`;
}
const regionsOf = (skin) => {
  const known = REGIONS.filter(([k]) => skin.colors[k]);
  const extra = Object.keys(skin.colors).filter((k) => !REGIONS.some(([r]) => r === k)).map((k) => [k, k]);
  return [...known, ...extra];
};
function skinPanel(skin) {
  if (!skin) return '<div class="skin muted" style="font-size:12px">Chưa đọc được skin.</div>';
  return `<div class="skin"><h3>Skin${typeof skin.patternIndex === 'number' ? ` · hoa văn #${skin.patternIndex}` : ''}</h3>
    <div class="swatches">${regionsOf(skin).map(([k, label]) => `<div class="sw" title="${esc(k)} ${hex(skin.colors[k])}"><i style="background:${hex(skin.colors[k])}"></i>${esc(label)}</div>`).join('')}</div></div>`;
}
const skinStrip = (skin) => (skin ? `<span class="strip" title="Skin lúc cất">${regionsOf(skin).slice(0, 5)
  .map(([k]) => `<i style="background:${hex(skin.colors[k])}"></i>`).join('')}</span>` : '');

let map = null;   // created on the first logged-in render (the card is hidden before)
function renderMe(me) {
  $('auth').innerHTML = `<span class="muted" style="margin-right:10px">${esc(me.name ?? me.steamId)}</span><button type="button" class="btn btn-ghost" id="logout">Đăng xuất</button>`;
  $('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.reload(); });

  map ??= createMap($('map'));
  map.update(me.dino);

  if (me.dino) {
    $('dino-title').textContent = `${me.dino.species ?? 'Dino'} · growth ${pct(me.dino.growth)}`;
    // Rebuild only when the dino (or the set of vitals) changes; otherwise resize.
    const shape = `${me.dino.species}|${VITALS.filter(([k]) => me.dino.vitals[k] !== null).map(([k]) => k).join(',')}`;
    if ($('dino').dataset.shape !== shape) {
      $('dino').dataset.shape = shape;
      $('dino').innerHTML = `<div class="bar" style="margin-bottom:12px"><span id="growth-bar" style="width:0%"></span></div>`
        + vitalRows(me.dino) + '<div id="prime-line"></div><div id="skin-panel"></div>';
    }
    $('growth-bar').style.width = `${Math.min(100, Math.max(0, (me.dino.growth ?? 0) * 100))}%`;
    updateVitals(me.dino);
    $('prime-line').innerHTML = primeLine(me.dino.prime);
    $('prime-card').hidden = !me.dino.prime;
    $('prime-board').innerHTML = primeBoard(me.dino.prime);
    $('skin-panel').innerHTML = skinPanel(me.dino.skin);
  } else {
    $('prime-card').hidden = true;
    delete $('dino').dataset.shape;
    $('dino-title').textContent = 'Dino hiện tại';
    $('dino').innerHTML = `<p class="muted">${me.online ? 'Bạn đang ở màn chọn loài.' : 'Bạn chưa vào server.'}</p>`;
  }

  const s = me.stats;
  $('stats').innerHTML = [['Kill', s.kills], ['Chết', s.deaths], ['Spawn', s.spawns], ['Giờ chơi', dur(s.playtime)], ['Sống lâu nhất', dur(s.longestLife)], ['Phiên', s.sessions]]
    .map(([k, v]) => `<div class="stat"><b>${esc(v)}</b><span>${k}</span></div>`).join('');

  $('garage').innerHTML = me.garage.length === 0 ? '<li class="muted">Gara trống.</li>'
    : me.garage.map((g) => `<li><span><b>${esc(g.slot)}</b> · ${esc(g.species ?? '?')} · growth ${pct(g.growth)}${skinStrip(g.skin)} ${g.gift ? '<span class="tag">quà admin</span>' : ''}</span><span class="muted">${when(g.storedAt)}</span></li>`).join('');

  const END = { death: 'chết', garage: 'cất gara', admin: 'admin xoá' };
  $('lives').innerHTML = me.lives.length === 0 ? '<li class="muted">Chưa có đời dino nào.</li>'
    : me.lives.map((l) => `<li><span><b>${esc(l.species ?? '?')}</b> · growth ${pct(l.growth)} · ${l.kills} kill
        ${l.end ? `<span class="tag ${l.end === 'death' ? 'kill' : ''}">${END[l.end] ?? esc(l.end)}${l.killedBy ? ` bởi ${esc(l.killedBy)}` : ''}</span>` : '<span class="tag">đang sống</span>'}</span>
        <span class="muted">${when(l.spawnedAt)}</span></li>`).join('');
}

// Your dino every second (the bridge reads the game once a second); the
// server line and the leaderboard change slowly, so every 15 s.
let lastSlow = 0;
let busy = false;
async function refresh() {
  if (busy) return;           // a slow answer must not stack requests
  busy = true;
  try { await refreshOnce(); } finally { busy = false; }
}
async function refreshOnce() {
  const slow = Date.now() - lastSlow > 15_000;
  const [srv, me, board] = await Promise.all([
    slow ? getJson('/api/server') : null, getJson('/api/me'), slow ? getJson('/api/leaderboard') : null]);
  if (slow) lastSlow = Date.now();
  if (srv === null) {
    // not refreshed this time
  } else if (srv.status === 200) {
    const up = srv.body.phase === 'running';
    $('srv-dot').className = `dot${up ? ' up' : ''}`;
    $('srv-text').textContent = up ? `Server đang chạy · ${srv.body.online} người online` : 'Server đang tắt hoặc khởi động lại';
  } else {
    $('srv-text').textContent = 'Không lấy được trạng thái server';
  }
  if (me.status === 401) {
    $('guest').hidden = false; $('player').hidden = true; $('auth').innerHTML = '';
  } else if (me.status === 200) {
    $('guest').hidden = true; $('player').hidden = false;
    renderMe(me.body);
  }
  if (board !== null && board.status === 200) {
    $('board').innerHTML = board.body.kills.length === 0 ? '<li class="muted">Chưa có ai.</li>'
      : board.body.kills.map((p, i) => `<li><span>${i + 1}. <b>${esc(p.name ?? '?')}</b> <span class="muted">${esc(p.species ?? '')}</span></span><b>${p.value}</b></li>`).join('');
  }
}

for (const b of document.querySelectorAll('.tabs button')) {
  b.addEventListener('click', () => {
    for (const x of document.querySelectorAll('.tabs button')) x.classList.toggle('on', x === b);
    for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== b.dataset.tab;
  });
}

refresh();
setInterval(refresh, 1000);
