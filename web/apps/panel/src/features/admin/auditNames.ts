/** What each admin-log action is called on the panel (the same table as the panel before React). */
export const AUDIT_VN: Record<string, string> = {
  'panel login': 'Đăng nhập panel', 'panel logout': 'Đăng xuất panel', 'panel login refused': 'Đăng nhập bị từ chối',
  'game config saved': 'Lưu cấu hình game', 'garage settings saved': 'Lưu cài đặt gara', 'player command settings saved': 'Lưu lệnh người chơi',
  'voice settings saved': 'Lưu cài đặt voice', 'panel allowed IPs saved': 'Lưu IP được vào panel', 'AI zones saved': 'Lưu vùng AI',
  'garage slot created': 'Tạo dino vào gara', 'garage slot deleted': 'Xoá dino khỏi gara', 'kill current dino queued': 'Giết dino đang chơi',
  'restart schedule set': 'Đặt lịch khởi động lại', 'growth event added': 'Thêm sự kiện tốc độ lớn', 'growth event removed': 'Xoá sự kiện tốc độ lớn', 'mutation note set': 'Sửa mô tả mutation', 'mutation note cleared': 'Xoá mô tả mutation',
  'server start requested': 'Bật server', 'server stop requested': 'Tắt server', 'server restart requested': 'Khởi động lại server',
  'life restored to garage': 'Khôi phục dino vào gara',
  'light test': 'Gắn đèn thử nghiệm',
  'player banned': 'Ban người chơi',
  'ban reasons saved': 'Lưu mẫu lý do ban',
  'backup made': 'Tạo bản backup',
  'backup deleted': 'Xoá bản backup',
  'backup restored': 'Khôi phục bản backup',
  'backup settings saved': 'Lưu cài đặt backup',
  'settings exported': 'Xuất cài đặt',
  'server data wiped': 'Xoá trắng dữ liệu server',
  'Discord log saved': 'Lưu cài đặt Discord',
  'Discord slash commands registered': 'Đăng ký lệnh Discord',
  'Discord webhook URL viewed': 'Xem webhook Discord',
  'AI reset': 'Reset AI',
  'AI reset requested': 'Yêu cầu reset AI',
  'AI reset cancelled': 'Huỷ reset AI',
  'corpses wiped (schedule)': 'Dọn xác định kỳ',
  'plant settings saved': 'Lưu cài đặt thực vật',
  'small-dinos-only zones saved': 'Lưu vùng chỉ dino nhỏ',
  'Ptera carry settings saved': 'Lưu cài đặt Ptera gắp',
  'messages saved': 'Lưu thông báo server',
  'DDoS alert settings saved': 'Lưu cài đặt cảnh báo DDoS',
  'prime fix added': 'Thêm sửa lỗi Prime',
  'prime fix updated': 'Cập nhật sửa lỗi Prime',
  'prime fix deleted': 'Xoá sửa lỗi Prime',
  'admin permissions changed': 'Đổi quyền admin',
  'item created': 'Tạo vật phẩm', 'item updated': 'Sửa vật phẩm', 'item granted': 'Tặng vật phẩm', 'item revoked': 'Thu hồi vật phẩm', 'item deleted': 'Xoá vật phẩm', 'mutation used': 'Dùng mutation lên dino',
  'skin applied': 'Áp skin lên dino',
  'admin action heal': 'Admin: hồi máu & chữa trị', 'admin action vitals': 'Admin: chỉnh chỉ số',
  'admin action grow': 'Admin: đặt tăng trưởng', 'admin action teleport': 'Admin: dịch chuyển',
};
// Admin commands used in the game (bridge/src/game-admin-log.ts).
export const GAME_CMD_VN: Record<string, string> = {
  'Bring': 'Kéo người chơi tới', 'Go to': 'Dịch chuyển tới người chơi', 'Heal': 'Hồi đầy máu', 'Grow': 'Đặt growth',
  'SetHunger': 'Đặt đói', 'SetThirst': 'Đặt khát', 'SetStamina': 'Đặt stamina', 'SetHealth': 'Đặt máu', 'SetBlood': 'Đặt huyết',
  'SetNutrientValue': 'Đặt dinh dưỡng', 'SetOxygen': 'Đặt oxy', 'Changed weather': 'Đổi thời tiết',
  'Enter Specmode': 'Vào chế độ quan sát (bay)', 'Leave Specmode': 'Thoát chế độ quan sát',
};
/** An audit action as the panel names it; RCON and in-game commands by their parts. */
export const auditName = (a: string): string => AUDIT_VN[a] ?? (a.startsWith('rcon ') ? `RCON: ${a.slice(5)}`
  : a.startsWith('in-game ') ? `🎮 Trong game: ${GAME_CMD_VN[a.slice(8)] ?? a.slice(8)}` : a);
