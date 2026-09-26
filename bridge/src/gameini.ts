import { readFile, writeFile, rename, mkdir, copyFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';

/**
 * Game.ini settings the admin panel owns.
 *
 * Game.ini is rendered by deploy.sh from config/Game.ini.template + .env
 * (identity, passwords, RCON, admins — repo-owned). A few gameplay keys are
 * owned by the panel instead (MANAGED below), identified by KEY NAME inside
 * their section — e.g. every `AllowedClasses=` line under
 * `[/Script/TheIsle.TIGameStateBase]`.
 *
 * Not by comment markers: the game rewrites Game.ini itself (a
 * `;METADATA=(Diff=true, …)` header, every comment dropped) whenever it saves
 * its config, e.g. after an RCON setting change. Section headers and keys
 * survive that; comments do not.
 *
 * The panel's values are stored in DATA_DIR/game-settings.json, which deploy
 * never overwrites. applySettings() writes them into the section. It is the
 * ONE implementation, used by the bridge (panel "save"), by deploy.sh and by
 * the game unit's ExecStartPre (both through cli-apply-settings), so they can
 * never render differently.
 *
 * Only keys confirmed by at least two hosting sources are managed: a misspelt
 * key is silently ignored by the game, so a guess here would look like it
 * works and do nothing.
 */

export type Section = 'TIGameSession' | 'TIGameStateBase';

/**
 * AllowedClasses values for the playable roster, spelled as Game.ini expects
 * them — the short name, one line each:  AllowedClasses=Carnotaurus
 *
 * Source: the live server itself (TheIsle 0.21.784, 2026-09-24). Its binary
 * holds 29 dinosaur blueprints (/TheIsle/Core/Characters/Dinosaurs/<Name>/
 * BP_<Name>); all 26 non-critter names were written as AllowedClasses, and
 * RCON GetPlayables answered with these 22 — the game drops the rest
 * (Avaceratops, Baryonyx, Camarasaurus, Oviraptor: blueprints exist, not
 * playable yet). Web lists disagree (18, 20, 22, 27 names, some from Legacy),
 * so they are not the source. With no AllowedClasses line at all the picker can
 * come up empty (XGamingServer troubleshooting), so "every species" means
 * listing them all. Names the live server reports (RCON GetPlayables, species
 * seen in play) are added to the panel's list, so a later patch's species
 * still shows up.
 */
export const KNOWN_PLAYABLES = [
  'Allosaurus', 'Austroraptor', 'Beipiaosaurus', 'Carnotaurus', 'Ceratosaurus',
  'Deinosuchus', 'Diabloceratops', 'Dilophosaurus', 'Dryosaurus', 'Gallimimus',
  'Herrerasaurus', 'Hypsilophodon', 'Kentrosaurus', 'Maiasaura', 'Omniraptor',
  'Pachycephalosaurus', 'Pteranodon', 'Stegosaurus', 'Tenontosaurus', 'Triceratops',
  'Troodon', 'Tyrannosaurus',
];

/** Panel groups, in display order. */
export const GROUPS = {
  server: 'Máy chủ',
  spawn: 'Loài & điểm spawn',
  ai: 'AI & thực vật',
  gameplay: 'Gameplay',
  world: 'Ngày đêm & thời tiết',
  migration: 'Di cư & tuần tra',
  advanced: 'Nâng cao',
} as const;
export type Group = keyof typeof GROUPS;

interface KeyBase {
  section: Section;
  group: Group;
  label: string;
  help: string;
  /**
   * false = the game reads this key by name (it sits in the server binary's
   * list of Game.ini keys) but it is not a reflected property, so the live
   * value could not be read back to confirm it. Shown as "chưa xác minh".
   */
  verified?: false;
}
interface IntKey extends KeyBase { type: 'int'; min: number; max: number; default: number }
interface FloatKey extends KeyBase { type: 'float'; min: number; max: number; step: number; default: number }
interface BoolKey extends KeyBase { type: 'bool'; default: boolean }
interface TextKey extends KeyBase { type: 'text'; maxLen: number; default: string }
interface ListKey extends KeyBase {
  type: 'list'; item: RegExp; itemHelp: string; max: number;
  /** Fewest entries a save may leave (AdminsSteamIDs: never lock every admin out). */
  min?: number;
  /** Values offered as checkboxes (the rest can still be typed). */
  suggest?: string[];
}
export type ManagedKey = IntKey | FloatKey | BoolKey | TextKey | ListKey;

const S = 'TIGameSession' as const;
const G = 'TIGameStateBase' as const;
const NAME = /^[A-Za-z0-9_]{2,64}$/;
const STEAM = /^\d{17}$/;

/**
 * Every Game.ini key the panel owns, with the game's own default.
 *
 * Source: IsleProbe's dump of the live server's reflection data (TheIsle
 * 0.21.784, 2026-09-24): each property of TIGameSession / TIGameStateBase with
 * its type and live value — which also fixes names the hosting docs get wrong
 * (bRandomWeatherEnabled, not bServerDynamicWeather; SpeciesMigrationTime, not
 * MaxMigrationTime). The `verified: false` keys are not reflected properties;
 * the binary reads them by name alongside ServerName, MaxPlayerCount… .
 *
 * AdminsSteamIDs is panel-owned on request (2026-09-24): ADMIN_STEAM_IDS in
 * .env only seeds it; once the panel saves its list, that list wins on every
 * save, deploy and start. Trade-off: whoever holds the panel token can grant
 * in-game admin. A save can never leave it empty (min: 1).
 *
 * Deliberately NOT here (repo/.env-owned): MapName (one map), the server
 * password, RCON and every port (a wrong value locks the panel out), and
 * EnabledMutations (an array of MutationsAvailable structs — format unknown;
 * bEnableMutations switches them all). Runtime state (ServerFPS, AIAlive,
 * VIPQueue, HLOD arrays) is not configuration.
 */
export const MANAGED: Record<string, ManagedKey> = {
  // --- server
  ServerName: { section: S, group: 'server', type: 'text', maxLen: 100, default: '',
    label: 'Tên server', help: 'Hiện trong danh sách server của game. Để trống = lấy SERVER_NAME trong .env (deploy).' },
  Discord: { section: S, group: 'server', type: 'text', maxLen: 200, default: 'DiscordLinkHere',
    label: 'Link Discord', help: 'Hiện cho người chơi trong game. Để trống = giá trị mặc định của game.' },
  MaxPlayerCount: { section: S, group: 'server', type: 'int', min: 1, max: 500, default: 100,
    label: 'Số người chơi tối đa', help: 'Số người vào cùng lúc; đầy thì vào hàng chờ.' },
  bServerWhitelist: { section: S, group: 'server', type: 'bool', default: false,
    label: 'Chỉ cho whitelist vào', help: 'Bật: chỉ SteamID trong Whitelist mới vào được.' },
  WhitelistIDs: { section: G, group: 'server', type: 'list', item: STEAM, max: 2000,
    itemHelp: 'SteamID64', label: 'Whitelist', help: 'Mỗi dòng một SteamID64. Chỉ có tác dụng khi bật "Chỉ cho whitelist vào".' },
  AdminsSteamIDs: { section: G, group: 'server', type: 'list', item: STEAM, max: 200, min: 1,
    itemHelp: 'SteamID64', label: 'Admin',
    help: 'Mỗi dòng một SteamID64 — quyền admin trong game (lệnh admin, RCON nhận diện). Phải còn ít nhất 1 admin. Có hiệu lực sau khi khởi động lại.' },
  VIPs: { section: G, group: 'server', type: 'list', item: STEAM, max: 2000,
    itemHelp: 'SteamID64', label: 'VIP', help: 'Mỗi dòng một SteamID64 — được ưu tiên khi server đầy.' },
  bEnableGlobalChat: { section: S, group: 'server', type: 'bool', default: false,
    label: 'Chat toàn server', help: 'Bật kênh chat global.' },
  bEnableSpawnCodes: { section: S, group: 'server', type: 'bool', default: true,
    label: 'Mã spawn nhóm', help: 'Cho người chơi dùng mã để spawn cạnh nhau.' },
  bEnableHumans: { section: S, group: 'server', type: 'bool', default: false,
    label: 'Cho chơi người (humans)', help: 'Nhân vật người — mặc định tắt.' },

  // --- species & spawn
  AllowedClasses: { section: G, group: 'spawn', type: 'list', item: NAME, max: 100,
    itemHelp: 'tên loài, vd. Carnotaurus', label: 'Loài được chơi',
    help: 'Chỉ loài được tick mới chơi được. Muốn mở mọi loài thì tick hết — không tick loài nào có thể làm màn chọn dino trống.' },
  bUseRegionSpawning: { section: S, group: 'spawn', type: 'bool', default: false, verified: false,
    label: 'Cho chọn vùng spawn', help: 'Chỉ là công tắc. Bật: màn spawn cho người chơi chọn vùng — có những vùng nào, còn chỗ hay không là do game quyết định. Tắt: game tự spawn ngẫu nhiên.' },
  bUseRegionSpawnCooldown: { section: S, group: 'spawn', type: 'bool', default: false, verified: false,
    label: 'Thời gian chờ chọn vùng', help: 'Bật: phải chờ giữa hai lần chọn vùng spawn.' },
  RegionSpawnCooldownTimeSeconds: { section: S, group: 'spawn', type: 'int', min: 0, max: 86400, default: 0, verified: false,
    label: 'Chờ chọn vùng (giây)', help: 'Dùng khi bật "Thời gian chờ chọn vùng".' },

  // --- AI & plants
  bSpawnAI: { section: S, group: 'ai', type: 'bool', default: true,
    label: 'Sinh AI', help: 'Con mồi / thú AI (nguồn thức ăn của loài ăn thịt).' },
  AIDensity: { section: S, group: 'ai', type: 'float', min: 0, max: 5, step: 0.05, default: 1,
    label: 'Mật độ AI', help: '0.25 thưa (nhẹ máy) · 1 mặc định · 2 dày (nặng).' },
  AISpawnInterval: { section: S, group: 'ai', type: 'float', min: 5, max: 600, step: 1, default: 40,
    label: 'Chu kỳ sinh AI (giây)', help: 'Bao lâu server kiểm tra để sinh thêm AI.' },
  DisallowedAIClasses: { section: S, group: 'ai', type: 'list', item: NAME, max: 100,
    itemHelp: 'tên AI, vd. Boar', label: 'Cấm loài AI',
    // Dryosaurus, Gallimimus: also AI the game spawns (seen on the live map
    // 2026-09-26), not only playables.
    suggest: ['Boar', 'Chicken', 'Compsognathus', 'Crab', 'Deer', 'Dryosaurus', 'Frog', 'Gallimimus', 'Goat', 'Lizard',
      'Psittacosaurus', 'Pterodactylus', 'Rabbit', 'Seaturtle'],
    help: 'Loài được tick: game không tự sinh nữa. Chỉ chặn AI game tự sinh — loài của vùng AI chọn riêng trong từng vùng (Bản đồ → Vùng AI).' },
  bSpawnAmbientFauna: { section: S, group: 'ai', type: 'bool', default: false,
    label: 'Sinh động vật môi trường', help: 'Thú nhỏ trang trí (chim, côn trùng…).' },
  bSpawnPlants: { section: S, group: 'ai', type: 'bool', default: true,
    label: 'Sinh cây ăn được', help: 'Nguồn thức ăn của loài ăn cỏ.' },
  PlantSpawnMultiplier: { section: S, group: 'ai', type: 'float', min: 0, max: 5, step: 0.05, default: 1,
    label: 'Mật độ cây', help: 'Hệ số số lượng cây ăn được.' },

  // --- gameplay
  GrowthMultiplier: { section: S, group: 'gameplay', type: 'float', min: 0.1, max: 20, step: 0.1, default: 1,
    label: 'Tốc độ lớn', help: 'Hệ số tốc độ tăng trưởng (nên < 20).' },
  CorpseDecayMultiplier: { section: S, group: 'gameplay', type: 'float', min: 0, max: 10, step: 0.1, default: 1,
    label: 'Tốc độ phân huỷ xác', help: 'Cao hơn = xác biến mất nhanh hơn.' },
  bEnableMutations: { section: S, group: 'gameplay', type: 'bool', default: true,
    label: 'Mutation', help: 'Hệ thống đột biến.' },
  bEnableDiets: { section: S, group: 'gameplay', type: 'bool', default: true,
    label: 'Chế độ ăn', help: 'Dinh dưỡng theo loài (đạm, tinh bột, chất béo…).' },

  // --- day/night & weather
  ServerDayLengthMinutes: { section: S, group: 'world', type: 'float', min: 1, max: 1440, step: 1, default: 45,
    label: 'Độ dài ngày (phút)', help: 'Thời gian ban ngày.' },
  ServerNightLengthMinutes: { section: S, group: 'world', type: 'float', min: 1, max: 1440, step: 1, default: 20,
    label: 'Độ dài đêm (phút)', help: 'Thời gian ban đêm.' },
  bRandomWeatherEnabled: { section: S, group: 'world', type: 'bool', default: true,
    label: 'Thời tiết ngẫu nhiên', help: 'Thời tiết thay đổi theo thời gian.' },
  MinWeatherVariationInterval: { section: S, group: 'world', type: 'float', min: 30, max: 86400, step: 1, default: 600,
    label: 'Đổi thời tiết sớm nhất (giây)', help: 'Khoảng tối thiểu giữa hai lần đổi.' },
  MaxWeatherVariationInterval: { section: S, group: 'world', type: 'float', min: 30, max: 86400, step: 1, default: 900,
    label: 'Đổi thời tiết muộn nhất (giây)', help: 'Khoảng tối đa giữa hai lần đổi.' },

  // --- migration & patrol
  bEnableMigration: { section: S, group: 'migration', type: 'bool', default: true,
    label: 'Di cư theo loài', help: 'Vùng di cư của từng loài.' },
  SpeciesMigrationTime: { section: S, group: 'migration', type: 'float', min: 60, max: 604800, step: 60, default: 10800,
    label: 'Thời gian di cư (giây)', help: 'Mặc định 10800 = 3 giờ.' },
  bEnableMassMigration: { section: S, group: 'migration', type: 'bool', default: true,
    label: 'Đại di cư', help: 'Sự kiện di cư lớn.' },
  MassMigrationTime: { section: S, group: 'migration', type: 'float', min: 60, max: 604800, step: 60, default: 43200,
    label: 'Chu kỳ đại di cư (giây)', help: 'Mặc định 43200 = 12 giờ.' },
  MassMigrationDisableTime: { section: S, group: 'migration', type: 'float', min: 0, max: 604800, step: 60, default: 7200,
    label: 'Nghỉ sau đại di cư (giây)', help: 'Mặc định 7200 = 2 giờ.' },
  bEnablePatrolZones: { section: S, group: 'migration', type: 'bool', default: true,
    label: 'Vùng tuần tra', help: 'Vùng tuần tra theo loài.' },
  IndividualPatrolTime: { section: S, group: 'migration', type: 'float', min: 60, max: 86400, step: 60, default: 1200,
    label: 'Thời gian tuần tra (giây)', help: 'Mặc định 1200 = 20 phút.' },

  // --- advanced
  bQueueEnabled: { section: S, group: 'advanced', type: 'bool', default: true,
    label: 'Hàng chờ', help: 'Người vào khi server đầy được xếp hàng (cổng QueuePort trong .env).' },
  QueueJoinTimeoutSeconds: { section: S, group: 'advanced', type: 'float', min: 5, max: 600, step: 1, default: 30,
    label: 'Hàng chờ: hạn vào (giây)', help: 'Thời gian để người đến lượt kịp vào.' },
  QueueHeartbeatIntervalSeconds: { section: S, group: 'advanced', type: 'float', min: 1, max: 120, step: 1, default: 8,
    label: 'Hàng chờ: nhịp heartbeat (giây)', help: '' },
  QueueHeartbeatTimeoutSeconds: { section: S, group: 'advanced', type: 'float', min: 1, max: 120, step: 1, default: 5,
    label: 'Hàng chờ: hết hạn heartbeat (giây)', help: '' },
  QueueHeartbeatMaxMisses: { section: S, group: 'advanced', type: 'int', min: 1, max: 20, default: 2,
    label: 'Hàng chờ: số lần lỡ tối đa', help: 'Lỡ quá số heartbeat này thì mất chỗ.' },
  bQueueDebugLogging: { section: S, group: 'advanced', type: 'bool', default: false,
    label: 'Hàng chờ: log gỡ lỗi', help: 'Ghi chi tiết hàng chờ vào log game.' },
  ESPCheck: { section: S, group: 'advanced', type: 'bool', default: false,
    label: 'ESPCheck', help: 'Có trong game nhưng không có tài liệu — để nguyên nếu không chắc.' },
  bAllowRecordingReplay: { section: S, group: 'advanced', type: 'bool', default: false, verified: false,
    label: 'Cho ghi replay', help: 'Cho người chơi ghi replay phía server.' },
};

export type Settings = Record<string, number | boolean | string | string[] | null>;

/** Keep only managed keys, correctly typed; throw on anything else. */
export function validateSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ValidationError('settings must be an object');
  }
  const out: Settings = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const spec = MANAGED[key];
    if (spec === undefined) throw new ValidationError(`${key} is not a panel-managed setting`);
    if (value === undefined) continue;
    // null = no line at all: the game falls back to its own built-in default.
    // The only honest choice for a key whose default could not be read back.
    if (value === null) { out[key] = null; continue; }
    if (spec.type === 'int') {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isInteger(n) || n < spec.min || n > spec.max) {
        throw new ValidationError(`${key} must be a whole number ${spec.min}–${spec.max}`);
      }
      out[key] = n;
    } else if (spec.type === 'float') {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n) || n < spec.min || n > spec.max) {
        throw new ValidationError(`${key} must be a number ${spec.min}–${spec.max}`);
      }
      out[key] = n;
    } else if (spec.type === 'text') {
      if (typeof value !== 'string') throw new ValidationError(`${key} must be text`);
      const t = value.trim();
      // One ini line: no control characters (a newline would inject a key).
      if (/[\u0000-\u001f\u007f]/.test(t)) throw new ValidationError(`${key} must be a single line`);
      if (t.length > spec.maxLen) throw new ValidationError(`${key}: at most ${spec.maxLen} characters`);
      // Empty = no line: the game turns "Discord=" into the FName "None" and
      // shows that to players; without the line it keeps its own default.
      out[key] = t === '' ? null : t;
    } else if (spec.type === 'bool') {
      if (typeof value !== 'boolean') throw new ValidationError(`${key} must be true or false`);
      out[key] = value;
    } else {
      const items = (Array.isArray(value) ? value : String(value).split(/[\s,]+/))
        .map((x) => String(x).trim()).filter((x) => x !== '');
      const bad = items.find((x) => !spec.item.test(x));
      if (bad !== undefined) throw new ValidationError(`${key}: "${bad}" is not a valid ${spec.itemHelp}`);
      const unique = [...new Set(items)];
      if (unique.length > spec.max) throw new ValidationError(`${key}: at most ${spec.max} entries`);
      if (spec.min !== undefined && unique.length < spec.min) {
        throw new ValidationError(`${key}: at least ${spec.min} entry required`);
      }
      out[key] = unique;
    }
  }
  return out;
}

