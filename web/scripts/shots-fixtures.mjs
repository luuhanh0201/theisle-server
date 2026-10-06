// Fake answers of the bridge for shots.mjs, one per GET route a page reads. Add the routes of each
// page moved to React (a value, or a function of the URL).
const now = () => Math.floor(Date.now() / 1000);
export const API = {
  '/api/me': { steamId: '76561198000000001', name: 'Dev', ip: '1.2.3.4', via: 'web', token: 'tok', perms: [], super: true },
  '/api/health': { lastEventAt: Date.now(), players: 3, online: 3, feed: 0, writesEnabled: true },
  '/api/server/status': { phase: 'running' },
  '/api/commands-settings': { slayCooldown: 300, unstuckCooldown: 600, foodCooldown: 30, enabled: { slay: true, unstuck: true, prime: false, status: true, food: true } },
  '/api/ptera-carry': { enabled: true, maxKg: 150, maxSeconds: 20, cooldown: 60, hintMeters: 8, grabMeters: 6 },
  '/api/tele-settings': { maxGrowthPct: 40, targetMaxGrowthPct: 40, codeMinutes: 5, cooldownS: 60, combatS: 60, countdownS: 5 },
  '/api/voice-settings': { nameMode: 'id', enabled: true, url: 'wss://voice.example.vn' },
  '/api/messages': {
    texts: { 'hello.welcome': 'Chào mừng tới Xóm Gáy', 'ptera.grab': '' }, countdownMarks: [900, 300, 60, 10],
    periodic: [{ id: 'a1', text: 'Discord của server: discord.gg/xomgay', everyMin: 30, enabled: true }, { id: 'a2', text: 'Đọc luật trước khi chơi', everyMin: 60, enabled: false }],
    corpseWipe: { everyMin: 60, warnSec: 60 },
    catalog: [
      { key: 'server.restart.countdown', group: 'server', label: 'Đếm ngược khởi động lại (mỗi mốc)', default: 'Server sẽ khởi động lại sau {left} / Server restarting in {leftEn}. {reason}', vars: ['left', 'leftEn', 'reason'] },
      { key: 'ptera.grab', group: 'ptera', label: 'Gắp được con mồi', default: 'Đã gắp {name} ({kg} kg)', vars: ['name', 'kg'] },
      { key: 'guard.warn', group: 'guard', label: 'Cảnh báo vào vùng dino nhỏ', default: 'Vùng {zone} chỉ cho dino dưới {growth}%', vars: ['zone', 'growth'], offByDefault: true },
      { key: 'hello.welcome', group: 'hello', label: 'Chào khi vào game / spawn', default: 'Welcome to the island.', vars: [] },
    ],
  },
  '/api/flora-settings': () => ({
    settings: { control: true, migrationNutrientPct: 60, migrationMultiplier: 2, massNutrientPct: 90, massMultiplier: 4, outsideAmountPct: 20, migrationMaxPerArea: 30, massMaxPerArea: 60, outsideMaxPerArea: 10 },
    control: { t: now() - 40, on: true, active: 3, plants: 412, plantsNutri: 250, fruits: 80, fruitsNutri: 41, trimmed: 12 }, t: now() - 40,
  }),
  '/api/fish-settings': () => ({
    settings: { control: true, perPlayer: 12, perWater: 28, cooldownSec: 0.5, species: ['Catfish', 'Coalecanth', 'Hoplo', 'Longear'] },
    species: [
      { key: 'Catfish', cls: 'BP_Catfish_C', label: 'Catfish (cá trê)' }, { key: 'Coalecanth', cls: 'BP_Coalecanth_C', label: 'Coelacanth (cá vây tay)' },
      { key: 'Forktail', cls: 'BP_Forktail_C', label: 'Forktail' }, { key: 'Hoplo', cls: 'BP_Hoplo_C', label: 'Hoplo' },
      { key: 'Longear', cls: 'BP_Longear_C', label: 'Longear (cá thái dương)' }, { key: 'Muskel', cls: 'BP_Muskel_C', label: 'Muskel' },
    ],
    census: { t: now() - 30, online: 3, total: 21, species: { BP_Catfish_C: 9, BP_Hoplo_C: 7, BP_Longear_C: 5 }, perPlayer: 12, perWater: 28, cooldownSec: 0.5 },
    disallowed: ['Forktail', 'Muskel'],
  }),
  '/api/garage-settings': { redeemAt: 'stored', maxSlots: 3, storeCountdown: 30, cooldown: 180, minHealthPct: 20, minGrowthPct: 0,
    tiers: { vip: { maxSlots: 5, cooldown: 120 }, svip: { maxSlots: 0, cooldown: 60 } }, memberCounts: { vip: 4, svip: 2, admin: 3 } },
  '/api/panel-access': { ips: ['113.161.0.0/16', '2405:4802:1d32:eec0::/64'], saved: true, yourIp: '2405:4802:1d32:eec0::9', yourRule: '2405:4802:1d32:eec0::/64', webEnabled: true },
  '/api/discord': () => ({
    enabled: true, routes: { join: 'a', leave: 'a', kill: 'b', ban: 'c', server: 'c' }, mentions: { ban: 'here', server: '123456789012345678' },
    channels: [{ id: 'a', name: 'nguoi-choi', hint: 'webhook 1234567890 · …ab12' }, { id: 'b', name: 'killfeed', hint: 'webhook 1234567891 · …cd34' }, { id: 'c', name: 'admin-log', hint: 'webhook 1234567892 · …ef56' }],
    relay: { url: 'https://theisle-discord-relay.xomgay.workers.dev', hasSecret: true }, board: 'c',
    kinds: [
      { key: 'join', group: 'Người chơi', label: 'Vào server' }, { key: 'leave', group: 'Người chơi', label: 'Rời server' },
      { key: 'kill', group: 'Chiến đấu', label: 'Người chơi giết người chơi' }, { key: 'ban', group: 'Quản trị', label: 'Ban, gỡ ban, sửa ban (lý do, ngày, người làm)' },
      { key: 'server', group: 'Server', label: 'Server bật / tắt / lỗi' },
    ],
    status: { queued: 0, dropped: 0, relay: { lastOkAt: now() - 60, lastError: null }, channels: {
      a: { queued: 0, lastOkAt: now() - 20, lastError: null, waitUntil: 0, webhook: { name: 'Xóm Gáy Log', channelId: '99990001', error: null, at: 0 } },
      b: { queued: 3, lastOkAt: null, lastError: 'HTTP 429', waitUntil: 0, webhook: { name: 'Killfeed', channelId: '99990002', error: null, at: 0 } },
      c: { queued: 0, lastOkAt: now() - 300, lastError: null, waitUntil: 0, webhook: { name: 'Admin', channelId: '99990003', error: null, at: 0 } },
    } },
  }),
  '/api/svip': {
    players: [{ steamId: '76561198000000002', note: 'tester túi đồ', addedAt: now() - 86400, by: 'Dev', name: 'Dã Tượng' }, { steamId: '76561198000000003', note: '', addedAt: now() - 3600, by: 'Dev', name: null }],
    features: [{ key: 'shop', label: 'Cửa hàng Hổ phách', mode: 'testing' }, { key: 'quests', label: 'Nhiệm vụ hằng ngày / tuần', mode: 'all' }, { key: 'tele', label: 'Tele con non', mode: 'admin' }],
    modes: [{ key: 'admin', label: 'Chỉ admin', note: 'Đang phát triển' }, { key: 'testing', label: 'SVip', note: 'Ưu tiên dùng trước' }, { key: 'all', label: 'Công khai', note: 'Đã phát hành' }],
  },
};
