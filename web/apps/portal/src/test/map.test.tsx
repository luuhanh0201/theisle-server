import { fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PlayerMe } from '@isle/api';
import { ToastProvider } from '../app/toast';

// map.js draws on a canvas (none in jsdom): a stand-in that records what it is told.
const calls: Array<[string, unknown]> = [];
vi.mock('@portal/map', () => ({
  createMap: (root: HTMLElement) => {
    root.className = 'fake-map';
    const rec = (name: string) => (v: unknown) => { calls.push([name, v]); };
    return { update: rec('update'), setFriends: rec('setFriends'), setAi: rec('setAi'), setFish: rec('setFish'), setEscapees: rec('setEscapees'),
      setAiZones: rec('setAiZones'), setHeat: rec('setHeat'), focus: rec('focus'), onTargetChange: () => undefined };
  },
}));
const { MapCard } = await import('../features/map/MapCard');
const { Friends, fmtDist } = await import('../features/map/Friends');
const { resetMapForTest } = await import('../lib/mapService');

const me = (x: Partial<PlayerMe> = {}): PlayerMe => ({
  steamId: '1', name: 'A', online: true, dino: null, stats: { kills: 0, deaths: 0, spawns: 0, playtime: 0, longestLife: 0, sessions: 0 }, lives: [], garage: [], ...x,
});
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>);
const FR = { friends: [{ ref: 'r1', name: 'Rex', online: true, species: 'Tyrannosaurus', pos: { x: 150000, y: 0 } }, { ref: 'r2', name: 'Off', online: false }],
  incoming: [{ ref: 'r3', name: 'Asker', online: true }], outgoing: [] };

beforeEach(() => { calls.length = 0; resetMapForTest(); location.hash = '#map'; });
afterEach(() => vi.unstubAllGlobals());

describe('the map card', () => {
  it('a guest: no map; logged in: the map, told the dino, its status', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    const { container, rerender } = wrap(<MapCard me={null} />);
    expect(container.querySelector('#map')?.children).toHaveLength(0);
    expect(container.querySelector('#map-status-tag')?.textContent).toBe('Live tracking');
    rerender(<QueryClientProvider client={new QueryClient()}><ToastProvider><MapCard me={me()} /></ToastProvider></QueryClientProvider>);
    expect(container.querySelector('#map .fake-map')).not.toBeNull();
    expect(container.querySelector('#map-status-tag')?.className).toBe('tag warning');
    expect(calls.some(([n, v]) => n === 'update' && v === null)).toBe(true);
    const dino = { species: 'Rex', growth: 1, vitals: {} as never, max: {} as never, skin: null, prime: null, position: { x: 1, y: 2, z: 0, yaw: 0 }, trail: [] };
    rerender(<QueryClientProvider client={new QueryClient()}><ToastProvider><MapCard me={me({ dino })} /></ToastProvider></QueryClientProvider>);
    expect(container.querySelector('#map-status-tag')?.textContent).toBe('Dino trực tuyến');
    expect(calls.filter(([n]) => n === 'update').at(-1)?.[1]).toBe(dino);
  });
});

describe('Kết bạn', () => {
  it('distances', () => { expect(fmtDist(850)).toBe('850 m'); expect(fmtDist(1500)).toBe('1,5 km'); });
  it('hidden without the feature; locked: the note, no search', () => {
    const { container, rerender } = wrap(<Friends me={me()} />);
    expect((container.querySelector('#map-friends') as HTMLElement).hidden).toBe(true);
    rerender(<QueryClientProvider client={new QueryClient()}><ToastProvider><Friends me={me({ friends: { incoming: 0, locked: 'Đang thử nghiệm' } })} /></ToastProvider></QueryClientProvider>);
    expect(container.querySelector('#fr-locked')?.textContent).toBe('🧪 Đang thử nghiệm');
    expect((container.querySelector('#fr-q') as HTMLInputElement).disabled).toBe(true);
  });
  it('the lists every 2 s on the map page; friends on the map; a request accepted', async () => {
    const posts: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      if (u === '/api/friends' && init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return new Response('{"ok":true}'); }
      if (u === '/api/friends') return new Response(JSON.stringify(FR));
      return new Response('{}');
    }));
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'setTimeout'] });
    const { container } = wrap(<Friends me={me({ friends: { incoming: 1 }, dino: { species: 'X', growth: 1, vitals: {} as never, max: {} as never, skin: null, prime: null, position: { x: 0, y: 0, z: 0, yaw: 0 }, trail: [] } })} />);
    await vi.advanceTimersByTimeAsync(2100);
    await waitFor(() => expect(container.querySelector('#fr-count')?.textContent).toBe('2 bạn'));
    expect(container.textContent).toContain('Lời mời kết bạn (1)');
    expect(container.textContent).toContain('Tyrannosaurus · cách 1,5 km');
    expect(container.textContent).toContain('Offline');
    expect(calls.find(([n]) => n === 'setFriends')).toBeUndefined();
    fireEvent.click(container.querySelector('[data-fr=accept]') as HTMLElement);
    await waitFor(() => expect(container.querySelector('#global-toast')?.textContent).toBe('✅ Đã kết bạn'));
    expect(posts).toEqual([{ action: 'accept', ref: 'r3' }]);
    // Remove: a second click within 4 s.
    fireEvent.click(container.querySelector('[data-fr=ask-remove][data-ref=r1]') as HTMLElement);
    expect(container.querySelector('[data-fr=remove]')?.textContent).toBe('Bấm lần nữa để huỷ');
    await vi.advanceTimersByTimeAsync(4100);
    await waitFor(() => expect(container.querySelector('[data-fr=remove]')).toBeNull());
    vi.useRealTimers();
  });
  it('a search: no one; a refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u.startsWith('/api/friends/search') ? new Response('{"results":[]}') : new Response(JSON.stringify(FR)))));
    const { container } = wrap(<Friends me={me({ friends: { incoming: 0 } })} />);
    fireEvent.change(container.querySelector('#fr-q') as HTMLElement, { target: { value: 'nobody' } });
    fireEvent.submit(container.querySelector('#fr-search') as HTMLElement);
    await waitFor(() => expect(container.querySelector('#fr-results')?.textContent).toContain('Không tìm thấy ai.'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"too many requests"}', { status: 429 })));
    fireEvent.submit(container.querySelector('#fr-search') as HTMLElement);
    await waitFor(() => expect(container.querySelector('#global-toast')?.textContent).toBe('❌ too many requests'));
  });
});
