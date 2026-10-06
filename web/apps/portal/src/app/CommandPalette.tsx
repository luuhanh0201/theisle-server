import { useEffect, useRef, useState } from 'react';
import { goTo } from './router';
import { copyText, useToast } from './toast';

/** One entry of the palette: a page, a quick action, a chat command to copy, a place on the map (app.js PALETTE_DATA). */
interface Item { id: string; cat: 'pages' | 'species' | 'commands' | 'locations'; catName: string; title: string; desc: string; badge: string; run: Act }
type Act = { go: Parameters<typeof goTo>[0]; toast?: string } | { copy: string } | { href: string; toast: string } | { tour: true };

const page = (id: string, title: string, desc: string, tab: Parameters<typeof goTo>[0]): Item => ({ id: `page-${id}`, cat: 'pages', catName: 'Chuyển trang nhanh', title, desc, badge: 'Trang', run: { go: tab } });
const species = (id: string, title: string, desc: string, badge: string, sp: string, name = sp): Item => ({
  id: `dino-${id}`, cat: 'species', catName: 'Loài Khủng Long', title, desc, badge, run: { go: 'skin', toast: `Đã chọn loài ${name} trong Skin Studio` },
});
const cmd = (c: string, desc: string): Item => ({ id: `cmd-${c}`, cat: 'commands', catName: 'Lệnh Chat In-Game (1-Click Copy)', title: `!${c}`, desc, badge: 'Lệnh chat', run: { copy: `!${c}` } });
const loc = (id: string, title: string, desc: string, toast: string): Item => ({ id: `loc-${id}`, cat: 'locations', catName: 'Địa Danh Bản Đồ Gateway', title, desc, badge: 'Địa danh', run: { go: 'map', toast: `Đang xem bản đồ Gateway: ${toast}` } });

