import type { PlayerMe } from '@isle/api';
import { goTo, type Tab } from '../../app/router';
import { gameMode, launcher, updateAction } from '../../lib/launcher';
import { growthStage, growthWidth, heroTier, pct, tierClasses } from '../../lib/dino';

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Dock({ tab, cls, title, label, sub, subId, children }: { tab: Tab; cls: string; title: string; label: string; sub: string; subId?: string; children: React.ReactNode }) {
  return (
    <button type="button" className="hub-dock-item" data-switch-tab={tab} title={title} onClick={() => goTo(tab)}>
      <div className={`hub-dock-icon ${cls}`}><svg {...svg} width="22" height="22">{children}</svg></div>
      <div className="hub-dock-texts">
        <span className="hub-dock-title">{label}</span>
        <span className="hub-dock-sub" id={subId}>{sub}</span>
      </div>
      <div className="hub-dock-arrow">→</div>
    </button>
  );
}

const HUB_VITALS: ReadonlyArray<readonly ['health' | 'stamina' | 'hunger' | 'thirst', string, string]> = [
  ['health', 'Máu', '#ef4444'], ['stamina', 'Thể lực', '#f59e0b'], ['hunger', 'Dạ dày', '#84cc16'], ['thirst', 'Nước uống', '#3b82f6'],
];

/** The dino card: what it says, as app.js renderGame writes it (a guest: the page's first text). */
function dinoCard(me: PlayerMe | null | undefined) {
  const d = me?.online ? me.dino : null;
  if (d) {
    const st = growthStage(d.growth);
    return {
      badge: '● ĐANG CHƠI', online: true, species: d.species ?? 'Dino Đang Chơi', status: 'Đang trực tuyến trên server Gateway',
      growth: `${st.icon} Growth: ${pct(d.growth)}`, growthTitle: st.name, pct: pct(d.growth), width: growthWidth(d.growth),
      prime: d.prime ? '👑 Đã đạt danh hiệu Prime' : 'Nhiệm vụ Prime đang theo dõi',
    };
  }
  if (!me) {
    return { badge: '○ CHƯA VÀO', online: false, species: 'Chưa vào game', status: 'Bấm Chơi Ngay ở trên để kết nối vào máy chủ.',
      growth: 'Growth: 0%', growthTitle: undefined, pct: '0%', width: '0%', prime: 'Vào game để kích hoạt nhiệm vụ' };
  }
  return {
    badge: me.online ? '○ SẢNH CHỜ' : '○ CHƯA VÀO', online: false, species: me.online ? 'Đang chọn loài' : 'Chưa vào server',
    status: me.online ? 'Bạn đang ở sảnh chọn dino ingame.' : 'Bấm Chơi Ngay ở trên để kết nối vào máy chủ.',
    growth: '🥚 Growth: 0%', growthTitle: undefined, pct: '0%', width: '0%', prime: 'Vào game để kích hoạt nhiệm vụ',
  };
}

/**
 * The launcher's hub on Trang chủ (shown only inside the launcher, CSS html.in-launcher #launcher-hub):
 * quick access, the dino played now, voice / overlay, the update and game mode buttons.
 */
