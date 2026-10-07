import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';

/**
 * What each panel admin may do (panel → Quản trị → Phân quyền), set by the one
 * super admin (SUPER_ADMIN_STEAM_ID, the only one who sees that page).
 *
 * Every /api route of the panel needs one permission (permissionFor); a route
 * not listed there needs "*": the super admin only (fail closed, a new route
 * is nobody's until it is given a key). An admin's permissions are their
 * role's, plus `allow`, minus `deny`. An admin with no entry keeps everything
 * (the panel as it was before this page), so nobody loses access at once.
 *
 * In game: `ingame: false` keeps the admin out of Game.ini's AdminsSteamIDs
 * (from the next restart, the game reads the list when it starts) while they
 * keep the panel, and the AdminGuard mod clears the game's admin flags on them
 * at once if the game lets it (mods/AdminGuard).
 */

export interface PermDef { key: string; group: string; label: string }

export const PERMS: readonly PermDef[] = [
  { key: 'players.view', group: 'Người chơi', label: 'Xem người chơi, log, killfeed, chat, xếp hạng' },
  { key: 'players.kill', group: 'Người chơi', label: 'Xoá dino của người chơi' },
  { key: 'players.admin', group: 'Người chơi', label: 'Thao tác admin lên dino: hồi máu, chỉ số, tăng trưởng, dịch chuyển' },
  { key: 'bans.view', group: 'Người chơi', label: 'Xem danh sách ban' },
  { key: 'bans.edit', group: 'Người chơi', label: 'Ban / gỡ ban / sửa ban, lý do ban' },
  { key: 'prison.view', group: 'Người chơi', label: 'Xem nhà tù' },
  { key: 'prison.jail', group: 'Người chơi', label: 'Bỏ tù / thả sớm / tăng án' },
  { key: 'prison.settings', group: 'Người chơi', label: 'Cài đặt nhà tù' },
  { key: 'map.view', group: 'Bản đồ & thế giới', label: 'Xem bản đồ live' },
  { key: 'world.view', group: 'Bản đồ & thế giới', label: 'Xem cài đặt AI, cá, thực vật' },
  { key: 'world.edit', group: 'Bản đồ & thế giới', label: 'Sửa vùng AI, nhà tù trên bản đồ, AI, cá, thực vật, vùng cấm' },
  { key: 'garage.view', group: 'Gara', label: 'Xem gara, prime, chỉ số loài' },
  { key: 'garage.edit', group: 'Gara', label: 'Tạo / xoá / khôi phục dino trong gara, sửa prime, mô tả mutation' },
  { key: 'garage.settings', group: 'Gara', label: 'Cài đặt gara' },
  { key: 'mods.view', group: 'Tính năng mod', label: 'Xem lệnh chat, Ptera, tele con non, voice, thông báo, tin cập nhật' },
  { key: 'mods.edit', group: 'Tính năng mod', label: 'Sửa lệnh chat, Ptera, tele con non, voice, thông báo, tin cập nhật' },
  { key: 'server.view', group: 'Server', label: 'Xem tình trạng, hiệu năng, lịch, DDoS' },
  { key: 'traffic.view', group: 'Server', label: 'Xem thống kê truy cập: lượt mở web, tải / dùng launcher, đăng nhập' },
  { key: 'economy.view', group: 'Nhiệm vụ', label: 'Xem Hổ phách, điểm danh, sổ giao dịch' },
  { key: 'economy.edit', group: 'Nhiệm vụ', label: 'Sửa cấu hình điểm danh / nhiệm vụ, cộng / trừ Hổ phách' },
  { key: 'server.power', group: 'Server', label: 'Bật / tắt / khởi động lại server' },
  { key: 'server.schedule', group: 'Server', label: 'Sửa lịch khởi động lại, sự kiện tốc độ lớn' },
  { key: 'config.view', group: 'Server', label: 'Xem cấu hình game (Game.ini)' },
  { key: 'config.edit', group: 'Server', label: 'Sửa cấu hình game (Game.ini, danh sách admin)' },
  { key: 'rcon.announce', group: 'Server', label: 'Thông báo toàn server' },
  { key: 'rcon.run', group: 'Server', label: 'Lệnh RCON khác (AI, whitelist, loài, dọn xác, lưu…)' },
  { key: 'ddos.edit', group: 'Server', label: 'Sửa cảnh báo DDoS' },
  { key: 'backups.view', group: 'Server', label: 'Xem / tải backup' },
  { key: 'backups.edit', group: 'Server', label: 'Tạo / xoá backup, cài đặt backup, xuất cài đặt' },
  { key: 'backups.restore', group: 'Server', label: 'Khôi phục backup / xoá sạch dữ liệu (wipe)' },
  { key: 'items.view', group: 'Vật phẩm', label: 'Xem vật phẩm (skin…) và ai đang có' },
  { key: 'items.edit', group: 'Vật phẩm', label: 'Tạo / sửa / ngừng phát hành vật phẩm (màu, độ sáng tối của skin)' },
  { key: 'items.grant', group: 'Vật phẩm', label: 'Tặng / thu hồi vật phẩm, áp skin / dùng mutation lên dino người chơi' },
  { key: 'audit.view', group: 'Quản trị', label: 'Xem nhật ký admin (panel + trong game)' },
  { key: 'access.edit', group: 'Quản trị', label: 'Truy cập panel (IP được vào)' },
  { key: 'svip.edit', group: 'Quản trị', label: 'SVip: thêm / bỏ người dùng trước chức năng thử nghiệm, mở chức năng cho tất cả' },
  { key: 'discord.view', group: 'Quản trị', label: 'Xem cài đặt Discord' },
  { key: 'discord.edit', group: 'Quản trị', label: 'Sửa Discord, xem webhook, gửi thử, đăng ký lệnh' },
];
const KEYS = new Set(PERMS.map((p) => p.key));
const labelOf = (key: string): string => PERMS.find((p) => p.key === key)?.label ?? 'chỉ admin tổng';

