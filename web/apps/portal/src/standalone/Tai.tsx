import { useEffect, useState } from 'react';

/** /tai/version.json (scripts/release-launcher.sh): the latest launcher, its file and size per system. */
export interface LauncherRelease { version: string; date?: string; windows?: { file?: string; size?: number }; linux?: { file?: string; size?: number } }

/** The visitor's system, for "Máy của bạn" (as tai.js). */
export function mineOf(ua: string): 'win' | 'linux' | null {
  return /Windows/i.test(ua) ? 'win' : /Linux|X11/i.test(ua) && !/Android/i.test(ua) ? 'linux' : null;
}
const mb = (n: number): string => `${Math.round(n / 1048576)} MB`;

function DownloadBtn({ os, file }: { os: 'win' | 'linux'; file: { file?: string; size?: number } | undefined }) {
  if (!file?.file) return <a className="btn off" id={`btn-${os}`} href="#">Chưa có bản tải</a>;
  return (
    <a className="btn" id={`btn-${os}`} href={`/tai/${encodeURIComponent(file.file)}`}
      // Counted for the panel's "Truy cập" (the installers themselves are cached by the proxy, never seen).
      onClick={() => { navigator.sendBeacon?.('/api/track/download', JSON.stringify({ os })); }}>
      {`Tải cho ${os === 'win' ? 'Windows' : 'Linux'}${file.size ? ` (${mb(file.size)})` : ''}`}
    </a>
  );
}

/**
 * tai.html in React: the launcher downloads, from /tai/version.json. Web only (AGENTS.md "Launcher"): inside the
 * launcher main.tsx sends it home before this is drawn. The copy button works now (before React its inline script
 * was refused by the portal's CSP, so it did nothing).
 */