function renderLines(key: string, value: number | boolean | string | string[] | null): string[] {
  if (value === null) return [];
  if (Array.isArray(value)) return value.map((v) => `${key}=${v}`);
  return [`${key}=${value}`];
}

const HEADER = (s: Section): string => `[/Script/TheIsle.${s}]`;
const keyOf = (line: string): string | null => {
  const t = line.trim();
  if (t === '' || t.startsWith(';') || t.startsWith('[')) return null;
  const i = t.indexOf('=');
  return i > 0 ? t.slice(0, i).trim() : null;
};

/**
 * Write `settings` into `ini`: for each key, every existing `key=` line in its
 * section is replaced by the new line(s), at the place of the first one (or
 * after the section's last line if the key is new). Keys the panel has not set,
 * and every other line, are left exactly as they are. A missing section is
 * appended. Idempotent.
 */
export function applySettings(ini: string, settings: Settings): string {
  const eol = ini.includes('\r\n') ? '\r\n' : '\n';
  let lines = ini.split(/\r?\n/);
  // MANAGED order, so the output does not depend on the JSON key order.
  for (const key of Object.keys(MANAGED).filter((k) => k in settings)) {
    const spec = MANAGED[key] as ManagedKey;
    const added = renderLines(key, settings[key] as number | boolean | string | string[] | null);
    let head = lines.findIndex((l) => l.trim() === HEADER(spec.section));
    if (head === -1) {
      if (added.length === 0) continue;
      while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
      lines = [...lines, '', HEADER(spec.section)];
      head = lines.length - 1;
    }
    let end = lines.findIndex((l, i) => i > head && l.trim().startsWith('['));
    if (end === -1) end = lines.length;
    const body = lines.slice(head + 1, end);
    const first = body.findIndex((l) => keyOf(l) === key);
    const kept = body.filter((l) => keyOf(l) !== key);
    let at: number;
    if (first !== -1) {
      at = body.slice(0, first).filter((l) => keyOf(l) !== key).length;
    } else {
      at = kept.length;
      while (at > 0 && kept[at - 1]?.trim() === '') at--;       // before the blank gap
    }
    const newBody = [...kept.slice(0, at), ...added, ...kept.slice(at)];
    lines = [...lines.slice(0, head + 1), ...newBody, ...lines.slice(end)];
  }
  return lines.join(eol);
}

