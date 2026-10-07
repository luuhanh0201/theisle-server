import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PlayerMe } from '@isle/api';
import { ToastProvider } from '../app/toast';
import { SkinStudio } from '../features/skin/SkinStudio';
import {
  SKINS_KEY, applySkin, editorSkin, initialState, loadSaved, parseSkinCode, skinBody, skinCode, speciesLabel, storeSaved, withSaved,
} from '../features/skin/skin';

// The 3D viewer (skin3d.js) as a fake: what the page asks of it is recorded.
const calls: string[] = [];
let models: string[] = ['Carnotaurus', 'Stegosaurus', 'Tyrannosaurus'];
vi.mock('../lib/dino3d', () => {
  const api = () => ({
    ready: Promise.resolve(), species: () => models,
    speciesOf: (raw: string) => models.find((m) => raw.includes(m)) ?? null,
    fromGame: (s: { colors: Record<string, unknown> }) => ({ colors: { Body: '#010203' }, female: false, light: {}, _from: s }),
    create: () => ({
      show: async (sp: string) => { calls.push(`show ${sp}`); return true; },
      setSkin: () => { calls.push('setSkin'); },
      setFemale: (f: boolean) => { calls.push(`female ${f}`); },
    }),
  });
  return {
    loadDino3D: async () => (models.length > 0 ? api() : null),
    dino3dNow: () => api(),
  };
});

const me = (x: Partial<PlayerMe> = {}): PlayerMe => ({
  steamId: '76561198000000013', name: 'Live', online: false, dino: null,
  stats: { kills: 0, deaths: 0, spawns: 0, playtime: 0, longestLife: 0, sessions: 0 }, lives: [], garage: [], ...x,
});
const SKIN = { colors: { Body: { r: 0.3, g: 0.2, b: 0.1 }, Eyes: { r: 0.8, g: 0.6, b: 0.1 } }, patternIndex: 1, themeIndex: 3, variation: 5, female: false };
const dino = (species = 'BP_Tyrannosaurus_C', skin: Record<string, unknown> | null = SKIN) => ({
  species, growth: 0.5, vitals: { health: 1, stamina: 1, hunger: 1, thirst: 1, blood: 1, oxygen: 1 },
  max: { health: 1, stamina: 1, hunger: 1, thirst: 1, blood: 1, oxygen: 1 }, skin, prime: null, position: null, trail: [],
});
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>);
const rewrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient()}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>;

