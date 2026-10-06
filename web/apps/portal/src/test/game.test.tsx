import { fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PlayerMe, TeleView } from '@isle/api';
import { ToastProvider } from '../app/toast';
import { DinoHero, prisonDur, vitalView } from '../features/game/DinoHero';
import { PrimeCard } from '../features/game/PrimeCard';
import { Stats, dur } from '../features/game/Stats';
import { Tele, cleanCode } from '../features/game/Tele';

const VIT = { health: 600, stamina: 80, hunger: 20, thirst: 50, blood: 100, oxygen: null };
const MAX = { health: 1000, stamina: 100, hunger: 100, thirst: 0, blood: 100, oxygen: 100 };
const BOARD = { isPrime: false, eligible: true, elder: false, elderStacks: 2, met: 6, needed: 5, growth: 0.8, deadline: 0.75, locked: true,
  conditions: [{ n: 1, label: 'Sanctuary', passive: false, met: true }, { n: 2, label: 'Tổ', passive: true, met: false }, { n: 3, label: '?', passive: false, met: null }] };
const TELE: TeleView = { maxGrowthPct: 40, targetMaxGrowthPct: 40, codeMinutes: 5, countdownS: 5, combatS: 60, cooldownS: 60, code: null, cooldownLeft: 0 };
const me = (x: Partial<PlayerMe> = {}): PlayerMe => ({
  steamId: '76561198000000013', name: 'Live', online: false, dino: null,
  stats: { kills: 3, deaths: 1, spawns: 4, playtime: 3725, longestLife: 61, sessions: 2 }, lives: [], garage: [], ...x,
});
const playing = (x: Partial<PlayerMe> = {}): PlayerMe => me({ online: true, dino: { species: 'Tyrannosaurus', growth: 0.35, vitals: VIT, max: MAX, skin: null, prime: BOARD, position: null, trail: [] }, ...x });
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>);

describe('Dino Live helpers', () => {
  it('a vital: amount / max, dim without a max, low under 25 %', () => {
    expect(vitalView(600, 1000)).toEqual({ val: '600 / 1000', width: '60.0%', opacity: '1', low: false });
    expect(vitalView(20, 100).low).toBe(true);
    expect(vitalView(50, 0)).toEqual({ val: '50', width: '100%', opacity: '0.4', low: false });
    expect(vitalView(null, 100).val).toBe('?');
  });
  it('times as the site says them', () => {
    expect(prisonDur(30)).toBe('1 phút');
    expect(prisonDur(3600)).toBe('1 giờ');
    expect(prisonDur(3900)).toBe('1 giờ 5 phút');
    expect(dur(3725)).toBe('1g 2p');
    expect(dur(61)).toBe('1p 1s');
  });
  it('a tele code as typed', () => { expect(cleanCode('ab-c1!é ')).toBe('AB-C1 '); });
});

describe('the dino card', () => {
  it('a guest, logged in not in game, playing', () => {
    const { container, rerender } = wrap(<DinoHero me={null} />);
    const q = (s: string) => container.querySelector(s);
    expect(q('#game-dino-species')?.textContent).toBe('Chưa vào game');
    expect(q('#game-hero-card')?.className).toBe('dino-hero-card');
    expect((q('#game-dino-tier-badge') as HTMLElement).hidden).toBe(true);
    expect(q('#game-vitals')?.children).toHaveLength(0);
    const re = (m: PlayerMe) => rerender(<QueryClientProvider client={new QueryClient()}><ToastProvider><DinoHero me={m} /></ToastProvider></QueryClientProvider>);
    re(me());
    expect(q('#game-dino-species')?.textContent).toBe('Chưa vào server');
    expect(q('#game-dino-growth')?.textContent).toBe('🥚 Growth: 0%');
    expect(q('#game-vitals')?.textContent).toBe('Chưa có chỉ số sinh tồn của dino.');
    expect(q('#game-dino-tier-badge')?.textContent).toBe('F0');
    re(me({ online: true }));
    expect(q('#game-dino-species')?.textContent).toBe('Đang chọn loài');
    re(playing());
    expect(q('#game-dino-species')?.textContent).toBe('Tyrannosaurus');
    expect(q('#game-dino-growth')?.textContent).toBe('🐣 Growth: 35%');
    expect(q('#game-dino-growth')?.getAttribute('title')).toBe('Con non');
    expect((q('#game-growth-fill') as HTMLElement).style.width).toBe('35%');
    expect(q('[data-v=hunger]')?.className).toBe('vital-card low');
    expect(q('[data-v=thirst] .vital-val')?.textContent).toBe('50');
    // Two elder stacks: the rex tier, its flames, its F3 badge.
    expect(q('#game-hero-card')?.className).toBe('dino-hero-card tier-rex prime');
    expect(q('#game-hero-fx .tier-rex-fx')).not.toBeNull();
    expect(q('#game-dino-tier-badge')?.getAttribute('title')).toBe('F3 · Prime đời 3');
  });
  it('the prison banner', () => {
    const { container } = wrap(<DinoHero me={playing({ prison: { escaped: true, remainingSec: 600, offense: 'Giết người', reason: 'x' } })} />);
    expect(container.querySelector('#game-prison')?.className).toBe('prison-banner escaped');
    expect(container.querySelector('#game-prison')?.textContent).toContain('Án còn 10 phút');
  });
});

