import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PlayerMe } from '@isle/api';
import { ToastProvider } from '../app/toast';
import { Rewards } from '../features/home/Rewards';
import { LauncherHub } from '../features/home/LauncherHub';
import { growthStage, heroTier, pct, tierClasses } from '../lib/dino';

const CK = { claimed: false, day: 7, rewards: [10, 20, 30, 40, 50, 60, 0], bonusItem: 'Phiếu Prime', minutes: 5, needed: 30, ready: false };
const me = (x: Partial<PlayerMe> = {}): PlayerMe => ({
  steamId: '76561198000000011', name: 'Rex', online: false, dino: null,
  stats: { kills: 0, deaths: 0, spawns: 0, playtime: 0, longestLife: 0, sessions: 0 }, lives: [], garage: [], ...x,
});
const BOARD = { isPrime: true, eligible: true, elder: false, elderStacks: 0, met: 6, needed: 5, growth: 0.8, deadline: 0.75, locked: true, conditions: [] };
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>);

describe('dino helpers', () => {
  it('growth stages at 25 / 50 / 75 / 100 %', () => {
    expect(growthStage(null).name).toBe('Sơ sinh');
    expect(growthStage(0.25).icon).toBe('🐣');
    expect(growthStage(0.5).name).toBe('Thiếu niên');
    expect(growthStage(0.7499999).name).toBe('Cận lớn');
    expect(growthStage(1).name).toBe('Trưởng thành');
    expect(pct(0.456)).toBe('46%');
    expect(pct(null)).toBe('0%');
  });
  it('the tier: elder stacks first, then prime', () => {
    expect(heroTier(null).key).toBe('fossil');
    expect(heroTier({ prime: { prime: true } }).key).toBe('amber');
    expect(heroTier({ prime: { elderStacks: 2 } }).key).toBe('rex');
    expect(heroTier({ elderStacks: 5 }).key).toBe('apex');
    expect(tierClasses(heroTier({ prime: { prime: true } }))).toBe('tier-amber prime');
    expect(tierClasses(heroTier({ prime: { elderStacks: 1 } }))).toBe('tier-dna prime');
    expect(tierClasses(heroTier(null))).toBe('tier-fossil');
  });
});

