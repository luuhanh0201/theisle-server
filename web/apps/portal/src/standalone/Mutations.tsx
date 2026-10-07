import { useEffect, useState, type CSSProperties } from 'react';

/** One mutation of img/mutations/mutations.json (scripts/build-mutation-icons.mjs). */
export interface MutationInfo {
  slug: string; name: string; en: string; description: string; diet: string; kind?: string; status?: string;
  femaleOnly?: boolean; groupLeaderOnly?: boolean; stat?: string; tiers?: string; unlock?: string; slots?: string; statusNote?: string;
  iconSvg: string; iconPng: string;
}

const DIET_NAMES: Record<string, string> = { all: 'Mọi loài', carnivore: 'Ăn thịt', herbivore: 'Ăn cỏ', herbivore_omnivore: 'Ăn cỏ / Tạp' };
const DIET_CLASS: Record<string, string> = { carnivore: 'badge-carnivore', herbivore: 'badge-herbivore', herbivore_omnivore: 'badge-omnivore' };
// The filter buttons, their counts as the page before React wrote them.
const FILTERS: Array<[string, string]> = [
  ['all', 'Tất cả (46)'], ['active', 'Đang có trong game (41)'], ['diet-carnivore', 'Ăn thịt (7)'], ['diet-herbivore', 'Ăn cỏ / Tạp (8)'],
  ['diet-all', 'Mọi loài (31)'], ['kind-unlock', 'Nhiệm vụ Quest (9)'], ['status-test', 'Bản thử nghiệm (3)'], ['status-removed', 'Đã gỡ bỏ (2)'],
];
const pill = (rgb: string, color: string): CSSProperties => ({ background: `rgba(${rgb},0.15)`, color, border: `1px solid rgba(${rgb},0.3)` });

/** What the search and the filter keep (mutations.js renderCards). */
export function filterMutations(all: MutationInfo[], filter: string, search: string): MutationInfo[] {
  const q = search.trim().toLowerCase();
  return all.filter((m) => {
    if (q && ![m.name, m.description, m.en, m.unlock ?? ''].some((t) => t.toLowerCase().includes(q))) return false;
    if (filter === 'active') return m.status === 'active';
    if (filter === 'diet-carnivore') return m.diet === 'carnivore';
    if (filter === 'diet-herbivore') return m.diet === 'herbivore' || m.diet === 'herbivore_omnivore';
    if (filter === 'diet-all') return m.diet === 'all';
    if (filter === 'kind-unlock') return m.kind === 'unlock';
    if (filter === 'status-test') return m.status === 'test';
    if (filter === 'status-removed') return m.status === 'removed';
    return true;
  });
}

function Card({ m }: { m: MutationInfo }) {
  const status = m.status === 'test' ? <span className="badge badge-test">Bản thử nghiệm</span>
    : m.status === 'removed' ? <span className="badge badge-removed">Đã gỡ bỏ</span>
      : m.kind === 'unlock' ? <span className="badge badge-quest">Mở khoá Quest</span>
        : m.kind === 'slot2' ? <span className="badge" style={pill('56,189,248', '#38bdf8')}>Ô 2 / 4</span> : null;
  return (
    <article className="card">
      <div className="card-top">
        <div className="icon-wrap">
          {/* Filled by mut-icons.js (one request for every icon). */}
          <img className="icon-img" data-mut-icon={m.slug} alt={m.name} width="80" height="80" />
        </div>
        <div className="card-main">
          <h2 className="card-title">{m.name}</h2>
          <div className="card-en">{m.en}</div>
          <div className="card-badges">
            <span className={`badge ${DIET_CLASS[m.diet] ?? 'badge-all'}`}>{DIET_NAMES[m.diet] ?? m.diet}</span>
            {m.femaleOnly && <span className="badge" style={pill('236,72,153', '#ec4899')}>♀ Chỉ con cái</span>}
            {m.groupLeaderOnly && <span className="badge" style={pill('250,204,21', '#facc15')}>👑 Trưởng nhóm</span>}
            {status}
          </div>
        </div>
      </div>
      <p className="card-desc">{m.description}</p>
      <div className="meta-box">
        {m.stat && <div className="meta-row"><span className="meta-lbl">Chỉ số tăng:</span><span className="meta-val">{m.stat}</span></div>}
        {m.tiers && <div className="meta-row"><span className="meta-lbl">Đời 1/2/3/4:</span><span className="meta-val" style={{ color: 'var(--emerald-light)' }}>{m.tiers}</span></div>}
        {m.unlock && <div className="meta-row"><span className="meta-lbl">Cách mở khoá:</span><span className="meta-val meta-val-quest">{m.unlock}</span></div>}
        {m.slots && <div className="meta-row"><span className="meta-lbl">Vị trí ô:</span><span className="meta-val">{m.slots}</span></div>}
        {m.statusNote && <div className="meta-row"><span className="meta-lbl">Ghi chú:</span><span className="meta-val" style={{ color: '#f87171' }}>{m.statusNote}</span></div>}
      </div>
      <div className="card-actions">
        <a className="btn-dl" href={`/${m.iconSvg}`} download={`${m.slug}.svg`}>Tải SVG</a>
        <a className="btn-dl" href={`/${m.iconPng}`} download={`${m.slug}.png`}>Tải PNG</a>
      </div>
    </article>
  );
}

/** mutations.html in React: the Evrima mutations with their icons, a search and filters (as mutations.js). */
export function Mutations() {
  const [all, setAll] = useState<MutationInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/img/mutations/mutations.json');
        if (!res.ok) throw new Error('Không tải được danh sách mutation');
        setAll(await res.json() as MutationInfo[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);
  const shown = all ? filterMutations(all, filter, search) : [];
  return (
    <div className="container">
      <header>
        <div className="top-bar">
          <a href="/" className="back-btn">← Quay lại Cổng Game</a>
          <span className="badge-total" id="stat-active">41 Active / 46 Tổng cộng</span>
        </div>
        <h1>🧬 Thư Viện Mutation Evrima</h1>
        <p className="subtitle">Toàn bộ đột biến gen (Mutations) chính thức trong The Isle Evrima kèm icon lục giác độc quyền, mô tả tác dụng tiếng Việt, chế độ ăn và chỉ số đời (Entombment).</p>
      </header>
      <div className="controls">
        <div className="search-row">
          <input type="text" id="search-input" className="search-input" placeholder="🔍 Tìm mutation theo tên tiếng Anh, tiếng Việt, tác dụng..." autoComplete="off"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="filter-tags" id="filter-container">
          {FILTERS.map(([id, label]) => (
            <button key={id} className={`filter-btn${filter === id ? ' active' : ''}`} data-filter={id} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
      </div>
      <main className="grid" id="mutation-grid">
        {error !== null ? <div className="empty-state" style={{ color: '#f87171' }}>Lỗi tải dữ liệu: {error}</div>
          : all !== null && shown.length === 0 ? <div className="empty-state">Không tìm thấy mutation nào khớp với bộ lọc.</div>
            : shown.map((m) => <Card key={m.slug} m={m} />)}
      </main>
    </div>
  );
}