export const PALETTE: Item[] = [
  // 1. Chuyển trang & Hành động nhanh
  { id: 'action-join-direct', cat: 'pages', catName: 'Hành động nhanh', title: 'Bắt Đầu Chuyến Sinh Tồn (Steam Direct)', desc: 'Tự động mở The Isle Evrima và kết nối thẳng vào máy chủ Xóm Gáy', badge: 'Chơi ngay', run: { href: 'steam://connect/play.xomgay.online:7777', toast: 'Đang kết nối vào game qua Steam...' } },
  page('home', 'Trang chủ', 'Bảng tin máy chủ Xóm Gáy, thông số và hướng dẫn', 'home'),
  page('game', 'Dino Live Monitor (Game HUD)', 'Theo dõi sinh tồn GAS realtime: Máu, đói, khát, Prime Elder', 'game'),
  page('map', 'Bản đồ Gateway Live', 'Bản đồ vệ tinh thời gian thực, waypoint và radar định vị', 'map'),
  page('gara', 'Gara Khủng Long', 'Kho lưu trữ an toàn, cất và lấy dino chơi', 'gara'),
  page('ranking', 'Bảng Xếp Hạng & Chiến Tích', 'Top hạ gục, kỷ lục sống lâu, lịch sử sinh tồn', 'ranking'),
  page('skin', 'Skin Studio', 'Phối màu 10 phân vùng khủng long, xuất mã màu ingame', 'skin'),
  page('voice', 'Voice 3D', 'Đàm thoại định hướng 3D theo khoảng cách trong game', 'voice'),
  { id: 'action-tour', cat: 'pages', catName: 'Hành động nhanh', title: 'Tour Hướng Dẫn Tính Năng & Bản Đồ AI', desc: 'Bắt đầu chuyến tham quan các tính năng Gara, Bản đồ AI trực tiếp, Voice 3D và Overlay', badge: 'Tour', run: { tour: true } },
  page('overlay', 'Game Overlay HUD', 'Cấu hình khung đè mini map, vitals lên màn hình', 'overlay'),
  // 2. Tra cứu loài khủng long
  species('carno', 'Carnotaurus (Carno)', 'Ăn thịt · Tốc độ phi nước đại cực nhanh, cú húc sừng tàn khốc', 'Ăn thịt', 'Carnotaurus'),
  species('cera', 'Ceratosaurus (Cera)', 'Ăn thịt · Ăn xác thối kháng bệnh, cú cắn khóa xương', 'Ăn thịt', 'Ceratosaurus'),
  species('trex', 'Tyrannosaurus Rex (T-Rex)', 'Ăn thịt · Đỉnh chuỗi thức ăn kỷ Jura, lực cắn nghiền nát con mồi', 'Ăn thịt', 'Tyrannosaurus', 'T-Rex'),
  species('deino', 'Deinosuchus (Cá sấu Deino)', 'Ăn thịt · Thủy quái đầm lầy phục kích, cú đớp tử thần lôi xuống nước', 'Thủy quái', 'Deinosuchus'),
  species('stego', 'Stegosaurus (Stego)', 'Ăn cỏ · Giáp gai kiên cố, đuôi chùy gai quất chết kẻ săn mồi', 'Ăn cỏ', 'Stegosaurus'),
  species('galli', 'Gallimimus (Galli)', 'Ăn tạp · Nhanh nhất trên thảo nguyên, trốn thoát kẻ thù siêu hạng', 'Ăn tạp', 'Gallimimus'),
  species('dilo', 'Dilophosaurus (Dilo)', 'Ăn thịt · Sát thủ bóng đêm, tiêm chất độc gây ảo giác con mồi', 'Ăn thịt', 'Dilophosaurus'),
  species('pachy', 'Pachycephalosaurus (Pachy)', 'Ăn cỏ · Hộp sọ vòm thép, cú húc đầu gây gãy xương choáng váng', 'Ăn cỏ', 'Pachycephalosaurus', 'Pachy'),
  species('troodon', 'Troodon', 'Ăn thịt · Thợ săn bầy đàn ban đêm, độc tố tích tụ gây tê liệt', 'Ăn thịt', 'Troodon'),
  species('herrera', 'Herrerasaurus (Herrera)', 'Ăn thịt · Leo trèo thân cây, phục kích bổ nhào từ ngọn cao', 'Ăn thịt', 'Herrerasaurus'),
  species('beipi', 'Beipiaosaurus (Beipi)', 'Ăn tạp · Bơi lội siêu đẳng dưới sông suối, săn cá và trốn thoát', 'Ăn tạp', 'Beipiaosaurus'),
  species('tenonto', 'Tenontosaurus (Tenonto)', 'Ăn cỏ · Cú đá hậu bẻ gãy hàm kẻ săn mồi và quật ngã bằng đuôi', 'Ăn cỏ', 'Tenontosaurus'),
  species('hypsi', 'Hypsilophodon (Hypsi)', 'Ăn cỏ · Kích thước nhỏ, nhảy cao và phun dịch axit làm mù', 'Ăn cỏ', 'Hypsilophodon'),
  // 3. Tra cứu & Sao chép lệnh chat ingame
  cmd('unstuck', 'Cứu hộ kẹt địa hình - Dịch chuyển về mặt đất an toàn khi dính khe đá'),
  cmd('slay', 'Tự giải thoát - Tự sát an toàn để quay lại sảnh chọn loài mới'),
  cmd('status', 'Kiểm tra chỉ số - In thông số máu, đói, khát và tọa độ GPS vào chat'),
  cmd('prime', 'Nhiệm vụ Prime - Xem số điều kiện Prime Elder đã đạt trong đời sống'),
  cmd('gara', 'Gara Khủng Long - Mở lệnh cất hoặc khôi phục dino trong game'),
  cmd('grow', 'Tăng trưởng - Kiểm tra tỷ lệ tăng trưởng và phần trăm dinh dưỡng'),
  cmd('coords', 'Tọa độ GPS - Hiển thị vị trí X, Y, Z hiện tại của dino'),
  cmd('pack', 'Quản lý bầy đàn - Xem danh sách thành viên hoặc tạo lời mời vào đàn'),
  cmd('skin', 'Áp dụng skin - Nhập chuỗi mã màu đã phối từ Skin Studio vào nhân vật'),
  cmd('rules', 'Luật máy chủ - Xem tóm tắt quy định chống mix-pack, combat-log ingame'),
  // 4. Địa danh bản đồ Gateway
  loc('highlands', 'Hồ Highlands (Highlands Lake)', 'Điểm nóng săn mồi và nguồn nước ngọt trung tâm hòn đảo Gateway', 'Khu vực Hồ Highlands'),
  loc('sanctuary', 'Vòm Sanctuary (Vùng An Toàn)', 'Vùng bảo hộ ong bướm, an toàn cho khủng long non (Juvi) lớn lên', 'Vòm Bảo Hộ Sanctuary'),
  loc('swamp', 'Đầm Lầy North Swamp', 'Vùng đầm lầy nước đục hiểm trở, lãnh địa rình mồi của Deinosuchus', 'Đầm Lầy North Swamp'),
  loc('salt', 'Bãi Muối Liếm (Salt Lick)', 'Khoáng chất thiết yếu cho khủng long ăn cỏ hồi phục thể lực', 'Bãi Muối Liếm'),
  loc('salmon', 'Suối Cá Hồi (Salmon Stream)', 'Nguồn thức ăn dồi dào cho các loài bơi lội Beipi và bay Ptera', 'Suối Cá Hồi'),
  loc('dam', 'Đập Nước Lớn (Water Dam)', 'Công trình thủy điện trung tâm nối các bờ vực sâu', 'Đập Nước Lớn'),
  loc('plains', 'Đồng Cỏ South Plains', 'Thảo nguyên mênh mông, bầy đàn ăn cỏ tụ tập kiếm ăn', 'Đồng Cỏ South Plains'),
];
const CATS = ['pages', 'species', 'commands', 'locations'] as const;

