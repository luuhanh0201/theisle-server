import { goTo, type Tab } from '../../app/router';

const svg = { viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Feature({ tab, title, text, children }: { tab: Tab; title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="feature-card" style={{ cursor: 'pointer' }} data-switch-tab={tab} onClick={() => goTo(tab)}>
      <div className="feature-icon"><svg {...svg}>{children}</svg></div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

/** The four main pages, a card each. */
export function Features() {
  return (
    <div className="grid-4" style={{ marginBottom: 24 }}>
      <Feature tab="game" title="Theo dõi Dino HUD" text="Xem chỉ số sinh tồn GAS realtime: Máu, Thể lực, Dạ dày, Nước và Oxy cập nhật mỗi giây."><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></Feature>
      <Feature tab="gara" title="Gara Khủng Long" text="Lưu giữ dino của bạn an toàn bằng lệnh chat trong game. Khôi phục đúng loài, đúng vị trí."><path d="m22 8.35-10-5.35-10 5.35v10.65l10 5.35 10-5.35z" /><path d="M12 22V12" /></Feature>
      <Feature tab="map" title="Bản Đồ Gateway Live" text="Bản đồ Gateway chi tiết với vệt di chuyển 15 phút, tọa độ chính xác và các khu vực di cư."><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" /></Feature>
      <Feature tab="skin" title="Skin Studio & Phối Màu" text="Tùy biến 10 phân vùng màu sắc theo sở thích, xuất mã màu áp dụng thẳng vào game.">
        <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
      </Feature>
    </div>
  );
}

/** Cẩm Nang Sinh Tồn & Quy Định Máy Chủ (the menu's Luật & Dinh Dưỡng scrolls here). */
export function Rules() {
  return (
    <div className="card" id="server-rules-section">
      <div className="card-header">
        <div>
          <h3 className="card-title">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
            Cẩm Nang Sinh Tồn &amp; Quy Định Máy Chủ
          </h3>
          <span className="card-subtitle">Quy tắc sinh tồn cốt lõi, bảng 4 tiếng gầm và hướng dẫn tối ưu dinh dưỡng</span>
        </div>
      </div>
      <div className="guide-grid">
        <div className="guide-card">
          <h4>🛡️ Luật Sinh Tồn Bắt Buộc</h4>
          <ul>
            <li><b>Chống Mix-Pack:</b> Không liên minh giữa các loài ăn thịt khác nhau để săn mồi. Khủng long ăn cỏ có thể chia sẻ bãi ăn nhưng không bảo kê ăn thịt.</li>
            <li><b>Chống Combat Log:</b> Tuyệt đối không thoát game hoặc tự sát trong giao tranh và trong 5 phút sau khi chịu đòn.</li>
            <li><b>Quy tắc Xác Thối (Body Down):</b> Sau khi hạ gục con mồi, kẻ đi săn phải ở lại ăn xác, không được tiếp tục truy sát đàn.</li>
          </ul>
        </div>
        <div className="guide-card">
          <h4>🗣️ Giải Mã 4 Tiếng Gầm (Calls)</h4>
          <ul>
            <li><b>1-Call (Phím 1):</b> Tiếng gầm thân thiện / Chào hỏi / Xác nhận đồng loại trong bầy.</li>
            <li><b>2-Call (Phím 2):</b> Tiếng đe dọa / Tuyên bố chủ quyền lãnh thổ / Cảnh cáo kẻ thù lùi lại.</li>
            <li><b>3-Call (Phím 3):</b> Tiếng kêu đầu hàng / Cầu xin tha mạng / Nhường nhịn lãnh địa.</li>
            <li><b>4-Call (Phím 4):</b> Tiếng hú báo động nguy hiểm / Báo hiệu có kẻ săn mồi đang rình rập.</li>
          </ul>
        </div>
        <div className="guide-card">
          <h4>🧬 Tam Giác Dinh Dưỡng (+100% Lớn)</h4>
          <ul>
            <li><b>Protein (Hexagon S):</b> Hồi máu nhanh hơn, tăng cường lực cắn cơ bắp (+33% tốc độ lớn).</li>
            <li><b>Carbohydrates (Song song):</b> Tăng tốc độ hồi phục thể lực Stamina (+33% tốc độ lớn).</li>
            <li><b>Lipids (3 Chấm tròn):</b> Giảm tốc độ tiêu hóa thức ăn và tăng khả năng kháng độc (+33% tốc độ lớn).</li>
            <li><b>Đủ 3 Dưỡng Chất:</b> Đạt mốc +100% Tăng trưởng giúp nhân vật lớn nhanh gấp đôi bình thường!</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
