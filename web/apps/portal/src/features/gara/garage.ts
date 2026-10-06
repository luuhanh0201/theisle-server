import type { PlayerSlot } from '@isle/api';

/** Redeem replies come in English; the store ones are already Vietnamese. */
const REPLY_VI: ReadonlyArray<readonly [RegExp, (m: RegExpExecArray) => string]> = [
  [/^Garage cooldown: wait (\d+) s\.$/, (m) => `Gara đang hồi: chờ ${m[1]} giây.`],
  [/^Your garage is empty\.$/, () => 'Gara của bạn đang trống.'],
  [/^Slot '.+' is empty or unreadable\.$/, () => 'Con dino này không còn trong gara.'],
  [/^Respawn first, then type !redeem\.$/, () => 'Hãy respawn trước rồi mới lấy ra.'],
  [/^Wrong species.*$/, () => 'Sai loài. Respawn đúng loài đã cất rồi thử lại.'],
  [/^Restoring '.+' at the spot you stored it\..*$/, () => 'Đang khôi phục tại chỗ đã cất, đứng yên vài giây.'],
  [/^Restoring '.+'\..*$/, () => 'Đang khôi phục, đứng yên vài giây.'],
  [/^Slot '.+' has no stored position.*$/, () => 'Con này không có vị trí đã cất: khôi phục tại chỗ.'],
  [/^Slot '.+' could not be taken out.*$/, () => 'Không lấy được con dino này ra. Thử lại.'],
];
export function replyVi(m: string): string {
  for (const [re, fn] of REPLY_VI) { const x = re.exec(m); if (x) return fn(x); }
  return m;
}

/** How a store countdown ended (DinoGarage garage_store_result reasons). */
export const FINAL_VI: Record<string, string> = {
  moved: 'bạn đã rời khỏi bán kính 5 m',
  damage_dealt: 'bạn đã gây sát thương',
  damage_taken: 'bạn đã chịu sát thương',
  left: 'bạn đã thoát game hoặc dino đã chết',
  not_same_dino: 'không còn là con dino lúc bắt đầu cất',
  full: 'gara đã đầy',
  capture_failed: 'không đọc được trạng thái dino',
  save_failed: 'không lưu được vào gara',
  kill_failed: 'không gỡ được dino khỏi game',
};

/** The member tiers (bridge member-tier.ts), as the garage names them. */
export const GARA_TIER: Record<string, string> = { normal: '👤 Người thường', vip: '⭐ VIP', svip: '💎 SVip', admin: '🛡️ Admin' };

/** The cards of every tier, to see their animations ("Xem hiệu ứng thẻ"); times relative to now (seconds). */
export type DemoSlot = PlayerSlot & { tier: string };
export function demoSlots(nowS = Math.floor(Date.now() / 1000)): DemoSlot[] {
  const s = (slot: string, species: string, growth: number, hoursAgo: number, prime: boolean, elderStacks: number | null, done: number,
    health: number, stamina: number, thirst: number, maxHealth: number, tier: string): DemoSlot => ({
    slot, species, growth, storedAt: nowS - 3600 * hoursAgo, gift: false, prime, elderStacks, skin: null,
    primeTasks: { done, eligible: done >= 10 }, vitals: { health, stamina, thirst }, max: { health: maxHealth, stamina: 100, thirst: 100 }, tier,
  });
  return [
    s('demo-fossil', 'Carnotaurus', 0.65, 3, false, null, 3, 950, 85, 75, 1400, 'fossil'),
    s('demo-amber', 'Stegosaurus', 1, 20, true, null, 10, 3200, 100, 100, 3200, 'amber'),
    s('demo-dna', 'Ceratosaurus', 1, 35, true, 1, 10, 2100, 100, 90, 2100, 'dna'),
    s('demo-rex', 'Tyrannosaurus', 1, 60, true, 2, 10, 5800, 95, 95, 5800, 'rex'),
    s('demo-apex', 'Deinosuchus', 1, 90, true, 3, 10, 8000, 100, 100, 8000, 'apex'),
  ];
}

/** The diet filter's lists (a card matches when its text names one). */
export const CARNIVORES = ['carnotaurus', 'ceratosaurus', 'tyrannosaurus', 't-rex', 'deinosuchus', 'dilophosaurus', 'troodon', 'herrerasaurus', 'pteranodon'];
export const HERBIVORES = ['stegosaurus', 'tenontosaurus', 'pachycephalosaurus', 'gallimimus', 'beipiaosaurus', 'hypsilophodon', 'diabloceratops', 'maiasaura', 'ankylosaurus'];
export type Diet = 'all' | 'carnivore' | 'herbivore';
/** Whether a card (by its shown text) passes the search and the diet tab. */
export function cardMatches(text: string, search: string, diet: Diet): boolean {
  const t = text.toLowerCase();
  if (search && !t.includes(search)) return false;
  if (diet === 'carnivore') return CARNIVORES.some((c) => t.includes(c));
  if (diet === 'herbivore') return HERBIVORES.some((h) => t.includes(h));
  return true;
}