describe('skin helpers', () => {
  it('a code round trip (colours, pattern, theme, variation, effects)', () => {
    const st = applySkin(initialState(), { colors: { Body: '#123456' }, pattern: 2, theme: 7, variation: 12, effects: { Mud: 0.5 } });
    const sk = editorSkin(st);
    expect(sk.effects?.['Mud']).toBe(0.5);
    const back = parseSkinCode(skinCode(sk));
    expect(back?.colors['Body']).toBe('#123456');
    expect([back?.pattern, back?.theme, back?.variation]).toEqual([2, 7, 12]);
    expect(back?.effects?.['Mud']).toBe(0.5);
    expect(skinCode(sk).startsWith('XG1.')).toBe(true);
  });
  it('not a code', () => {
    expect(parseSkinCode('abc')).toBeNull();
    expect(parseSkinCode('XG1.!!')).toBeNull();
    expect(parseSkinCode(`XG1.${btoa(JSON.stringify({ c: { Body: 'zz' } }))}`)).toBeNull();
  });
  it('the editor clamps as before React', () => {
    const sk = editorSkin({ ...initialState(), pattern: 9, theme: -3, variation: 30, glow: 4 });
    expect([sk.pattern, sk.theme, sk.variation, sk.glow, sk.effects]).toEqual([2, 0, 20, 1, null]);
  });
  it('applySkin takes the game\'s linear colours and its index names', () => {
    const st = applySkin(initialState(), SKIN);
    expect(st.colors['Body']).toMatch(/^#[0-9a-f]{6}$/);
    expect([st.pattern, st.theme, st.variation, st.fxOn]).toEqual([1, 3, 5, false]);
  });
  it('the body: plain colours; in lab the effects and keep', () => {
    const sk = editorSkin(applySkin(initialState(), { colors: { Body: '#ffffff' }, effects: { Mud: 0.25 } }));
    const plain = skinBody(sk, false, true);
    expect(plain['keep']).toBeUndefined();
    expect(plain['effects']).toBeUndefined();
    expect((plain['colors'] as Record<string, unknown>)['Body']).toEqual({ r: 1, g: 1, b: 1 });
    const lab = skinBody(sk, true, false);
    expect(lab['keep']).toBe(false);
    expect((lab['effects'] as Record<string, number>)['Mud']).toBe(0.25);
  });
  it('saved skins: newest first, a same name replaced, at most 30 kept', () => {
    localStorage.removeItem(SKINS_KEY);
    let list = withSaved([], 'a', 'XG1.a');
    list = withSaved(list, 'b', 'XG1.b');
    list = withSaved(list, 'a', 'XG1.c');
    expect(list.map((x) => `${x.name}:${x.code}`)).toEqual(['a:XG1.c', 'b:XG1.b']);
    storeSaved(Array.from({ length: 40 }, (_, i) => ({ name: `s${i}`, code: 'x' })));
    expect(loadSaved()).toHaveLength(30);
    localStorage.setItem(SKINS_KEY, '{bad');
    expect(loadSaved()).toEqual([]);
    expect(speciesLabel('BP_Tyrannosaurus_C')).toBe('Tyrannosaurus');
  });
});

describe('Skin Studio', () => {
  beforeEach(() => { calls.length = 0; models = ['Carnotaurus', 'Stegosaurus', 'Tyrannosaurus']; localStorage.removeItem(SKINS_KEY); });
  afterEach(() => vi.unstubAllGlobals());
  const q = (c: HTMLElement, s: string) => c.querySelector(s) as HTMLInputElement;

  it('a guest: the two buttons say why', () => {
    const { container } = wrap(<SkinStudio me={null} />);
    fireEvent.click(q(container, '#btn-load-my-skin'));
    expect(q(container, '#skin-status').textContent).toBe('Chưa có dữ liệu skin của dino đang chơi. Hãy vào game và điều khiển dino.');
    fireEvent.click(q(container, '#btn-skin-apply'));
    expect(q(container, '#skin-status').textContent).toBe('Vào game và điều khiển một con dino để áp dụng. Bạn vẫn chỉnh và xem trước được.');
    expect(q(container, '#skin-status').className).toBe('garage-status bad');
    expect((container.querySelector('#skin-active-swatches-box') as HTMLElement).hidden).toBe(true);
    expect(container.querySelectorAll('#skin-flat > div')).toHaveLength(10);
  });

  it('the 3D preview follows the dino played now; the menu marks it', async () => {
    const { container, rerender } = wrap(<SkinStudio me={me({ online: true, dino: dino('BP_Stegosaurus_C', { ...SKIN, female: true }) })} />);
    await waitFor(() => expect(calls).toContain('show Stegosaurus'));
    // The viewer starts as a male and is told the dino's sex once read: wait for it (failed 1 run in 6 when read at once).
    await waitFor(() => expect(calls).toContain('female true'));
    await waitFor(() => expect((container.querySelector('#skin-3d') as HTMLElement).hidden).toBe(false));
    expect((container.querySelector('#skin-flat') as HTMLElement).hidden).toBe(true);
    expect(container.querySelector('[data-g="f"]')?.getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('[data-region="MaleDisplay"]')?.className).toContain('off');
    expect(container.textContent).toContain('Stegosaurus · đang chơi');
    // A new dino (species) is shown at once.
    calls.length = 0;
    rerender(rewrap(<SkinStudio me={me({ online: true, dino: dino('BP_Tyrannosaurus_C') })} />));
    await waitFor(() => expect(calls).toContain('show Tyrannosaurus'));
    // A colour change repaints.
    calls.length = 0;
    fireEvent.click(container.querySelector('[data-preset="3"]') as HTMLElement);
    expect(calls).toContain('setSkin');
  });

  it('not in game: the first species; no model on the server: the colours side by side', async () => {
    const a = wrap(<SkinStudio me={me()} />);
    await waitFor(() => expect(calls).toContain('show Carnotaurus'));
    a.unmount();
    models = [];
    const { container } = wrap(<SkinStudio me={me()} />);
    await waitFor(() => expect(q(container, '#skin-preview-note').textContent).toBe('Chưa có mô hình 3D trên server, xem màu theo từng ô.'));
    expect((container.querySelector('#skin-flat') as HTMLElement).hidden).toBe(false);
    expect(container.querySelector('#skin-species')).toBeNull();
  });

  it('Lấy màu: through fromGame, with the pattern, theme and variation of the game', () => {
    const { container } = wrap(<SkinStudio me={me({ online: true, dino: dino() })} />);
    expect((container.querySelector('#skin-active-swatches-box') as HTMLElement).hidden).toBe(false);
    expect(container.querySelector('#skin-active-swatches')?.textContent).toContain('Thân: #');
    fireEvent.click(q(container, '#btn-load-my-skin'));
    expect(q(container, '#hex-Body').value).toBe('#010203');
    expect(q(container, '#skin-pattern').value).toBe('1');
    expect(q(container, '#skin-theme').value).toBe('3');
    expect(container.querySelector('#skin-variation-val')?.textContent).toBe('5');
    expect(q(container, '#skin-status').textContent).toBe('Đã lấy màu từ dino đang chơi.');
  });

  it('apply: sent, refused by the game with its message; 429; written', async () => {
    let n = 0;
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      if (u === '/api/skin') {
        bodies.push(JSON.parse(String(init?.body)));
        n++;
        if (n === 2) return new Response('{"error":"too many requests"}', { status: 429 });
        return new Response(`{"id":${n}}`, { status: 202 });
      }
      if (u === '/api/command/1') return new Response('{"status":"done","ok":false,"messages":["Bạn cần đang điều khiển một con dino còn sống để đổi màu."]}');
      if (u === '/api/command/3') return new Response('{"status":"done","ok":true,"messages":["Đã đổi màu dino của bạn."]}');
      return new Response('{}');
    }));
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout'] });
    const { container } = wrap(<SkinStudio me={me({ online: true, dino: dino() })} />);
    const status = () => q(container, '#skin-status');
    fireEvent.click(q(container, '#btn-skin-apply'));
    expect(status().textContent).toBe('Đang gửi…');
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    await waitFor(() => expect(status().textContent).toBe('❌ Bạn cần đang điều khiển một con dino còn sống để đổi màu.'));
    expect(Object.keys((bodies[0] as { colors: object }).colors)).toHaveLength(10);
    expect((bodies[0] as { keep?: boolean }).keep).toBeUndefined();
    fireEvent.click(q(container, '#btn-skin-apply'));
    await waitFor(() => expect(status().textContent).toBe('Chậm lại chút: mỗi vài giây chỉ một lần.'));
    fireEvent.click(q(container, '#btn-skin-apply'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    await waitFor(() => expect(status().textContent).toBe('✅ Đã đổi màu dino của bạn. Nhìn lại dino trong game.'));
    expect(status().className).toBe('garage-status ok');
    expect((q(container, '#btn-skin-apply') as unknown as HTMLButtonElement).disabled).toBe(false);
    vi.useRealTimers();
  });

  it('code out and in, a bad code; saved skins: save, load, delete', async () => {
    const { container } = wrap(<SkinStudio me={me()} />);
    fireEvent.click(container.querySelector('[data-preset="8"]') as HTMLElement);
    fireEvent.click(q(container, '#btn-skin-export'));
    const code = q(container, '#skin-code').value;
    expect(parseSkinCode(code)?.colors['Body']).toBe('#2d5f7a');
    fireEvent.change(q(container, '#skin-code'), { target: { value: 'nope' } });
    fireEvent.click(q(container, '#btn-skin-import'));
    expect(q(container, '#skin-status').textContent).toBe('Mã skin không hợp lệ.');
    fireEvent.change(q(container, '#skin-save-name'), { target: { value: 'Biển' } });
    fireEvent.click(q(container, '#btn-skin-save'));
    expect(container.querySelector('#skin-saved-list')?.textContent).toContain('Biển');
    expect(q(container, '#skin-save-name').value).toBe('');
    fireEvent.click(container.querySelector('[data-preset="0"]') as HTMLElement);
    expect(q(container, '#hex-Body').value).toBe('#3f5a36');
    fireEvent.click(container.querySelector('[data-load="0"]') as HTMLElement);
    expect(q(container, '#hex-Body').value).toBe('#2d5f7a');
    fireEvent.change(q(container, '#skin-code'), { target: { value: code } });
    fireEvent.click(q(container, '#btn-skin-import'));
    expect(q(container, '#skin-status').textContent).toBe('Đã nạp mã skin. Bấm "Áp dụng" để đổi màu trong game.');
    fireEvent.click(container.querySelector('[data-del="0"]') as HTMLElement);
    expect(container.querySelector('#skin-saved-list')?.textContent).toBe('Chưa có skin nào được lưu trên trình duyệt này.');
  });

  it('a typed hex: taken once full, marked while wrong, put back on leaving', () => {
    const { container } = wrap(<SkinStudio me={me()} />);
    const box = q(container, '#hex-Body');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'zzzzzz' } });
    expect(box.className).toContain('bad');
    fireEvent.change(box, { target: { value: '#abcdef' } });
    expect(box.className).not.toContain('bad');
    expect((container.querySelector('#skin-flat > div') as HTMLElement).style.background).toBe('rgb(171, 205, 239)');
    fireEvent.change(box, { target: { value: 'qq' } });
    fireEvent.blur(box);
    expect(box.value).toBe('#abcdef');
  });

  it('kept colours (lab data): a chip per species, ✕ lets it go, the line stays', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}')));
    const kept = { BP_Tyrannosaurus_C: { colors: { Body: { r: 1, g: 0, b: 0 } } } };
    const { container } = wrap(<SkinStudio me={me({ keptSkins: kept })} />);
    expect(container.querySelector('#skin-kept')?.textContent).toContain('Tyrannosaurus');
    fireEvent.click(container.querySelector('[data-forget]') as HTMLElement);
    await waitFor(() => expect(container.querySelector('.kept-chip')).toBeNull());
    expect(container.querySelector('#skin-kept')?.textContent).toBe('Đang giữ màu cho:');
    expect(q(container, '#skin-status').textContent).toBe('Đã bỏ giữ màu cho loài đó.');
    expect(JSON.parse(String((fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]?.[1].body))).toEqual({ forget: 'BP_Tyrannosaurus_C' });
  });
});