export type Role = 'mod' | 'admin' | 'full';
const ALL = PERMS.map((p) => p.key);
export const ROLES: Record<Role, { label: string; perms: readonly string[] }> = {
  mod: {
    label: 'Kiểm duyệt',
    perms: ['players.view', 'bans.view', 'bans.edit', 'prison.view', 'prison.jail', 'map.view', 'garage.view', 'server.view', 'rcon.announce', 'audit.view'],
  },
  admin: {
    label: 'Admin',
    perms: ALL.filter((k) => !['config.edit', 'backups.restore', 'access.edit', 'discord.edit', 'ddos.edit'].includes(k)),
  },
  full: { label: 'Toàn quyền', perms: ALL },
};

export interface AdminPerm { role: Role; allow: string[]; deny: string[]; ingame: boolean }
interface Store { admins: Record<string, AdminPerm> }

/** An admin nobody has set yet: everything, as before this page existed. */
export const DEFAULT_PERM: AdminPerm = { role: 'full', allow: [], deny: [], ingame: true };

const storePath = (): string => join(config.dataDir, 'admin-permissions.json');

let cache: Store | null = null;

export async function readPermissions(): Promise<Store> {
  if (cache !== null) return cache;
  try {
    const d = JSON.parse(await readFile(storePath(), 'utf8')) as Partial<Store>;
    const admins: Record<string, AdminPerm> = {};
    for (const [id, p] of Object.entries(d.admins ?? {})) {
      if (/^\d{17}$/.test(id)) admins[id] = clean(p);
    }
    cache = { admins };
  } catch {
    cache = { admins: {} };
  }
  return cache;
}

/** Test hook: read the file again. */
export function resetPermissionsCache(): void { cache = null; }

function clean(raw: unknown): AdminPerm {
  const p = (raw ?? {}) as Partial<Record<keyof AdminPerm, unknown>>;
  const keys = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === 'string' && KEYS.has(k)))] : []);
  return {
    role: p.role === 'mod' || p.role === 'admin' || p.role === 'full' ? p.role : 'full',
    allow: keys(p.allow),
    deny: keys(p.deny),
    ingame: p.ingame !== false,
  };
}

export function validatePerm(raw: unknown): AdminPerm {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('body must be an object');
  const p = raw as Record<string, unknown>;
  if (p['role'] !== 'mod' && p['role'] !== 'admin' && p['role'] !== 'full') throw new ValidationError('role must be mod, admin or full');
  for (const f of ['allow', 'deny'] as const) {
    if (p[f] !== undefined && (!Array.isArray(p[f]) || (p[f] as unknown[]).some((k) => typeof k !== 'string' || !KEYS.has(k)))) {
      throw new ValidationError(`${f}: unknown permission`);
    }
  }
  if (p['ingame'] !== undefined && typeof p['ingame'] !== 'boolean') throw new ValidationError('ingame must be true or false');
  return clean(p);
}