/** The managed keys as they currently stand in `ini` (template defaults included). */
export function readManaged(ini: string): Settings {
  const out: Settings = {};
  for (const line of ini.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i <= 0 || line.trim().startsWith(';')) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    const spec = MANAGED[key];
    if (spec === undefined) continue;
    if (spec.type === 'list') out[key] = [...((out[key] as string[] | undefined) ?? []), value];
    else if (spec.type === 'bool') out[key] = value.toLowerCase() === 'true';
    else if (spec.type === 'text') out[key] = value.replace(/^"(.*)"$/, '$1');
    else out[key] = Number(value);
  }
  return out;
}

// --- storage + live apply (bridge side) -----------------------------------

const settingsPath = (): string => join(config.dataDir, 'game-settings.json');
const liveIniPath = (): string => join(config.game.configDir, 'Game.ini');

export async function readSettings(): Promise<Settings> {
  try {
    return validateSettings(JSON.parse(await readFile(settingsPath(), 'utf8')));
  } catch {
    return {};
  }
}

export interface LiveConfig {
  /** What the panel has set (subset of MANAGED). */
  settings: Settings;
  /** The managed keys as the live Game.ini has them now. */
  effective: Settings;
  /** Unix seconds the live Game.ini was last written, null if missing. */
  iniWrittenAt: number | null;
  error?: string;
}