describe('prime and counts', () => {
  it('the board: met, verdict, the deadline passed, unknown conditions', () => {
    const { container } = wrap(<PrimeCard me={playing()} />);
    expect(container.querySelector('.prime-summary')?.textContent).toContain('6 / 10 điều kiện đạt');
    expect(container.querySelector('.prime-summary .tag')?.textContent).toBe('Game: Đủ điều kiện Prime');
    expect(container.textContent).toContain('Growth 80%: Đã qua mốc 75%: Kết quả Prime đã chốt.');
    expect([...container.querySelectorAll('.quest-check')].map((e) => e.textContent)).toEqual(['✓', '2', '?']);
    expect(container.textContent).toContain('(thụ động: mặc định đạt nếu không vi phạm)');
  });
  it('the counts', () => {
    const { container } = wrap(<Stats me={me()} />);
    expect(container.querySelectorAll('#game-stats-grid > div')).toHaveLength(6);
    expect(container.textContent).toContain('1g 2p');
  });
});

describe('tele con non', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('hidden without tele; locked; not in game; too big; cooling down', () => {
    const { container, rerender } = wrap(<Tele me={me()} />);
    expect((container.querySelector('#game-tele-card') as HTMLElement).hidden).toBe(true);
    const re = (m: PlayerMe) => rerender(<QueryClientProvider client={new QueryClient()}><ToastProvider><Tele me={m} /></ToastProvider></QueryClientProvider>);
    const q = (s: string) => container.querySelector(s) as HTMLInputElement;
    re(me({ tele: { ...TELE, locked: 'Đang thử nghiệm' } }));
    expect(q('#tele-code-meta').textContent).toBe('Đang thử nghiệm, chưa dùng được.');
    expect(q('#tele-locked').textContent).toBe('🧪 Đang thử nghiệm');
    expect(q('#tele-go').disabled).toBe(true);
    re(me({ tele: TELE }));
    expect(q('#tele-code-meta').textContent).toBe('Vào game và điều khiển dino để lấy mã.');
    expect(q('#tele-input').disabled).toBe(true);
    expect(q('#tele-sub').textContent).toBe('Cả hai dino từ 40% trở xuống · đứng yên 5 giây, không giao tranh trong 60 giây trước đó');
    re(playing({ tele: { ...TELE, maxGrowthPct: 30, targetMaxGrowthPct: 30 } }));
    expect(q('#tele-go-meta').textContent).toBe('Dino của bạn 35%: chỉ dino từ 30% trở xuống mới tele được.');
    expect(q('#tele-get').disabled).toBe(true);
    re(playing({ tele: { ...TELE, cooldownLeft: 12 } }));
    expect(q('#tele-go-meta').textContent).toBe('Tele đang hồi: chờ 12 giây.');
    expect(q('#tele-get').disabled).toBe(false);
  });
  it('a code: time left, Đổi mã, in use', () => {
    const exp = Math.floor(Date.now() / 1000) + 125;
    const { container, rerender } = wrap(<Tele me={playing({ tele: { ...TELE, code: { code: 'AB12CD', expiresAt: exp } } })} />);
    const q = (s: string) => container.querySelector(s) as HTMLButtonElement;
    expect(q('#tele-code-text').textContent).toBe('AB12CD');
    expect(q('#tele-get').textContent).toBe('Đổi mã');
    expect(q('#tele-code-meta').textContent).toMatch(/^Hết hạn sau 2:0[45] · dùng được 1 lần/);
    rerender(<QueryClientProvider client={new QueryClient()}><ToastProvider><Tele me={playing({ tele: { ...TELE, code: { code: 'AB12CD', expiresAt: exp, inUse: true } } })} /></ToastProvider></QueryClientProvider>);
    expect(q('#tele-code-meta').textContent).toBe('Có người đang dùng mã này, chờ vài giây…');
    expect(q('#tele-get').disabled).toBe(true);
    expect(q('#tele-drop').hidden).toBe(true);
  });
  it('going: refused by the game, with its messages; then the countdown fails', async () => {
    let polls = 0;
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u === '/api/tele') return new Response('{"id":9,"to":"Rex","countdownS":0}', { status: 202 });
      if (u === '/api/command/9') { polls++; return new Response(polls < 2 ? '{"status":"pending"}' : '{"status":"done","ok":true,"messages":["Đứng yên"],"final":{"ok":false,"reason":"moved"}}'); }
      return new Response('{}');
    }));
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout'] });
    const { container } = wrap(<Tele me={playing({ tele: TELE })} />);
    fireEvent.change(container.querySelector('#tele-input') as HTMLElement, { target: { value: 'ab12cd' } });
    expect((container.querySelector('#tele-input') as HTMLInputElement).value).toBe('AB12CD');
    fireEvent.submit(container.querySelector('#tele-form') as HTMLElement);
    await vi.advanceTimersByTimeAsync(5000);
    await waitFor(() => expect(container.querySelector('#tele-status')?.textContent).toBe('❌ Tele thất bại: bạn đã rời khỏi bán kính 5 m. Mã vẫn dùng được nếu chưa hết hạn.'));
    expect(container.querySelector('#tele-status')?.className).toBe('garage-status bad');
    vi.useRealTimers();
  });
});