export async function savePermission(steamId: string, perm: AdminPerm): Promise<{ before: AdminPerm; after: AdminPerm }> {
  if (!/^\d{17}$/.test(steamId)) throw new ValidationError('steamId must be a SteamID64');
  if (steamId === config.panel.superAdminId) throw new ValidationError('admin tổng luôn có toàn quyền');
  const store = await readPermissions();
  const before = store.admins[steamId] ?? DEFAULT_PERM;
  const next: Store = { admins: { ...store.admins, [steamId]: perm } };
  await mkdir(dirname(storePath()), { recursive: true });
  const tmp = `${storePath()}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
  await rename(tmp, storePath());
  cache = next;
  return { before, after: perm };
}

/** Who is acting: a login's SteamID, or null for a script with ADMIN_TOKEN on the server itself. */
export function isSuper(steamId: string | null): boolean {
  return steamId === null || (config.panel.superAdminId !== null && steamId === config.panel.superAdminId);
}

/** Every permission this admin has ("*" included for the super admin). */
export async function permsOf(steamId: string | null): Promise<Set<string>> {
  if (isSuper(steamId)) return new Set([...ALL, '*']);
  const p = (await readPermissions()).admins[steamId as string] ?? DEFAULT_PERM;
  const out = new Set(ROLES[p.role].perms);
  for (const k of p.allow) out.add(k);
  for (const k of p.deny) out.delete(k);
  return out;
}

/** SteamIDs whose admin rights in the game are switched off. */
export async function inGameOff(): Promise<Set<string>> {
  const out = new Set<string>();
  for (const [id, p] of Object.entries((await readPermissions()).admins)) if (!p.ingame) out.add(id);
  return out;
}

/** The game's admin list without the admins switched off in game (never empty: the super admin stays). */
export async function inGameAdmins(list: readonly string[]): Promise<string[]> {
  const off = await inGameOff();
  const kept = list.filter((id) => !off.has(id));
  if (kept.length === 0 && config.panel.superAdminId !== null) kept.push(config.panel.superAdminId);
  return kept.length > 0 ? kept : [...list];
}

/** The AdminGuard mod's file: who is switched off in game, and who is on (to put their flags back). */
export async function syncAdminGuard(admins: ReadonlySet<string>): Promise<void> {
  const off = await inGameOff();
  const body = JSON.stringify({ off: [...off].sort(), on: [...admins].filter((id) => !off.has(id)).sort() });
  await mkdir(dirname(config.adminGuardPath), { recursive: true });
  const tmp = `${config.adminGuardPath}.tmp`;
  await writeFile(tmp, body, 'utf8');
  await rename(tmp, config.adminGuardPath);
}

/** Why this admin may not do this, or null when they may. */
export async function denied(steamId: string | null, method: string, path: string): Promise<string | null> {
  const key = permissionFor(method, path);
  if (key === null) return null;
  const mine = await permsOf(steamId);
  return mine.has(key) ? null : `Bạn không có quyền: ${labelOf(key)}`;
}

/**
 * The permission one panel request needs; null = any logged-in admin; "*" =
 * the super admin only (the permission page itself, and any route not listed).
 */
export function permissionFor(method: string, path: string): string | null {
  if (!path.startsWith('/api/')) return null;
  const read = method === 'GET' || method === 'HEAD';
  // Anyone logged in: who they are, and reference data the pages share.
  if (read && ['/api/me', '/api/health', '/api/catalog', '/api/mutations'].includes(path)) return null;
  if (path === '/api/permissions' || path.startsWith('/api/permissions/')) return '*';
  // Deleting chat / admin log lines: the super admin's only (deletions.ts).
  if (path === '/api/chat/delete' || path === '/api/server/audit/delete') return '*';

  if (read) {
    if (['/api/players', '/api/online', '/api/feed', '/api/killfeed', '/api/chat', '/api/leaderboard', '/api/kill-scene', '/api/damage-reach'].includes(path)
      || /^\/api\/player\/[^/]+(\/path\/\d+)?$/.test(path) || /^\/api\/lives\/\d{17}$/.test(path)) return 'players.view';
    if (path === '/api/bans') return 'bans.view';
    if (path === '/api/prison') return 'prison.view';
    if (['/api/map', '/api/map/live', '/api/map/flora', '/api/ai-zones', '/api/ai-zones/points', '/api/zone-guard'].includes(path)) return 'map.view';
    if (['/api/ai-reset', '/api/fish-settings', '/api/flora-settings', '/api/ai-ambient', '/api/ai-drop'].includes(path)) return 'world.view';
    if (['/api/garage', '/api/garage-settings', '/api/prime-fixes', '/api/prime-last', '/api/species-stats'].includes(path)
      || /^\/api\/garage\/[^/]+(\/[^/]+)?$/.test(path)) return 'garage.view';
    if (['/api/commands-settings', '/api/ptera-carry', '/api/tele-settings', '/api/voice-settings', '/api/messages', '/api/news'].includes(path)) return 'mods.view';
    if (['/api/server/status', '/api/server/readiness', '/api/metrics', '/api/ddos', '/api/rcon/commands', '/api/server/growth-events'].includes(path)) return 'server.view';
    if (path === '/api/game-config' || path === '/api/members') return 'config.view';
    if (path === '/api/backups' || /^\/api\/backups\/file\/[^/]+$/.test(path)) return 'backups.view';
    if (path === '/api/server/audit') return 'audit.view';
    if (path === '/api/items' || /^\/api\/items\/[^/]+\/owners$/.test(path)) return 'items.view';
    if (path === '/api/panel-access') return 'access.edit';
    if (path === '/api/svip') return 'svip.edit';
    if (path === '/api/discord') return 'discord.view';
    if (path === '/api/traffic') return 'traffic.view';
    if (path === '/api/economy' || path === '/api/economy/ledger' || path === '/api/quests' || path === '/api/shop') return 'economy.view';
    if (path === '/api/discord/url') return 'discord.edit';   // shows a webhook's secret URL
    return '*';
  }

  if (/^\/api\/player\/[^/]+\/kill$/.test(path)) return 'players.kill';
  if (/^\/api\/player\/\d{17}\/admin$/.test(path)) return 'players.admin';
  if (['/api/bans', '/api/bans/unban', '/api/bans/edit', '/api/ban-reasons'].includes(path)) return 'bans.edit';
  if (path === '/api/prison/jail' || /^\/api\/prison\/sentence\/[^/]+\/(release|extend)$/.test(path)) return 'prison.jail';
  if (path === '/api/prison/settings') return 'prison.settings';
  if (['/api/ai-zones', '/api/ai-drop', '/api/flora-settings', '/api/fish-settings', '/api/ai-ambient', '/api/zone-guard',
    '/api/ai-reset', '/api/ai-reset/cancel'].includes(path)) return 'world.edit';
  if (/^\/api\/garage\/[^/]+\/[^/]+$/.test(path) || /^\/api\/mutations\/[^/]+$/.test(path)
    || ['/api/restore-life', '/api/prime-fixes', '/api/light-test'].includes(path)) return 'garage.edit';
  if (path === '/api/garage-settings') return 'garage.settings';
  if (['/api/commands-settings', '/api/ptera-carry', '/api/tele-settings', '/api/voice-settings', '/api/messages', '/api/news'].includes(path)) return 'mods.edit';
  if (/^\/api\/server\/(start|stop|restart|cancel)$/.test(path)) return 'server.power';
  if (path === '/api/server/schedule' || path === '/api/server/growth-events' || /^\/api\/server\/growth-events\/[\w-]+$/.test(path)) return 'server.schedule';
  if (path === '/api/game-config') return 'config.edit';
  if (path === '/api/rcon/announce') return 'rcon.announce';
  if (/^\/api\/rcon\/[A-Za-z]+$/.test(path)) return 'rcon.run';
  if (path === '/api/ddos') return 'ddos.edit';
  if (['/api/backups/restore', '/api/backups/wipe'].includes(path)) return 'backups.restore';
  if (['/api/backups', '/api/backup-settings', '/api/backups/export-settings'].includes(path) || /^\/api\/backups\/file\/[^/]+$/.test(path)) return 'backups.edit';
  if (path === '/api/panel-access') return 'access.edit';
  if (path === '/api/svip') return 'svip.edit';
  if (path === '/api/economy/settings' || path === '/api/economy/adjust' || path === '/api/quests' || path === '/api/shop') return 'economy.edit';
  if (path === '/api/items' || /^\/api\/items\/[^/]+$/.test(path)) return 'items.edit';
  if (/^\/api\/items\/[^/]+\/(grant|apply)$/.test(path) || /^\/api\/items\/[^/]+\/grant\/\d{17}$/.test(path)) return 'items.grant';
  if (['/api/discord', '/api/discord/test', '/api/discord/register-commands'].includes(path)) return 'discord.edit';
  return '*';
}
