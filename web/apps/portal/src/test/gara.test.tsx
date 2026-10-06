import { fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PlayerMe, PlayerSlot } from '@isle/api';
import { ToastProvider } from '../app/toast';
import { Garage } from '../features/gara/Garage';
import { cardMatches, demoSlots, replyVi } from '../features/gara/garage';
import { slotTier } from '../lib/dino';

const slot = (x: Partial<PlayerSlot> = {}): PlayerSlot => ({
  slot: 'a', species: 'Tyrannosaurus', growth: 0.7, storedAt: 1_790_000_000, gift: false, skin: null, prime: false, elderStacks: null,
  primeTasks: null, vitals: { health: 500, stamina: null, thirst: 50 }, max: { health: 1000, stamina: null, thirst: null }, ...x,
});
const RULES = { maxSlots: 3, redeemAt: 'current', storeCountdown: 30, cooldown: 180, tier: 'normal', minHealthPct: 0, minGrowthPct: 0 };
const me = (x: Partial<PlayerMe> = {}): PlayerMe => ({
  steamId: '76561198000000013', name: 'Live', online: false, dino: null,
  stats: { kills: 0, deaths: 0, spawns: 0, playtime: 0, longestLife: 0, sessions: 0 }, lives: [], garage: [slot()], garageRules: RULES, ...x,
});
const dino = (growth = 0.8, health = 900) => ({ species: 'Tyrannosaurus', growth, vitals: { health, stamina: 1, hunger: 1, thirst: 1, blood: 1, oxygen: 1 },
  max: { health: 1000, stamina: 1, hunger: 1, thirst: 1, blood: 1, oxygen: 1 }, skin: null, prime: null, position: null, trail: [] });
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>);

describe('garage helpers', () => {
  it('the redeem replies in Vietnamese', () => {
    expect(replyVi('Garage cooldown: wait 42 s.')).toBe('Gara đang hồi: chờ 42 giây.');
    expect(replyVi("Restoring 'a' at the spot you stored it. Stand still.")).toBe('Đang khôi phục tại chỗ đã cất, đứng yên vài giây.');
    expect(replyVi("Restoring 'a'. Stand still.")).toBe('Đang khôi phục, đứng yên vài giây.');
    expect(replyVi('Đứng yên 30 giây')).toBe('Đứng yên 30 giây');
  });
  it('the filter by a card\'s text', () => {
    expect(cardMatches('Tyrannosaurus 🦎 Growth', '', 'carnivore')).toBe(true);
    expect(cardMatches('Tyrannosaurus', '', 'herbivore')).toBe(false);
    expect(cardMatches('Stegosaurus', 'steg', 'herbivore')).toBe(true);
    expect(cardMatches('Stegosaurus', 'rex', 'all')).toBe(false);
  });
  it('the demo cards: one per tier, stored hours ago (seconds)', () => {
    const d = demoSlots(1_000_000);
    expect(d.map((x) => slotTier(x).key)).toEqual(['fossil', 'amber', 'dna', 'rex', 'apex']);
    expect(d[0]?.storedAt).toBe(1_000_000 - 3 * 3600);
    expect(slotTier({ elderStacks: 1 }).key).toBe('dna');
    expect(slotTier({ prime: true }).key).toBe('amber');
  });
});

