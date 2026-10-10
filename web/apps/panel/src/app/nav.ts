/**
 * The panel's pages: one block per job, sub-pages at #<block>/<sub> (the same addresses as the
 * panel before React, so bookmarks and links keep working), and the permission each one needs
 * (bridge/src/permissions.ts; '*' = the super admin only).
 */
export const TABS = [
  ['overview', 'Tổng quan'], ['players', 'Người chơi'], ['map', 'Bản đồ'], ['world', 'Thế giới'],
  ['garage', 'Gara'], ['items', 'Vật phẩm'], ['quests', 'Nhiệm vụ'], ['mods', 'Tính năng mod'], ['server', 'Server'],
  ['members', 'Thành viên'], ['traffic', 'Truy cập'], ['admin', 'Quản trị'],
] as const;
export type TabId = (typeof TABS)[number][0];

/** Each block's heading and the line under it (the same as the panel before React). */
export const HEADS: Record<TabId, readonly [string, string]> = {
  overview: ['Tổng quan', 'Tình trạng server, hiệu năng và mọi diễn biến, cập nhật mỗi 2 giây.'],
  players: ['Người chơi', 'Ai đang chơi, ai giết ai, bảng xếp hạng và chat trong game.'],
  map: ['Bản đồ trực tiếp', 'Gateway: người chơi đang online, vệt di chuyển gần nhất, vùng di cư, tuần tra, sanctuary, nước, hang và nguồn thức ăn.'],
  world: ['Thế giới', 'AI, di cư, ngày đêm, thực vật và cá trên đảo, tóm tắt, và nơi chỉnh từng thứ.'],
  garage: ['Gara', 'Quản lý dino người chơi đang cất, tạo dino vào gara theo yêu cầu và cấu hình quy tắc hệ thống Gara.'],
  items: ['Vật phẩm', 'Vật phẩm của server: admin tạo, đặt tên, tặng vào kho của người chơi (skin, mutation, phiếu và hộp), người chơi dùng từ Túi đồ.'],
  quests: ['Nhiệm vụ', 'Hổ phách, tiền của server, kiếm bằng cách chơi (không bán bằng tiền thật), và điểm danh hằng ngày (giờ Việt Nam).'],
  mods: ['Tính năng mod', 'Những gì các mod của server thêm cho người chơi: lệnh chat, Ptera gắp, tele con non, voice gần, nội dung mọi thông báo, và tin cập nhật ở Trang chủ launcher.'],
  server: ['Server', 'Bật, tắt, khởi động lại, thiết lập và cấu hình game server.'],
  members: ['Thành viên', 'Ai là admin, quyền của từng admin, whitelist, VIP và SVip.'],
  traffic: ['Truy cập', 'Lượt mở web, tải và dùng launcher, đăng nhập (giờ server). Không lưu IP: người xem là mã băm theo ngày.'],
  admin: ['Quản trị', 'Ai được vào panel, nhật ký mọi thao tác của admin, và log gửi lên Discord.'],
};

export const SUBS: Partial<Record<TabId, ReadonlyArray<readonly [string, string]>>> = {
  players: [['list', 'Danh sách'], ['killfeed', 'Killfeed'], ['damage', 'Sát thương'], ['leaderboard', 'Xếp hạng'], ['chat', 'Chat'], ['bans', 'Ban'], ['prison', 'Nhà tù']],
  world: [['overview', 'Tổng quan'], ['flora', 'Thực vật'], ['fish', 'Cá']],
  garage: [['stored', 'Dino & tạo dino'], ['settings', 'Cài đặt gara']],
  items: [['skins', 'Skin dino'], ['mutations', 'Mutation'], ['tickets', 'Phiếu & hộp']],
  mods: [['commands', 'Lệnh chat'], ['ptera', 'Ptera gắp'], ['tele', 'Tele con non'], ['voice', 'Voice gần'], ['messages', 'Thông báo'], ['news', 'Tin cập nhật']],
  server: [['ops', 'Vận hành'], ['cfg', 'Cấu hình game'], ['caps', 'Giới hạn loài'], ['data', 'Dữ liệu']],
  admin: [['access', 'Truy cập panel'], ['audit', 'Nhật ký admin'], ['discord', 'Discord']],
  members: [['admins', 'Admin'], ['perms', 'Phân quyền'], ['whitelist', 'Whitelist'], ['vips', 'VIP'], ['svip', 'SVip']],
};

const TAB_NEED: Partial<Record<TabId, string>> = { overview: 'players.view', map: 'map.view', traffic: 'traffic.view', quests: 'economy.view' };
const SUB_NEED: Partial<Record<TabId, Record<string, string>>> = {
  players: { list: 'players.view', killfeed: 'players.view', damage: 'players.view', leaderboard: 'players.view', chat: 'players.view', bans: 'bans.view', prison: 'prison.view' },
  world: { overview: 'world.view', flora: 'world.view', fish: 'world.view' },
  garage: { stored: 'garage.view', settings: 'garage.view' },
  items: { skins: 'items.view', mutations: 'items.view', tickets: 'items.view' },
  mods: { commands: 'mods.view', ptera: 'mods.view', tele: 'mods.view', voice: 'mods.view', messages: 'mods.view', news: 'mods.view' },
  server: { ops: 'server.view', cfg: 'config.view', caps: 'config.view', data: 'backups.view' },
  admin: { access: 'access.edit', audit: 'audit.view', discord: 'discord.view' },
  members: { admins: 'config.view', perms: '*', whitelist: 'config.view', vips: 'config.view', svip: 'svip.edit' },
};

/** Where the pages of an older layout went (the panel before React keeps the same list). */
export const MOVED: Record<string, string> = {
  killfeed: 'players/killfeed', leaderboard: 'players/leaderboard', chat: 'players/chat', messages: 'mods/messages',
  'server/perf': 'overview', 'server/audit': 'admin/audit', 'server/panel-access': 'admin/access',
  'admin/perms': 'members/perms', 'admin/svip': 'members/svip',
  'server/garage-settings': 'garage/settings', 'server/commands-settings': 'mods/commands', 'server/ptera-carry': 'mods/ptera',
  'server/voice-settings': 'mods/voice', 'server/flora-settings': 'world/flora', 'server/fish-settings': 'world/fish',
};

/** What an admin may do: from /api/me (null perms = not known yet: nothing hidden, the bridge refuses anyway). */
export interface Access { perms: ReadonlySet<string> | null; super: boolean }
export const can = (a: Access, key: string): boolean => a.super || a.perms === null || a.perms.has(key);

export function subAllowed(a: Access, tab: TabId, sub: string): boolean {
  const need = SUB_NEED[tab]?.[sub];
  if (need === undefined) return true;
  // Not known yet (/api/me pending): nothing hidden, as `can` (the bridge refuses anyway).
  return need === '*' ? a.super || a.perms === null : can(a, need);
}

export function tabAllowed(a: Access, tab: TabId): boolean {
  const need = TAB_NEED[tab];
  if (need !== undefined) return can(a, need);
  const subs = SUBS[tab];
  if (subs !== undefined) return subs.some(([id]) => subAllowed(a, tab, id));
  return true;
}

export const isTab = (v: string): v is TabId => TABS.some(([id]) => id === v);
