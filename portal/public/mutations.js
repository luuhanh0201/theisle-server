// mutations.html, the list of Evrima mutations with their icons. Its own file:
// the site's CSP runs no inline script. Icons from one bundle (mut-icons.js:
// one <img> each, all at once, tripped the proxy in front of the site).
let allMutations = [];
let currentFilter = 'all';
let searchQuery = '';

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const DIET_NAMES = {
  all: 'Mọi loài',
  carnivore: 'Ăn thịt',
  herbivore: 'Ăn cỏ',
  herbivore_omnivore: 'Ăn cỏ / Tạp'
};

const KIND_NAMES = {
  lifecycle: 'Vòng đời (Mặc định)',
  slot2: 'Chỉ ô 2 / 4',
  unlock: 'Nhiệm vụ (Quest)'
};

function renderCards() {
  const grid = document.getElementById('mutation-grid');
  const q = searchQuery.trim().toLowerCase();

  const filtered = allMutations.filter(m => {
    // Search
    if (q) {
      const matchName = m.name.toLowerCase().includes(q);
      const matchDesc = m.description.toLowerCase().includes(q);
      const matchEn = m.en.toLowerCase().includes(q);
      const matchUnlock = (m.unlock || '').toLowerCase().includes(q);
      if (!matchName && !matchDesc && !matchEn && !matchUnlock) return false;
    }
    // Filter
    if (currentFilter === 'active') return m.status === 'active';
    if (currentFilter === 'diet-carnivore') return m.diet === 'carnivore';
    if (currentFilter === 'diet-herbivore') return m.diet === 'herbivore' || m.diet === 'herbivore_omnivore';
    if (currentFilter === 'diet-all') return m.diet === 'all';
    if (currentFilter === 'kind-unlock') return m.kind === 'unlock';
    if (currentFilter === 'status-test') return m.status === 'test';
    if (currentFilter === 'status-removed') return m.status === 'removed';
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state">Không tìm thấy mutation nào khớp với bộ lọc.</div>';
    return;
  }

  grid.innerHTML = filtered.map(m => {
    let dietBadgeClass = 'badge-all';
    if (m.diet === 'carnivore') dietBadgeClass = 'badge-carnivore';
    else if (m.diet === 'herbivore') dietBadgeClass = 'badge-herbivore';
    else if (m.diet === 'herbivore_omnivore') dietBadgeClass = 'badge-omnivore';

    let statusBadge = '';
    if (m.status === 'test') {
      statusBadge = '<span class="badge badge-test">Bản thử nghiệm</span>';
    } else if (m.status === 'removed') {
      statusBadge = '<span class="badge badge-removed">Đã gỡ bỏ</span>';
    } else if (m.kind === 'unlock') {
      statusBadge = '<span class="badge badge-quest">Mở khoá Quest</span>';
    } else if (m.kind === 'slot2') {
      statusBadge = '<span class="badge" style="background:rgba(56,189,248,0.15);color:#38bdf8;border:1px solid rgba(56,189,248,0.3)">Ô 2 / 4</span>';
    }

    return `
      <article class="card">
        <div class="card-top">
          <div class="icon-wrap">
            <img class="icon-img" data-mut-icon="${esc(m.slug)}" alt="${esc(m.name)}" width="80" height="80">
          </div>
          <div class="card-main">
            <h2 class="card-title">${esc(m.name)}</h2>
            <div class="card-en">${esc(m.en)}</div>
            <div class="card-badges">
              <span class="badge ${dietBadgeClass}">${esc(DIET_NAMES[m.diet] || m.diet)}</span>
              ${m.femaleOnly ? '<span class="badge" style="background:rgba(236,72,153,0.15);color:#ec4899;border:1px solid rgba(236,72,153,0.3)">♀ Chỉ con cái</span>' : ''}
              ${m.groupLeaderOnly ? '<span class="badge" style="background:rgba(250,204,21,0.15);color:#facc15;border:1px solid rgba(250,204,21,0.3)">👑 Trưởng nhóm</span>' : ''}
              ${statusBadge}
            </div>
          </div>
        </div>

        <p class="card-desc">${esc(m.description)}</p>

        <div class="meta-box">
          ${m.stat ? `<div class="meta-row"><span class="meta-lbl">Chỉ số tăng:</span><span class="meta-val">${esc(m.stat)}</span></div>` : ''}
          ${m.tiers ? `<div class="meta-row"><span class="meta-lbl">Đời 1/2/3/4:</span><span class="meta-val" style="color:var(--emerald-light)">${esc(m.tiers)}</span></div>` : ''}
          ${m.unlock ? `<div class="meta-row"><span class="meta-lbl">Cách mở khoá:</span><span class="meta-val meta-val-quest">${esc(m.unlock)}</span></div>` : ''}
          ${m.slots ? `<div class="meta-row"><span class="meta-lbl">Vị trí ô:</span><span class="meta-val">${esc(m.slots)}</span></div>` : ''}
          ${m.statusNote ? `<div class="meta-row"><span class="meta-lbl">Ghi chú:</span><span class="meta-val" style="color:#f87171">${esc(m.statusNote)}</span></div>` : ''}
        </div>

        <div class="card-actions">
          <a class="btn-dl" href="/${esc(m.iconSvg)}" download="${esc(m.slug)}.svg">Tải SVG</a>
          <a class="btn-dl" href="/${esc(m.iconPng)}" download="${esc(m.slug)}.png">Tải PNG</a>
        </div>
      </article>
    `;
  }).join('');
}

async function init() {
  try {
    const res = await fetch('/img/mutations/mutations.json');
    if (!res.ok) throw new Error('Không tải được danh sách mutation');
    allMutations = await res.json();
    renderCards();
  } catch (err) {
    document.getElementById('mutation-grid').innerHTML = `
      <div class="empty-state" style="color:#f87171">Lỗi tải dữ liệu: ${esc(err.message)}</div>
    `;
  }

  // Filter Buttons
  document.getElementById('filter-container').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderCards();
  });

  // Search input
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderCards();
  });
}

init();