export function LauncherHub({ me }: { me: PlayerMe | null | undefined }) {
  const c = dinoCard(me);
  const d = me?.online ? me.dino : null;
  // Its tier colours follow the dino (app.js updateHeroTierFx), only once logged in.
  const tier = me ? tierClasses(heroTier(me.online && me.dino ? me.dino : null)) : '';
  const garage = me?.garage.length ?? 0;
  // maxSlots null: no limit (SVip, admin; bridge garage.ts garageRuleFor); no rules: 3 (app.js renderGara).
  const rules = me?.garageRules ?? { maxSlots: 3 };
  const max = rules.maxSlots == null ? '∞' : rules.maxSlots;
  return (
    <div className="launcher-hub" id="launcher-hub">
      <div className="hub-dock-grid">
        <Dock tab="map" cls="icon-map" title="Mo Ban Do Gateway Live" label="BẢN ĐỒ LIVE" sub="Tọa độ & Vùng di cư"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" /></Dock>
        <Dock tab="gara" cls="icon-gara" title="Mo Gara Khung Long" label="GARA DINO" subId="hub-gara-sub" sub={me && garage > 0 ? `${garage}/${max} dino` : 'Cất & Khôi phục'}>
          <path d="m22 8.35-10-5.35-10 5.35v10.65l10 5.35 10-5.35z" /><path d="M12 22V12" />
        </Dock>
        <Dock tab="ranking" cls="icon-ranking" title="Mo Bang Xep Hang" label="BẢNG XẾP HẠNG" sub="Top Kills & Dòng dõi"><circle cx="12" cy="8" r="7" /><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" /></Dock>
        <Dock tab="skin" cls="icon-skin" title="Mo Skin Studio" label="SKIN STUDIO" sub="Tuỳ biến 10 vùng màu">
          <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
        </Dock>
      </div>

      <div className="hub-dashboard-grid">
        <div className={`hub-card hub-dino-card${tier ? ` ${tier}` : ''}`} id="hub-dino-card">
          <div className="hub-card-header">
            <div className="hub-dino-headline">
              <span className={`hub-chip-live ${c.online ? 'online' : 'offline'}`} id="hub-dino-badge">{c.badge}</span>
              <h3 className="hub-dino-title" id="hub-dino-species">{c.species}</h3>
              <span className="hub-dino-sub" id="hub-dino-status">{c.status}</span>
            </div>
            <div className="hub-growth-badge" id="hub-dino-growth" title={c.growthTitle}>{c.growth}</div>
          </div>
          <div className="hub-growth-wrap">
            <div className="hub-growth-meta"><span>Tiến trình tăng trưởng</span><span id="hub-growth-pct" className="tabular-nums">{c.pct}</span></div>
            <div className="hub-meter-track"><div className="hub-meter-fill" id="hub-growth-fill" style={{ width: c.width }} /></div>
          </div>
          <div className="hub-vitals-grid">
            {HUB_VITALS.map(([k, label, color]) => {
              const cur = d?.vitals?.[k];
              const m = d?.max?.[k];
              const w = typeof cur === 'number' && typeof m === 'number' && m > 0 ? `${Math.min(100, Math.max(0, Math.round(cur / m * 100)))}%` : '0%';
              return (
                <div key={k} className="hub-vital-box" data-v={k}>
                  <div className="hub-vital-top">
                    <span className="hub-vital-name"><span className="vital-dot" style={{ background: color }} />{label}</span>
                    <span className="hub-vital-val" id={`hub-val-${k}`}>{typeof cur === 'number' ? Math.round(cur) : '--'}</span>
                  </div>
                  <div className="hub-vital-track"><div className="hub-vital-fill" id={`hub-fill-${k}`} style={{ background: color, width: w }} /></div>
                </div>
              );
            })}
          </div>
          <div className="hub-dino-footer">
            <div className="hub-prime-pill" id="hub-prime-pill"><span className="hub-prime-icon">👑</span><span id="hub-prime-text">{c.prime}</span></div>
            <button type="button" className="hub-link-btn" data-switch-tab="game" onClick={() => goTo('game')}>Xem đầy đủ chỉ số GAS &amp; Prime →</button>
          </div>
        </div>

        <div className="hub-card hub-system-card" id="hub-system-card">
          <div className="hub-sys-section">
            <div className="hub-sys-header">
              <div className="hub-sys-icon icon-voice"><svg {...svg} width="20" height="20"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg></div>
              <div className="hub-sys-title-wrap">
                <h4>ĐÀM THOẠI VOICE 3D (PROXIMITY)</h4>
                <span className="hub-sys-status-badge ok" id="hub-voice-badge">● Sẵn sàng đàm thoại</span>
              </div>
              <button type="button" className="hub-mini-btn" data-switch-tab="voice" onClick={() => goTo('voice')}>Cài đặt</button>
            </div>
            <div className="hub-keybind-row">
              <div className="hub-keybind-item"><span className="hub-keybind-label">Phím nói (PTT):</span><kbd className="hub-kbd" id="hub-key-ptt">V</kbd></div>
              <div className="hub-keybind-item"><span className="hub-keybind-label">Phím cự ly:</span><kbd className="hub-kbd" id="hub-key-range">`</kbd></div>
            </div>
            <div className="hub-sys-tip">Âm thanh 3D sống động theo cự ly vị trí khủng long trong game The Isle.</div>
          </div>

          <div className="hub-sys-divider" />

          <div className="hub-sys-section">
            <div className="hub-sys-header">
              <div className="hub-sys-icon icon-overlay"><svg {...svg} width="20" height="20"><rect width="20" height="15" x="2" y="3" rx="2" /><polyline points="8 21 12 17 16 21" /></svg></div>
              <div className="hub-sys-title-wrap">
                <h4>GAME OVERLAY HUD</h4>
                <span className="hub-sys-status-badge ok" id="hub-overlay-badge">● Kích hoạt</span>
              </div>
              <button type="button" className="hub-mini-btn" data-switch-tab="overlay" onClick={() => goTo('overlay')}>Tuỳ chỉnh</button>
            </div>
            <div className="hub-keybind-row">
              <div className="hub-keybind-item"><span className="hub-keybind-label">Bật / Tắt Overlay:</span><kbd className="hub-kbd">F8</kbd></div>
              <div className="hub-keybind-item"><span className="hub-keybind-label">Chế độ chỉnh HUD:</span><kbd className="hub-kbd">F9</kbd></div>
            </div>
            <div className="hub-sys-tip">Mini map, máu dino &amp; nhiệm vụ hiển thị đè lên màn hình game không làm tụt FPS.</div>
          </div>

          <div className="hub-sys-divider" />

          <div className="hub-sys-bottom">
            <div className="hub-tel-pill">
              <span className="hub-tel-dot" />
              <span id="hub-tel-srv">Server Gateway · <b id="hub-tel-online">--/--</b> online</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="hub-update-btn" id="hub-update-btn" title="Kiểm tra hoặc cập nhật launcher" onClick={() => { if (launcher()?.updateGet) updateAction(); }}>
                <span id="hub-update-icon">⟳</span>
                <span id="hub-update-text">Kiểm tra cập nhật</span>
              </button>
              <button type="button" className="hub-gamemode-toggle" id="hub-gamemode-btn" title="Chế độ tiết kiệm tài nguyên khi vào trận"
                onClick={() => { const l = launcher(); if (l?.gameModeGet) l.gameModeSet?.(!gameMode().now().on); }}>
                <span className="gm-icon">⚡</span>
                <span id="hub-gamemode-text">Game Mode: Tắt</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