/** The palette's entries for a search (title, text or group), grouped as shown. */
export function paletteResults(query: string): Item[] {
  const q = query.trim().toLowerCase();
  const found = PALETTE.filter((i) => !q || i.title.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q) || i.catName.toLowerCase().includes(q));
  return CATS.flatMap((c) => found.filter((i) => i.cat === c));
}

const ICON: Record<Item['cat'], React.ReactNode> = {
  pages: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>,
  species: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>,
  commands: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5" /><line x1="12" x2="20" y1="19" y2="19" /></svg>,
  locations: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" /></svg>,
};

/** The command palette (Ctrl+K / ⌘K; Esc closes): pages, quick actions, species, chat commands to copy, places. */
export function CommandPalette({ onTour }: { onTour: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActiveState] = useState(0);
  // The active entry now, for Enter right after an arrow (before the list is drawn again), as app.js read it from the list.
  const activeNow = useRef(0);
  const setActive = (v: number | ((i: number) => number)): void => {
    activeNow.current = typeof v === 'function' ? v(activeNow.current) : v;
    setActiveState(activeNow.current);
  };
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const results = paletteResults(query);
  const openNow = useRef(open);
  openNow.current = open;

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (openNow.current) { setOpen(false); return; }
        setQuery('');
        setActive(0);
        setOpen(true);
        setTimeout(() => input.current?.focus(), 40);
      } else if (e.key === 'Escape' && openNow.current) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  // The first of the new results is the active one, as before React.
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { list.current?.querySelectorAll('.cmd-item')[active]?.scrollIntoView?.({ block: 'nearest' }); }, [active]);

  const run = (item: Item): void => {
    setOpen(false);
    const a = item.run;
    if ('tour' in a) onTour();
    else if ('copy' in a) void copyText(a.copy, toast);
    else if ('href' in a) { window.location.href = a.href; toast(a.toast); }
    else { goTo(a.go); if (a.toast) toast(a.toast); }
  };

  let n = 0;
  return (
    <div className="cmd-palette-backdrop" id="cmd-palette-modal" hidden={!open} onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="cmd-palette-box">
        <div className="cmd-palette-header">
          <svg className="cmd-search-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <input type="text" className="cmd-search-input" id="cmd-search-input" ref={input} placeholder="Tìm trang, loài khủng long, lệnh chat, địa danh Gateway…" autoComplete="off" spellCheck={false}
            value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (results.length === 0) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i < results.length - 1 ? i + 1 : 0)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i > 0 ? i - 1 : results.length - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); const it = results[activeNow.current]; if (it) run(it); }
            }} />
          <button type="button" className="cmd-close-btn" id="cmd-close-btn" onClick={() => setOpen(false)}>ESC</button>
        </div>
        <div className="cmd-palette-body" id="cmd-results-list" ref={list}>
          {results.length === 0
            ? <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
              <div>Không tìm thấy kết quả phù hợp với "<b>{query.trim().toLowerCase()}</b>"</div>
            </div>
            : CATS.map((c) => {
              const group = results.filter((i) => i.cat === c);
              if (group.length === 0) return null;
              return [
                <div key={`h-${c}`} className="cmd-group-label">{group[0]?.catName}</div>,
                ...group.map((item) => {
                  const idx = n++;
                  return (
                    <div key={item.id} className={`cmd-item${idx === active ? ' active' : ''}`} data-cmd-id={item.id} onClick={() => run(item)} onMouseEnter={() => setActive(idx)}>
                      <div className="cmd-item-left">
                        <div className="cmd-item-icon">{ICON[c]}</div>
                        <div style={{ minWidth: 0 }}>
                          <div className="cmd-item-title">{item.title}</div>
                          <div className="cmd-item-desc">{item.desc}</div>
                        </div>
                      </div>
                      <span className="cmd-item-badge">{item.badge}</span>
                    </div>
                  );
                }),
              ];
            })}
        </div>
        <div className="cmd-palette-footer">
          <span className="cmd-hint"><kbd>↑</kbd><kbd>↓</kbd> để duyệt</span>
          <span className="cmd-hint"><kbd>Enter</kbd> kích hoạt</span>
          <span className="cmd-hint"><kbd>ESC</kbd> đóng</span>
        </div>
      </div>
    </div>
  );
}
