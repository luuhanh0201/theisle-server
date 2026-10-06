import type { PlayerMe } from '@isle/api';

/** "1g 5p" / "4p 12s", a length of time (app.js dur). */
export function dur(sec: number | null | undefined): string {
  const s = Math.max(0, Math.round(sec ?? 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}g ${m}p` : `${m}p ${s % 60}s`;
}

/** Thống Kê Người Chơi: what the server counted for them (the players' boards' counting). */
export function Stats({ me }: { me: PlayerMe | null | undefined }) {
  const s = me?.stats;
  const tiles: ReadonlyArray<readonly [string, string | number]> = s ? [
    ['⚔️ Số Mạng Hạ Gục (Kills)', s.kills], ['💀 Số Lần Tử Vong (Deaths)', s.deaths], ['🥚 Số Lần Sinh Ra (Spawns)', s.spawns],
    ['⏱️ Tổng Giờ Chơi', dur(s.playtime)], ['👑 Đời Sống Lâu Nhất', dur(s.longestLife)], ['🎮 Số Phiên Chơi', s.sessions],
  ] : [];
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="card-title">📊 Thống Kê Người Chơi</h3>
          <span className="card-subtitle">Tổng thành tích ghi nhận trên server</span>
        </div>
      </div>
      <div className="grid-3" id="game-stats-grid">
        {tiles.map(([title, val]) => (
          <div key={title} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', textAlign: 'center' }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{title}</div>
            <b style={{ fontSize: 20, letterSpacing: '-0.01em' }}>{val}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
