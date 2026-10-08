import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { PlayerMe } from '@isle/api';
import { Overlay } from '../features/overlay/Overlay';

// The map (map.js) is not drawn in jsdom: the service's view of it, faked.
const painted: unknown[] = [];
const updated: unknown[] = [];
let made = false;
vi.mock('../lib/mapService', () => {
  const map = { getTarget: () => ({ x: 1, y: 2 }), update: (d: unknown) => updated.push(d), paintMini: (...a: unknown[]) => { painted.push(a[1]); return false; } };
  return {
    getMap: () => { made = true; return { map, root: document.createElement('div') }; },
    mapIfMade: () => (made ? map : null),
    mapData: () => ({ ai: [1], fish: [], escapees: [], aiZones: null, heat: null, friends: null }),
    loadAi: async () => undefined, loadAiZones: async () => undefined, loadHeat: async () => undefined, setFriendSpots: () => undefined,
  };
});
vi.mock('@portal/map', () => ({ loadWaypoints: () => ({ target: null, saved: [] }) }));

const W = (x: Record<string, unknown> = {}) => ({ enabled: true, scale: 100, bg: 60, opacity: 100, show: { speakers: true, ai: true }, ...x });
const SETTINGS = { enabled: true, widgets: { voice: W({ style: 'full', autoHide: 'idle', maxSpeakers: 3 }), map: W({ radius: 500, shape: 'circle', rotate: 'north' }), dino: W({ layout: 'bars' }), quests: W({ enabled: false }) } };
function stubLauncher() {
  const calls: string[] = [];
  let s = JSON.parse(JSON.stringify(SETTINGS)) as typeof SETTINGS;
  const l = {
    keyLabel: (k: string) => ({ overlay: 'F8', edit: 'F9', bigmap: 'M' }[k] ?? '?'),
    captureKey: async (k: string) => { calls.push(`capture ${k}`); return k === 'edit' ? { error: 'Phím này đã dùng' } : null; },
    overlayGet: () => ({ settings: JSON.parse(JSON.stringify(s)), editing: false }),
    overlaySet: async (p: Record<string, unknown>) => {
      calls.push(`set ${JSON.stringify(p)}`);
      if (typeof p['enabled'] === 'boolean' && !p['widget']) s = { ...s, enabled: p['enabled'] as boolean };
      else if (typeof p['widget'] === 'string') {
        const { widget, show, ...rest } = p as { widget: keyof typeof s.widgets; show?: Record<string, boolean> };
        s.widgets[widget] = { ...s.widgets[widget], ...rest, show: { ...s.widgets[widget].show, ...(show ?? {}) } } as never;
      }
      return JSON.parse(JSON.stringify(s));
    },
    overlayLayout: () => ({ displays: [{ id: 'primary', bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
      widgets: Object.fromEntries(Object.entries(s.widgets).map(([id, w], i) => [id, { enabled: w.enabled, scale: w.scale, bounds: { x: i * 300, y: 0, width: 260, height: 140 } }])) }),
    overlayPlace: () => undefined, overlayPreview: () => calls.push('preview'), overlayEdit: (on: boolean) => calls.push(`edit ${on}`),
    gameModeGet: () => ({ on: false, keep: { map: true } }), gameModeKeep: (k: unknown) => calls.push(`keep ${JSON.stringify(k)}`),
    onOverlayChanged: () => undefined,
  };
  (window as unknown as { isleLauncher: unknown }).isleLauncher = l;
  return calls;
}
afterEach(() => { delete (window as unknown as { isleLauncher?: unknown }).isleLauncher; });

describe('Overlay page', () => {
  it('a browser: only a preview', () => {
    const { container } = render(<Overlay />);
    expect((container.querySelector('#ov-web') as HTMLElement).hidden).toBe(false);
    expect((container.querySelector('#ov-app') as HTMLElement).hidden).toBe(true);
    expect(container.querySelector('#ov-tabs')?.children).toHaveLength(0);
  });
  it('in the launcher: tabs, a change sent (grouped), the overlay off, edit, a key taken, game mode', async () => {
    const calls = stubLauncher();
    const { container } = render(<Overlay />);
    expect((container.querySelector('#ov-app') as HTMLElement).hidden).toBe(false);
    expect([...container.querySelectorAll('#ov-tabs button')].map((b) => b.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
    expect(container.querySelectorAll('#ov-stage .ov-box')).toHaveLength(3);
    fireEvent.click(container.querySelector('[data-choice="style"][data-value="compact"]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-choice="autoHide"][data-value="never"]') as HTMLElement);
    await waitFor(() => expect(calls).toContain('set {"widget":"voice","style":"compact","show":{},"autoHide":"never"}'));
    expect(container.querySelector('[data-choice="style"][data-value="compact"]')?.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(container.querySelector('#ov-tabs [data-tab="map"]') as HTMLElement);
    expect(container.querySelector('#ov-panel')?.textContent).toContain('Tầm nhìn quanh dino');
    await act(async () => { fireEvent.click(container.querySelector('#ov-enabled') as HTMLElement); });
    await waitFor(() => expect(container.querySelector('#ov-stage .ov-empty')?.textContent).toBe('Overlay đang tắt.'));
    fireEvent.click(container.querySelector('#ov-drag') as HTMLElement);
    expect(container.querySelector('#ov-drag')?.textContent).toBe('✓ Xong chỉnh (F9)');
    await act(async () => { fireEvent.click(container.querySelector('#ov-edit-key') as HTMLElement); });
    await waitFor(() => expect(container.querySelector('#ov-edit-key-name')?.textContent).toBe('Phím này đã dùng'));
    const keep = [...container.querySelectorAll('#ov-gm-keep input')] as HTMLInputElement[];
    expect(keep.map((i) => i.checked)).toEqual([false, true, false, false]);
    fireEvent.click(keep[2] as HTMLElement);
    expect(calls).toContain('keep {"dino":true}');
    expect(calls).toContain('edit true');
  });
});

describe('the overlay service', () => {
  it('each /api/me: the dino to the overlay; the mini map drawn while it is on', async () => {
    const games: Array<Record<string, unknown>> = [];
    (window as unknown as { isleLauncher: unknown }).isleLauncher = {
      overlayGame: (g: Record<string, unknown>) => games.push(g), overlayMiniFrame: () => undefined,
      overlayGet: () => ({ settings: SETTINGS, sizes: { map: [200, 200] } }), onOverlayChanged: () => undefined,
      gameModeGet: () => ({ on: false, keep: {} }), onGameMode: () => undefined, onBigMap: () => undefined,
    };
    const { startOverlay, resetOverlayForTests, overlayStateForTests } = await import('../lib/overlay');
    resetOverlayForTests();
    const qc = new QueryClient();
    startOverlay(qc);
    expect(overlayStateForTests()).toEqual({ miniMapOn: true, miniMapAi: true, bigMapOpen: false });
    const me = { name: 'Live', online: true, dino: { species: 'Tyrannosaurus', growth: 0.35, vitals: {}, max: {}, position: { x: 1, y: 2, z: 0, yaw: 0 }, trail: [], prime: null } } as unknown as PlayerMe;
    await qc.fetchQuery({ queryKey: ['/api/me'], queryFn: async () => me });
    // The first time the map is not made yet: the saved target (none here).
    expect(games.at(-1)).toMatchObject({ player: { name: 'Live', online: true }, dino: { species: 'Tyrannosaurus', growth: 0.35 }, ai: [1], target: null });
    await qc.fetchQuery({ queryKey: ['/api/me'], queryFn: async () => ({ ...me }), staleTime: 0 });
    expect(games.at(-1)).toMatchObject({ target: { x: 1, y: 2 } });
    expect(updated.at(-1)).toMatchObject({ species: 'Tyrannosaurus' });
    expect(painted.at(-1)).toMatchObject({ width: 200, height: 200, radiusM: 500, rotate: 'north', shape: 'circle' });
    await qc.fetchQuery({ queryKey: ['/api/me'], queryFn: async () => null });
    expect(games.at(-1)).toMatchObject({ player: null, dino: null });
  });

  it('launcher 1.0.39+: the mini map as a v2 picture (north up, wider, no arrow); before: as it was', async () => {
    const send = async (v2: boolean, rotate: string) => {
      painted.length = 0;
      const settings = { ...SETTINGS, widgets: { ...SETTINGS.widgets, map: W({ radius: 500, shape: 'circle', rotate }) } };
      (window as unknown as { isleLauncher: unknown }).isleLauncher = {
        overlayGame: () => undefined, overlayMiniFrame: () => undefined, ...(v2 ? { overlayMiniV2: true } : {}),
        overlayGet: () => ({ settings, sizes: { map: [200, 200] } }), onOverlayChanged: () => undefined,
        gameModeGet: () => ({ on: false, keep: {} }), onGameMode: () => undefined, onBigMap: () => undefined,
      };
      const { startOverlay, resetOverlayForTests } = await import('../lib/overlay');
      resetOverlayForTests();
      const qc = new QueryClient();
      startOverlay(qc);
      const me = { name: 'Live', online: true, dino: { species: 'Tyrannosaurus', growth: 0.35, vitals: {}, max: {}, position: { x: 1, y: 2, z: 0, yaw: 0 }, trail: [], prime: null } };
      await qc.fetchQuery({ queryKey: ['/api/me'], queryFn: async () => me });
      return painted.at(-1);
    };
    expect(await send(false, 'heading')).toMatchObject({ width: 200, height: 200, radiusM: 500, rotate: 'heading', plain: false, room: 1 });
    // Turned by the widget: wide enough for its corners when turned (1.5), the same scale (750 m over 300 px).
    expect(await send(true, 'heading')).toMatchObject({ width: 300, height: 300, radiusM: 750, plain: true, room: 1.5 });
    expect(await send(true, 'north')).toMatchObject({ width: 240, height: 240, radiusM: 600, plain: true, room: 1.2 });
  });
});