describe('the garage card', () => {
  afterEach(() => vi.unstubAllGlobals());
  const q = (c: HTMLElement, s: string) => c.querySelector(s) as HTMLButtonElement;
  it('a guest', () => {
    const { container } = wrap(<Garage me={null} />);
    expect(q(container, '#gara-count-tag').textContent).toBe('0 slot');
    expect(q(container, '#gara-store-hint').textContent).toBe('Đăng nhập và vào game để cất / lấy dino.');
    expect(q(container, '#gara-store-btn').disabled).toBe(true);
  });
  it('the store button and its hint, by state', () => {
    const { container, rerender } = wrap(<Garage me={me()} />);
    const re = (m: PlayerMe) => rerender(<QueryClientProvider client={new QueryClient()}><ToastProvider><Garage me={m} /></ToastProvider></QueryClientProvider>);
    expect(q(container, '#gara-store-hint').textContent).toBe('Vào game để cất / lấy dino.');
    expect(q(container, '#gara-tier').textContent).toBe('👤 Người thường: 3 ô, chờ 180 giây giữa 2 lần cất / lấy.');
    expect(q(container, '#gara-count-tag').textContent).toBe('1 / 3');
    re(me({ online: true }));
    expect(q(container, '#gara-store-hint').textContent).toBe('Chọn loài và spawn dino trước.');
    re(me({ online: true, dino: dino(), garage: [slot(), slot({ slot: 'b' }), slot({ slot: 'c' })] }));
    expect(q(container, '#gara-store-hint').textContent).toBe('Gara đã đầy (3), lấy bớt một con ra trước.');
    re(me({ online: true, dino: dino(0.8, 300), garageRules: { ...RULES, minHealthPct: 50 } }));
    expect(q(container, '#gara-store-hint').textContent).toBe('Máu phải từ 50% trở lên mới cất được (đang 30%).');
    expect(q(container, '#gara-store-btn').disabled).toBe(true);
    re(me({ online: true, dino: dino(0.3), garageRules: { ...RULES, minGrowthPct: 50 } }));
    expect(q(container, '#gara-store-hint').textContent).toBe('Dino phải lớn từ 50% trở lên mới cất được (đang 30%).');
    re(me({ online: true, dino: dino(), garageRules: { ...RULES, maxSlots: null, tier: 'svip', redeemAt: 'choice' } }));
    expect(q(container, '#gara-store-btn').disabled).toBe(false);
    expect(q(container, '#gara-count-tag').textContent).toBe('1 / ∞');
    expect(q(container, '#gara-tier').textContent).toContain('💎 SVip: không giới hạn ô');
    expect(container.querySelector('#gara-where-box')).not.toBeNull();
  });
  it('a slot: why it cannot come out, its vitals, a gift', () => {
    const { container, rerender } = wrap(<Garage me={me({ online: true, dino: { ...dino(), species: 'Stegosaurus' }, garage: [slot()] })} />);
    expect(container.querySelector('.garage-slot-card')?.textContent).toContain('Respawn thành Tyrannosaurus để lấy ra');
    expect(q(container, '[data-redeem=a]').disabled).toBe(true);
    // Health 500 of 1000: a bar; thirst without a max: the amount alone, dim; stamina unknown: none.
    const sv = [...container.querySelectorAll('.slot-vitals .sv b')].map((b) => b.textContent);
    expect(sv).toEqual(['500 · 50%', '50']);
    rerender(<QueryClientProvider client={new QueryClient()}><ToastProvider><Garage me={me({ online: true, dino: dino(), garage: [slot({ gift: true, vitals: { health: null, stamina: null, thirst: null } })] })} /></ToastProvider></QueryClientProvider>);
    expect(container.textContent).toContain('Quà Admin');
    expect(container.textContent).toContain('Chỉ số do admin đặt khi tạo.');
    expect(q(container, '[data-redeem=a]').disabled).toBe(false);
  });
  it('a store: accepted, counting down, then failed in game', async () => {
    let polls = 0;
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u === '/api/garage') return new Response('{"id":5,"action":"store"}', { status: 202 });
      if (u === '/api/command/5') { polls++; return new Response(polls < 2 ? '{"status":"done","ok":true,"messages":["Đứng yên"]}' : '{"status":"done","ok":true,"final":{"ok":false,"reason":"damage_taken"}}'); }
      return new Response('{}');
    }));
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'setInterval'] });
    const { container } = wrap(<Garage me={me({ online: true, dino: dino() })} />);
    fireEvent.click(q(container, '#gara-store-btn'));
    await vi.advanceTimersByTimeAsync(1100);
    await waitFor(() => expect(q(container, '#gara-status').textContent).toBe('⏳ Game đã nhận lệnh, đang đếm ngược.Đứng yên'));
    expect(q(container, '#gara-store-hint').textContent).toMatch(/^Đang cất: còn \d+ giây/);
    expect(q(container, '#gara-store-btn').disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1100);
    await waitFor(() => expect(q(container, '#gara-status').textContent).toBe('❌ Cất thất bại: bạn đã chịu sát thương. Bạn có thể cất lại ngay.'));
    expect(q(container, '#gara-store-btn').disabled).toBe(false);
    vi.useRealTimers();
  });
  it('a refusal before the game: the bridge\'s reason; too fast', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"garage is full"}', { status: 409 })));
    const { container } = wrap(<Garage me={me({ online: true, dino: dino() })} />);
    fireEvent.click(q(container, '#gara-store-btn'));
    await waitFor(() => expect(q(container, '#gara-status').textContent).toBe('Không gửi được lệnh: garage is full.'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })));
    fireEvent.click(q(container, '#gara-store-btn'));
    await waitFor(() => expect(q(container, '#gara-status').textContent).toBe('Chậm lại chút: mỗi vài giây chỉ một lệnh.'));
  });
});