export async function readLive(): Promise<LiveConfig> {
  const settings = await readSettings();
  try {
    const [text, st] = await Promise.all([readFile(liveIniPath(), 'utf8'), stat(liveIniPath())]);
    return { settings, effective: readManaged(text), iniWrittenAt: Math.floor(st.mtimeMs / 1000) };
  } catch (error) {
    return { settings, effective: {}, iniWrittenAt: null, error: `cannot read ${liveIniPath()}: ${(error as Error).message}` };
  }
}

/**
 * Save settings and write them into the live Game.ini (takes effect at the next
 * server start). The previous Game.ini is kept in DATA_DIR/ini-backups/.
 * Validation happens BEFORE anything is written.
 */
export async function saveSettings(raw: unknown): Promise<Settings> {
  const settings = validateSettings(raw);
  const current = await readFile(liveIniPath(), 'utf8');
  const next = applySettings(current, settings);

  await mkdir(join(config.dataDir, 'ini-backups'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await copyFile(liveIniPath(), join(config.dataDir, 'ini-backups', `Game.ini.${stamp}`));

  const tmpSettings = `${settingsPath()}.tmp`;
  await writeFile(tmpSettings, JSON.stringify(settings, null, 2), 'utf8');
  await rename(tmpSettings, settingsPath());

  const tmpIni = `${liveIniPath()}.tmp`;
  await writeFile(tmpIni, next, 'utf8');
  await rename(tmpIni, liveIniPath());
  return settings;
}
