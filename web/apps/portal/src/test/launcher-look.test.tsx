import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PlayerMe } from '@isle/api';
import { openRules } from '../app/actions';
import { LauncherShell } from '../app/launcher/LauncherShell';
import { LxHome } from '../app/launcher/LxHome';
import { firstPlay, groupOf, type LxView } from '../app/launcher/view';
import { ToastProvider } from '../app/toast';
import { GamePage } from '../pages/game/GamePage';
import { GaraPage } from '../pages/gara/GaraPage';
import { UI_KEY, launcherUi } from '../lib/launcher';

afterEach(() => { delete (window as unknown as { isleLauncher?: unknown }).isleLauncher; localStorage.removeItem(UI_KEY); location.hash = ''; });

describe("the launcher's own look", () => {
  it('only inside the launcher, unless the web look was chosen', () => {
    expect(launcherUi()).toBe(false);
    (window as unknown as { isleLauncher: unknown }).isleLauncher = {};
    expect(launcherUi()).toBe(true);
    localStorage.setItem(UI_KEY, 'web');
    expect(launcherUi()).toBe(false);
    localStorage.setItem(UI_KEY, 'launcher');
    expect(launcherUi()).toBe(true);
  });
  it('the three parts: Trang chủ (with Voice), Trò chơi, Overlay HUD', () => {
    expect((['home', 'voice', 'bag', 'gara', 'map', 'game', 'shop', 'skin', 'ranking', 'overlay'] as LxView[]).map(groupOf))
      .toEqual(['home', 'home', 'play', 'play', 'play', 'play', 'play', 'play', 'play', 'overlay']);
    expect(firstPlay()).toBe('game');
  });
  it('Luật & Dinh Dưỡng: the web menu only, it opens Trang chủ', () => {
    openRules();
    expect(location.hash).toBe('#home');
  });
});

// The launcher's look as the owner laid it out (2026-10-07).
const me = (x: Partial<PlayerMe> = {}): PlayerMe => ({
  steamId: '76561198000000011', name: 'Rex', online: true, dino: null, bag: true, items: [],
  stats: { kills: 0, deaths: 0, spawns: 0, playtime: 0, longestLife: 0, sessions: 0 }, lives: [], garage: [],
  economy: { currency: 'Hổ phách', balance: 100, checkin: { claimed: false, day: 2, rewards: [10, 20, 30, 40, 50, 60, 0], bonusItem: 'Phiếu Prime', minutes: 5, needed: 30, ready: false } },
  ...x,
} as PlayerMe);
const NEWS = [{ id: 'n_2', title: 'Cập nhật 07/10', body: 'Kênh tin mới\nVoice gọn hơn', at: 1_791_300_000 }, { id: 'n_1', title: 'Cập nhật 01/10', body: 'Cũ', at: 1_790_800_000 }];
function inLauncher(answers: Record<string, unknown> = {}) {
  (window as unknown as { isleLauncher: unknown }).isleLauncher = { version: '1.0.36' };
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const body = u in answers ? answers[u] : u === '/api/news' ? { items: NEWS } : u === '/api/server' ? { online: 1, maxPlayers: 100, phase: 'running', name: 'Test' } : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>);

describe("the launcher's look, 2026-10-07", () => {
  afterEach(() => vi.unstubAllGlobals());
  it('Trò chơi: one menu down the side, in the owner\'s order, no Luật & Dinh Dưỡng', async () => {
    inLauncher({ '/api/me': me({ economy: undefined }), '/api/shop': { listings: [] } });
    location.hash = '#ranking';
    const { container } = wrap(<LauncherShell />);
    await waitFor(() => expect(container.querySelector('.lx-side [data-lx-nav="bag"]')).not.toBeNull());
    const labels = [...container.querySelectorAll('.lx-side .lx-side-txt')].map((e) => e.textContent);
    expect(labels.slice(0, 6)).toEqual(['Live Monitor', 'Live Map & Bạn Bè', 'Gara', 'Skin', 'Bảng Xếp Hạng', 'Túi Đồ']);
    expect(container.textContent).not.toContain('Luật & Dinh Dưỡng');
    expect(container.querySelector('.lx-side [data-lx-nav="ranking"]')?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('.lx-subbar, .lx-seg[aria-label="Bản đồ hoặc Dino Live"]')).toBeNull();
    // The voice chip says Voice, not Voice 3D.
    expect(container.querySelector('#lx-voice-chip')?.textContent).toBe('Voice');
  });
  it('Live Monitor: tele and prime in one row, the counts last; Gara without the chat commands', () => {
    inLauncher();
    const game = wrap(<GamePage />);
    const row = game.container.querySelector('.lx-cols-2') as HTMLElement;
    expect(row.querySelector('#game-prime-card')).not.toBeNull();
    expect(row.children).toHaveLength(2);
    // The counts (the last card) come after the row.
    const last = game.container.lastElementChild as HTMLElement;
    expect(last).not.toBe(row);
    expect(row.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    game.unmount();
    const gara = wrap(<GaraPage />);
    expect(gara.container.textContent).not.toContain('Các Lệnh Chat Trực Tuyến');
  });
  it('on the web the pages stay as they were (the chat commands, one card per row)', () => {
    const gara = wrap(<GaraPage />);
    expect(gara.container.textContent).toContain('Các Lệnh Chat Trực Tuyến');
    gara.unmount();
    const game = wrap(<GamePage />);
    expect(game.container.querySelector('.lx-cols-2')).toBeNull();
  });
  it('Trang chủ: Tin cập nhật (the newest open), no live dino card, the check-in in Hổ phách only', async () => {
    inLauncher();
    const { container } = wrap(<LxHome me={me()} />);
    expect(await screen.findByText('Cập nhật 07/10')).toBeInTheDocument();
    expect(container.querySelector('.lx-news-body')?.textContent).toBe('Kênh tin mới\nVoice gọn hơn');
    expect(screen.getByText('Cập nhật 01/10')).toBeInTheDocument();
    expect(container.querySelector('#hub-dino-card')).toBeNull();
    expect(container.textContent).not.toContain('💎');
    expect(container.querySelectorAll('.lx-day-ico img[src="/amber.svg"]')).toHaveLength(6);
    expect(container.textContent).toContain('VOICE GATEWAY');
  });
  it('Tin cập nhật empty: says the next update will be there', async () => {
    inLauncher({ '/api/news': { items: [] } });
    wrap(<LxHome me={me()} />);
    expect(await screen.findByText('Chưa có tin cập nhật nào. Bản cập nhật tới sẽ được báo ở đây.')).toBeInTheDocument();
  });
  it('Trang chủ: the server milestones, as on the web (off: none)', () => {
    inLauncher();
    expect(wrap(<LxHome me={me()} />).container.querySelector('#home-milestones')).toBeNull();
    const milestones = { online: 12, holdMinutes: 5, minPlayMinutes: 60, playMinutes: 70, eligible: true, defs: [
      { id: 'm10', players: 10, amber: 50, items: [], reached: true, reachedAt: 1, claimed: false, heldS: null },
      { id: 'm20', players: 20, amber: 100, items: [], reached: false, reachedAt: null, claimed: false, heldS: null }] };
    const { container } = wrap(<LxHome me={me({ milestones })} />);
    const card = container.querySelector('#home-milestones') as HTMLElement;
    expect(card.textContent).toContain('Đang online 12 / 20 người');
    expect(card.querySelector('[data-milestone=m10]')?.textContent).toBe('Nhận quà');
    expect(card.querySelector('[data-milestone=m20]')).toBeNull();
    expect(card.textContent).toContain('Chưa đạt');
  });
});
