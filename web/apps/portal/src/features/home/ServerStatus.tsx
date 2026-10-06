import { useServer } from '../../lib/queries';

/** Up or restarting, players online / slots (app.js renderServer); the telemetry strip as it was. */
export function ServerStatus() {
  const srv = useServer();
  const up = srv?.phase === 'running';
  const online = srv?.online ?? 0;
  const max = srv?.maxPlayers ?? 100;
  const status = srv === undefined ? 'Đang kiểm tra server…' : srv === null ? 'Server đang tắt hoặc mất kết nối'
    : up ? 'Máy chủ đang hoạt động' : 'Máy chủ đang khởi động lại…';
  const fill = srv ? Math.min(100, Math.round((online / max) * 100)) : 0;
  return (
    <div className="status-bar-card">
      <div className="status-row-top">
        <div className="status-main">
          <div className="status-icon-wrap">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></svg>
          </div>
          <div className="status-texts">
            <h3><span className={`dot${srv && up ? ' up' : ''}`} id="srv-dot" /><span id="srv-status-text">{status}</span></h3>
            <p id="srv-sub-text">Bản đồ Gateway · Unreal Engine 5.6</p>
          </div>
        </div>
        <div className="player-meter-wrap">
          <div className="player-meter-header"><span>Người chơi trực tuyến</span><span id="srv-slots-text" className="tabular-nums">{srv ? `${online} / ${max}` : '0 / 100'}</span></div>
          <div className="meter-bar"><div className="meter-fill" id="srv-meter-fill" style={{ width: `${fill}%` }} /></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div id="hero-auth-btn" hidden />
        </div>
      </div>

      {/* Server telemetry (never the server's IP). */}
      <div className="server-telemetry-strip">
        <div className="tel-item">
          <div><div className="tel-label">ĐỘ TRỄ &amp; TẦNG SỐ</div><div className="tel-val tabular-nums"><span style={{ color: 'var(--emerald-light)' }}>~24ms</span> · 60 TPS</div></div>
          <span className="tag info">Mượt</span>
        </div>
        <div className="tel-item">
          <div><div className="tel-label">THỜI TIẾT GATEWAY</div><div className="tel-val">Nắng Ráo Nhiệt Đới</div></div>
          <span className="tag">Trong lành</span>
        </div>
        <div className="tel-item">
          <div><div className="tel-label">BẢO VỆ MÁY CHỦ</div><div className="tel-val">Easy Anti-Cheat</div></div>
          <span className="tag" style={{ color: 'var(--emerald-light)', background: 'rgba(16,185,129,0.15)' }}>Kích hoạt</span>
        </div>
        <div className="tel-item">
          <div><div className="tel-label">CHẾ ĐỘ MÁY CHỦ</div><div className="tel-val">Evrima Survival 24/7</div></div>
          <span className="tag purple">Chính thức</span>
        </div>
      </div>
    </div>
  );
}