describe('Trang chủ rewards', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('a guest: nothing', () => {
    const { container } = wrap(<Rewards me={null} />);
    expect(container.querySelector('#home-checkin')).toBeNull();
    expect(container.querySelector('#home-amber')).toBeNull();
  });
  it('the check-in: the last day\'s gift, not ready yet, locked note', () => {
    const { container } = wrap(<Rewards me={me({ economy: { currency: 'Hổ phách', balance: 1234, checkin: CK, locked: 'Đang thử nghiệm' } })} />);
    expect(container.querySelector('#home-amber')?.textContent).toContain('1.234');
    expect(container.querySelector('#home-amber')?.textContent).toContain('(thử nghiệm)');
    // Day 7 gives no Hổ phách: the gift in its place.
    const last = container.querySelectorAll('.hr-day')[6];
    expect(last?.className).toBe('hr-day today');
    expect(last?.querySelector('.hr-gift-in')?.getAttribute('title')).toBe('Phiếu Prime');
    expect(container.querySelectorAll('.hr-day.done')).toHaveLength(6);
    expect(screen.getByText('Chơi thêm 25 phút để điểm danh')).toBeDisabled();
    expect(container.querySelector('.hr-note')?.textContent).toBe('🧪 Đang thử nghiệm');
  });
  it('a check-in ready: its reward and the gift on the button; a click posts, toasts, reads /me again', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      calls.push(u);
      return u === '/api/checkin' ? new Response('{"day":3,"reward":30,"balance":60,"item":null}', { status: 200 }) : new Response('{}', { status: 200 });
    }));
    const ready = { ...CK, day: 3, minutes: 40, ready: true };
    const { container } = wrap(<Rewards me={me({ economy: { currency: 'Hổ phách', balance: 30, checkin: ready } })} />);
    const btn = container.querySelector('#home-checkin-btn') as HTMLButtonElement;
    expect(btn.textContent?.replace(/\s+/g, ' ')).toBe('Điểm danh: +30 ');
    expect(btn.className).toBe('btn btn-emerald');
    fireEvent.click(btn);
    await waitFor(() => expect(container.querySelector('#global-toast')?.textContent).toBe('✅ Điểm danh ngày 3: +30 Hổ phách'));
    expect(calls).toEqual(['/api/checkin']);
  });
  it('a refusal says the server\'s reason; no network: "Mất kết nối"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"Hôm nay bạn đã điểm danh rồi."}', { status: 400 })));
    const { container } = wrap(<Rewards me={me({ economy: { currency: 'Hổ phách', balance: 0, checkin: { ...CK, day: 1, ready: true } } })} />);
    fireEvent.click(container.querySelector('#home-checkin-btn') as HTMLElement);
    await waitFor(() => expect(container.querySelector('#global-toast')?.textContent).toBe('❌ Hôm nay bạn đã điểm danh rồi.'));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    fireEvent.click(container.querySelector('#home-checkin-btn') as HTMLElement);
    await waitFor(() => expect(container.querySelector('#global-toast')?.textContent).toBe('❌ Mất kết nối. Thử lại.'));
  });
  it('quests: a done one can be taken, a taken one says so, locked ones not', () => {
    const q = (id: string, done: boolean, claimed = false) => ({ id, label: id, kind: 'play', unit: 'phút', target: 10, progress: done ? 10 : 2.5, reward: 40, done, claimed, period: 'day' });
    const { container, rerender } = wrap(<Rewards me={me({ quests: { daily: [q('a', true), q('b', false), q('c', true, true)], weekly: null } })} />);
    expect((container.querySelector('[data-quest=a]') as HTMLButtonElement).disabled).toBe(false);
    expect((container.querySelector('[data-quest=b]') as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[data-quest=c]')).toBeNull();
    expect(container.textContent).toContain('✓ Đã nhận');
    expect(container.textContent).toContain('2,5/10 phút');
    rerender(<QueryClientProvider client={new QueryClient()}><ToastProvider><Rewards me={me({ quests: { daily: [q('a', true)], weekly: null, locked: 'x' } })} /></ToastProvider></QueryClientProvider>);
    expect((container.querySelector('[data-quest=a]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the launcher hub', () => {
  it('a guest, logged in offline, in the lobby, playing', () => {
    const { container, rerender } = wrap(<LauncherHub me={null} />);
    const q = (s: string) => container.querySelector(s)?.textContent;
    expect(q('#hub-dino-species')).toBe('Chưa vào game');
    expect(q('#hub-dino-growth')).toBe('Growth: 0%');
    expect(container.querySelector('#hub-dino-card')?.className).toBe('hub-card hub-dino-card');
    const re = (m: PlayerMe) => rerender(<QueryClientProvider client={new QueryClient()}><ToastProvider><LauncherHub me={m} /></ToastProvider></QueryClientProvider>);
    re(me({ garage: [{} as never, {} as never] }));
    expect(q('#hub-dino-species')).toBe('Chưa vào server');
    expect(q('#hub-gara-sub')).toBe('2/3 dino');
    expect(container.querySelector('#hub-dino-card')?.className).toBe('hub-card hub-dino-card tier-fossil');
    re(me({ online: true, garageRules: { maxSlots: null, redeemAt: 'current', storeCountdown: 30 }, garage: [{} as never] }));
    expect(q('#hub-dino-badge')).toBe('○ SẢNH CHỜ');
    expect(q('#hub-gara-sub')).toBe('1/∞ dino');
    re(me({ online: true, dino: { species: 'Tyrannosaurus', growth: 0.8, vitals: { health: 500, stamina: 50, hunger: null, thirst: 10, blood: null, oxygen: null },
      max: { health: 1000, stamina: 100, hunger: 100, thirst: 0, blood: null, oxygen: null }, skin: null, prime: BOARD, position: null, trail: [] } }));
    expect(q('#hub-dino-badge')).toBe('● ĐANG CHƠI');
    expect(q('#hub-dino-growth')).toBe('🦕 Growth: 80%');
    expect(q('#hub-val-health')).toBe('500');
    expect((container.querySelector('#hub-fill-health') as HTMLElement).style.width).toBe('50%');
    expect(q('#hub-val-hunger')).toBe('--');
    expect((container.querySelector('#hub-fill-thirst') as HTMLElement).style.width).toBe('0%');
    expect(q('#hub-prime-text')).toBe('👑 Đã đạt danh hiệu Prime');
    // A prime board alone (no elder stack) keeps the plain tier, as before React (getHeroCardTier reads .prime.prime).
    expect(container.querySelector('#hub-dino-card')?.className).toBe('hub-card hub-dino-card tier-fossil');
  });
});