export function Tai() {
  const [v, setV] = useState<LauncherRelease | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; show: boolean }>>([]);
  const mine = mineOf(navigator.userAgent);
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/tai/version.json', { cache: 'no-cache' });
        if (r.ok) setV(await r.json() as LauncherRelease);
      } catch { /* nothing to download yet */ }
    })();
  }, []);
  const version = v ? `Phiên bản ${v.version}${v.date ? ` · ${new Date(v.date).toLocaleDateString('vi-VN')}` : ''}` : '\u00a0';
  const copy = (text: string): void => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, show: true }]);
    setTimeout(() => {
      setToasts((t) => t.map((x) => (x.id === id ? { ...x, show: false } : x)));
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 250);
    }, 2200);
  };
  return (
    <>
      <div className="wrap">
        {/* Top Navigation Bar */}
        <header className="top-nav">
          <a className="nav-back" href="/">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>Quay lại Cổng Người Chơi</span>
          </a>
          <div className="nav-brand-badge">
            <span className="nav-dot"></span>
            <span>The Isle Evrima · Xóm Gáy Official Client</span>
          </div>
        </header>

        {/* Hero Header */}
        <section className="hero">
          <div className="hero-logo-box">
            <img src="/img/logo-96.webp" alt="Logo Xóm Gáy Launcher" width="96" height="96" />
          </div>
          <div>
            <span className="hero-badge-pill">🚀 ỨNG DỤNG MÁY TÍNH CHÍNH THỨC</span>
            <h1>Xóm Gáy Launcher</h1>
            <p>Trọn vẹn tính năng Cổng Người Chơi trong một ứng dụng: Tích hợp <b>Voice 3D cự ly</b>, <b>Overlay HUD</b> đè màn hình và tự động kết nối game.</p>
            <div><span id="version">{version}</span></div>
          </div>
        </section>

        {/* Platform Download Grid */}
        <section className="grid">
          {/* Windows Card */}
          <div className={`dl${mine === 'win' ? ' mine' : ''}`} id="dl-win">
            <div className="dl-header">
              <div className="dl-title-wrap">
                <div className="dl-platform-icon">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.901-1.8"/>
                  </svg>
                </div>
                <div>
                  <h2>Windows</h2>
                  <div className="meta" id="meta-win">Windows 10 / 11, 64-bit</div>
                </div>
              </div>
              <span className="tag" id="tag-win" hidden={mine !== 'win'}>Máy của bạn</span>
            </div>

            <ul className="dl-features">
              <li>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Tự động cập nhật phiên bản mới nhất</span>
              </li>
              <li>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Voice phím V hoặc nút chuột khi chơi</span>
              </li>
              <li>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Overlay mini-map F8/F9 đè trong suốt</span>
              </li>
            </ul>

            <DownloadBtn os="win" file={v?.windows} />
          </div>

          {/* Linux Card */}
          <div className={`dl${mine === 'linux' ? ' mine' : ''}`} id="dl-linux">
            <div className="dl-header">
              <div className="dl-title-wrap">
                <div className="dl-platform-icon">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 17 10 11 4 5"></polyline>
                    <line x1="12" y1="19" x2="20" y2="19"></line>
                  </svg>
                </div>
                <div>
                  <h2>Linux &amp; Steam Deck</h2>
                  <div className="meta" id="meta-linux">AppImage, 64-bit (Steam Deck, Ubuntu, Arch…)</div>
                </div>
              </div>
              <span className="tag" id="tag-linux" hidden={mine !== 'linux'}>Máy của bạn</span>
            </div>

            <ul className="dl-features">
              <li>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Chạy độc lập dạng AppImage không cần cài</span>
              </li>
              <li>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Tương thích hoàn hảo SteamOS / Proton</span>
              </li>
              <li>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Tự đồng bộ cấu hình và voice mic</span>
              </li>
            </ul>

            <DownloadBtn os="linux" file={v?.linux} />
          </div>
        </section>

        {/* Feature Highlights Grid */}
        <section className="feature-grid">
          <div className="card">
            <h3>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
              <span>Voice 3D Không Cần Discord</span>
            </h3>
            <p>Giữ phím nói (mặc định phím <b>V</b> hoặc gán nút chuột). Âm thanh định hướng 3D theo cự ly <b>15m / 30m / 60m / 90m</b>, hoạt động trơn tru ngay cả khi đang trong trận.</p>
          </div>

          <div className="card">
            <h3>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
              <span>Overlay Ingame HUD (F8 / F9)</span>
            </h3>
            <p>Bản đồ vệ tinh mini và bảng chỉ số sinh tồn đè trong suốt lên màn hình game. Chuột bấm xuyên qua tự nhiên, không mất focus phím và an toàn 100% với Anti-Cheat.</p>
          </div>

          <div className="card">
            <h3>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h10"/><path d="M7 12h10"/><path d="M7 17h10"/></svg>
              <span>Gara Khủng Long &amp; Nhiệm Vụ Prime</span>
            </h3>
            <p>Đồng bộ tức thời toàn bộ kho Dino, cất lấy slot an toàn chống nhân bản, kiểm tra checklist điều kiện tiến hóa Prime Elder mà không cần thoát ra trình duyệt ngoài.</p>
          </div>

          <div className="card">
            <h3>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              <span>Tự Động Kết Nối &amp; Siêu Nhẹ</span>
            </h3>
            <p>1-Click mở The Isle Evrima và kết nối thẳng vào server Gateway. Thu nhỏ gọn gàng xuống khay hệ thống (Tray), chiếm dụng RAM cực thấp và voice vẫn chạy ổn định.</p>
          </div>
        </section>

        {/* Installation Guide & First-time Setup */}
        <section className="guide-grid">
          <div className="card guide-win">
            <h3>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span>Khi Cài Đặt Trên Windows (SmartScreen)</span>
            </h3>
            <ul className="guide-list">
              <li>Do launcher là phần mềm nội bộ cộng đồng chưa mua chữ ký số đắt đỏ của Microsoft, Windows Defender có thể hiện thông báo <b>"Windows protected your PC"</b>.</li>
              <li>Bấm <b>More info</b> (Thông tin thêm) → chọn <b>Run anyway</b> (Vẫn chạy).</li>
              <li>Nếu game chạy bằng quyền Admin, hãy chạy cả launcher bằng quyền Admin để phím tắt F8/F9 và phím nói nhận bình thường.</li>
            </ul>
          </div>

          <div className="card guide-linux">
            <h3>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
              <span>Khi Chạy Trên Linux &amp; Steam Deck</span>
            </h3>
            <ul className="guide-list">
              <li>Sau khi tải file <code>.AppImage</code> về máy, cấp quyền thực thi cho file:</li>
            </ul>
            <div className="code-block">
              <code>chmod +x XomGay-Launcher*.AppImage</code>
              <button type="button" className="btn-copy-mini" data-copy="chmod +x XomGay-Launcher*.AppImage" onClick={() => copy('chmod +x XomGay-Launcher*.AppImage')}>Sao chép</button>
            </div>
            <ul className="guide-list" style={{ marginTop: '8px' }}>
              <li>Hoặc chuột phải vào file → <b>Properties</b> → <b>Permissions</b> → tích chọn <b>"Allow executing file as program"</b> rồi mở bình thường.</li>
            </ul>
          </div>
        </section>

        {/* Safety Banner */}
        <footer className="safety-banner">
          <div className="safety-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <div>
            <b>Cam kết an toàn tuyệt đối với Easy Anti-Cheat:</b> Xóm Gáy Launcher là phần mềm mã nguồn mở nội bộ, chạy hoàn toàn độc lập và không can thiệp bộ nhớ hay file nhị phân của The Isle Evrima.
          </div>
        </footer>
      </div>
      <div id="toast-container" className="toast-container">
        {toasts.map((t) => <div key={t.id} className={`toast${t.show ? ' show' : ''}`}>✓ Đã sao chép lệnh vào bộ nhớ tạm!</div>)}
      </div>
    </>
  );
}
