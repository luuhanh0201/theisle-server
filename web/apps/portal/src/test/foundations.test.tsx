import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PlayerMe } from '@isle/api';
import { parseTab } from '../app/router';
import { readLab } from '../lib/lab';
import { updateLabel } from '../lib/launcher';
import { homeRelease } from '../lib/releases';
import { discordOk } from '../app/shell/Header';
import { Sidebar, shopShown } from '../app/shell/Sidebar';
import { DrawerProvider } from '../app/shell/drawer';
import { portalGet, portalPost } from '../lib/http';

const me = (x: Partial<PlayerMe> = {}): PlayerMe => ({
  steamId: '76561198000000011', name: 'Rex', online: false, dino: null,
  stats: { kills: 0, deaths: 0, spawns: 0, playtime: 0, longestLife: 0, sessions: 0 }, lives: [], garage: [], ...x,
});

describe('the site\'s addresses', () => {
  it('reads a page from #hash, home otherwise (app.js switchTab)', () => {
    expect(parseTab('#gara')).toBe('gara');
    expect(parseTab('#overlay')).toBe('overlay');
    expect(parseTab('#nope')).toBe('home');
    expect(parseTab('')).toBe('home');
  });
});

describe('lab mode', () => {
  beforeEach(() => localStorage.clear());
  it('?lab=1 turns it on and is remembered, ?lab=0 off', () => {
    expect(readLab('')).toBe(false);
    expect(readLab('?lab=1')).toBe(true);
    expect(readLab('')).toBe(true);
    expect(readLab('?lab=0')).toBe(false);
    expect(localStorage.getItem('xg.lab')).toBeNull();
  });
});

describe('the launcher update button', () => {
  it('says each phase as before React', () => {
    expect(updateLabel({ phase: 'dev' }).text).toBe('');
    expect(updateLabel({ phase: 'idle', current: '2.8.0' })).toMatchObject({ text: '⟳ Kiểm tra cập nhật', disabled: false, title: 'Đang dùng v2.8.0' });
    expect(updateLabel({ phase: 'checking' }).disabled).toBe(true);
    expect(updateLabel({ phase: 'downloading', version: '2.9.0', percent: 12 })).toMatchObject({ text: 'Đang tải v2.9.0… 12%', disabled: true });
    expect(updateLabel({ phase: 'ready', version: '2.9.0' })).toMatchObject({ text: '⬆ Cập nhật lên v2.9.0', ready: true });
    expect(updateLabel({ phase: 'error', error: 'net' })).toMatchObject({ text: '⚠ Không kiểm tra được · thử lại', title: 'Lỗi: net' });
  });
});

describe('the menu marks', () => {
  it('Trang chủ carries a mark only when its features share one', () => {
    expect(homeRelease(null)).toBe('');
    expect(homeRelease(me({ economy: { currency: 'amber', balance: 0, checkin: {} }, quests: {}, releases: { amber: 'new', quests: 'new' } }))).toBe('new');
    expect(homeRelease(me({ economy: { currency: 'amber', balance: 0, checkin: {} }, quests: {}, releases: { amber: 'new', quests: 'svip' } }))).toBe('');
  });
  it('the shop by its own level, else with Hổ phách (older bridges)', () => {
    expect(shopShown(null)).toBe(false);
    expect(shopShown(me({ shop: {} }))).toBe(true);
    expect(shopShown(me({ shop: null, economy: { currency: 'a', balance: 1, checkin: {} } }))).toBe(false);
    expect(shopShown(me({ economy: { currency: 'a', balance: 1, checkin: {} } }))).toBe(true);
  });
  it('Discord: only an invite link', () => {
    expect(discordOk('https://discord.gg/abc')).toBe(true);
    expect(discordOk('https://discordapp.com/invite/abc')).toBe(true);
    expect(discordOk('https://evil.example/discord.gg')).toBe(false);
    expect(discordOk(null)).toBe(false);
  });
});

describe('the menu', () => {
  const draw = (m: PlayerMe | null) => render(
    <QueryClientProvider client={new QueryClient()}><DrawerProvider><Sidebar me={m} /></DrawerProvider></QueryClientProvider>,
  );
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 }))); });
  afterEach(() => vi.unstubAllGlobals());

  it('a guest: no bag, no shop, garage 0, the download link', () => {
    const { container } = draw(null);
    expect(container.querySelector('[data-nav=bag]')).toBeNull();
    expect(container.querySelector('[data-nav=shop]')).toBeNull();
    expect(container.querySelector('#nav-gara-badge')?.textContent).toBe('0');
    expect(screen.getByText('Tải Launcher').closest('a')?.getAttribute('href')).toBe('/tai.html');
  });
  it('a player: the bag with its count and mark, LIVE lit while playing, friend requests on the map', () => {
    const { container } = draw(me({
      online: true, bag: true, items: [{}, {}], shop: {}, releases: { bag: 'svip' }, friends: { incoming: 3 },
      dino: { species: 'Rex', growth: 1, vitals: {} as never, max: {} as never, skin: null, prime: null, position: null, trail: [] },
      garage: [{} as never],
    }));
    expect(container.querySelector('#nav-bag-badge')?.textContent).toBe('2');
    expect(container.querySelector('[data-nav=bag] .rel-svip')?.textContent).toBe('Ưu tiên');
    expect(container.querySelector('[data-nav=shop]')).not.toBeNull();
    expect(container.querySelector('#nav-dino-badge')?.classList.contains('on')).toBe(true);
    expect(container.querySelector('#nav-map-badge')?.textContent).toBe('3');
    expect(container.querySelector('#nav-gara-badge')?.textContent).toBe('1');
  });
  it('locked friends: no badge', () => {
    const { container } = draw(me({ friends: { incoming: 3, locked: true } }));
    expect(container.querySelector('#nav-map-badge')).toBeNull();
  });
});

describe('talking to the portal', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('a 401 is a guest (null), another refusal its error text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"not logged in"}', { status: 401 })));
    expect(await portalGet('/api/me')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"Bạn chưa có skin này."}', { status: 403 })));
    await expect(portalGet('/api/x')).rejects.toThrow('Bạn chưa có skin này.');
    await expect(portalPost('/api/skin', { item: 'a' })).rejects.toThrow('Bạn chưa có skin này.');
  });
  it('a write is same-origin JSON', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response('{"id":5}', { status: 202 }));
    vi.stubGlobal('fetch', f);
    expect(await portalPost('/api/garage', { action: 'store' })).toEqual({ id: 5 });
    const init = f.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init?.body).toBe('{"action":"store"}');
  });
});
