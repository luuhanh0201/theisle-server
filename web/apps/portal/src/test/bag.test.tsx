import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PlayerMe } from '@isle/api';
import { ToastProvider } from '../app/toast';
import { Bag } from '../features/bag/Bag';
import { LOOT_AT, LOOT_LEN, bagGroups, bagView, dinoSlotChoices, fitMuts, lootStrip, type BagItem, type DinoOptions } from '../features/bag/bag';

// jsdom has no <dialog> methods: open / close as the browser would (the close event too).
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});

const it_ = (x: Partial<BagItem>): BagItem => ({ uid: `u${Math.random()}`, id: 'x', type: 'growth_bag', name: 'Túi', rarity: 'rare', ...x });
const ITEMS: BagItem[] = [
  it_({ uid: 'g1', id: 'grow', name: 'Túi tăng trưởng', amount: 0.1, below: 0.6 }), it_({ uid: 'g2', id: 'grow', name: 'Túi tăng trưởng', amount: 0.1, below: 0.6 }),
  it_({ uid: 'm1', id: 'mut', type: 'mutation', name: 'Hồi máu', mutation: 'Cellular Regeneration', diet: 'all', refusal: null }),
  it_({ uid: 'h1', id: 'herb', type: 'mutation', name: 'Báo bão', mutation: 'Barometric Sensitivity', diet: 'herbivore', refusal: 'mutation ăn cỏ' }),
  it_({ uid: 's1', id: 'skin', type: 'skin', name: 'Stego rêu', species: 'Stegosaurus', skin: { colors: { Body: { r: 0.1, g: 0.3, b: 0.1 } } } }),
  it_({ uid: 'b1', id: 'box', type: 'dino_box', name: 'Hộp dino', pick: 'choose', growthMin: 0.5, growthMax: 1 }),
  it_({ uid: 'd1', id: 'dino', type: 'dino', name: 'Dino', dino: { label: 'Tyrannosaurus', growth: 0.55 } }),
  it_({ uid: 'd2', id: 'dino', type: 'dino', name: 'Dino', dino: { label: 'Stegosaurus', growth: 0.3 } }),
];
const me = (x: Partial<PlayerMe> = {}): PlayerMe => ({
  steamId: '76561198000000013', name: 'Live', online: true, bag: true, items: ITEMS as unknown as PlayerMe['items'],
  dino: { species: 'Tyrannosaurus', growth: 0.35, vitals: {} as never, max: {} as never, skin: null, prime: null, position: null, trail: [] },
  stats: { kills: 0, deaths: 0, spawns: 0, playtime: 0, longestLife: 0, sessions: 0 }, lives: [], garage: [], ...x,
});
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>);

describe('bag helpers', () => {
  it('copies grouped, a dino item each its own (named by species and growth)', () => {
    const g = bagGroups(ITEMS);
    expect(g.find((x) => x.key === 'grow')?.uids).toEqual(['g1', 'g2']);
    expect(g.filter((x) => x.type === 'dino').map((x) => x.name)).toEqual(['Tyrannosaurus 55%', 'Stegosaurus 30%']);
  });
  it('what can be used now, what does not fit, the tabs; an emptied kind falls back to everything', () => {
    const v = bagView(me(), 'usable', '');
    expect(v.shown.map((g) => g.name)).toEqual(['Hộp dino', 'Stegosaurus 30%', 'Tyrannosaurus 55%', 'Hồi máu', 'Túi tăng trưởng']);
    expect(v.mismatch(v.groups.find((g) => g.key === 'herb')!)).toBe(true);
    expect(v.mismatch(v.groups.find((g) => g.key === 'skin')!)).toBe(true);
    expect(v.tabs.map((t) => `${t[0]}:${t[2]}`)).toEqual(['all:7', 'usable:5', 'dino:3', 'mutation:2', 'care:1', 'skin:1']);
    expect(bagView(me(), 'loot', '').filter).toBe('all');
    expect(bagView(me(), 'all', 'báo').shown.map((g) => g.name)).toEqual(['Báo bão']);
    // Out of the game: only what goes into the garage.
    expect(bagView(me({ dino: null }), 'usable', '').shown.map((g) => g.type)).toEqual(['dino_box', 'dino', 'dino']);
  });
  it('a dino item\'s slots: slot 2 / 4 only kinds, female only, not twice; a sex change clears what no longer fits', () => {
    const opts: DinoOptions = { label: 'Rex', growth: 0.8, diet: 'carnivore', openSlots: [1, 2, 3, 4], mutations: [
      { name: 'A' }, { name: 'B', slot2: true }, { name: 'F', femaleOnly: true }] };
    expect(dinoSlotChoices(opts, false, { 1: '', 2: '', 3: '', 4: '' }, 1).map((m) => m.name)).toEqual(['A']);
    expect(dinoSlotChoices(opts, true, { 1: 'A', 2: '', 3: '', 4: '' }, 2).map((m) => m.name)).toEqual(['B', 'F']);
    expect(fitMuts(opts, false, { 1: 'F', 2: 'B', 3: '', 4: '' })).toEqual({ 1: '', 2: 'B', 3: '', 4: '' });
  });
  it('the hòm\'s strip: the prize at its place, a rarer one beside it', () => {
    const pool = [{ itemId: 'a', name: 'A', type: 'food_box', rarity: 'common', qty: 1 }, { itemId: 'b', name: 'B', type: 'prime_ticket', rarity: 'legendary', qty: 1 }];
    const strip = lootStrip(pool, pool[0]!, () => 0.1);
    expect(strip).toHaveLength(LOOT_LEN);
    expect(strip[LOOT_AT]?.itemId).toBe('a');
    expect(strip[LOOT_AT - 1]?.itemId).toBe('b');
  });
});

describe('Túi đồ', () => {
  afterEach(() => vi.unstubAllGlobals());
  const q = (c: HTMLElement, s: string) => c.querySelector(s) as HTMLButtonElement;
  const btnOf = (c: HTMLElement, name: string) => [...c.querySelectorAll('.bag-item')].find((li) => li.querySelector('.nm b')?.textContent === name)?.querySelector('.act button') as HTMLButtonElement;

  it('closed to this account: nothing drawn', () => {
    const { container } = wrap(<Bag me={me({ bag: false })} />);
    expect(container.querySelector('#bag-list')).toBeNull();
    expect(container.querySelector('#bag-dlg')).toBeNull();
  });
  it('cards: counts, kinds under headings, why a card cannot be used', () => {
    const { container } = wrap(<Bag me={me()} />);
    expect(q(container, '#bag-count').textContent).toBe('8 món');
    expect(q(container, '#bag-dino').textContent).toBe('Đang chơi: Tyrannosaurus · 35%');
    expect([...container.querySelectorAll('.bag-sec')].map((x) => x.textContent)).toEqual(['🦖 Dino 3', '🧬 Mutation 2', '🍖 Chăm sóc dino 1', '🎨 Skin 1']);
    expect(btnOf(container, 'Báo bão').disabled).toBe(true);
    expect(container.textContent).toContain('Không dùng được cho Tyrannosaurus: mutation ăn cỏ.');
    expect(container.textContent).toContain('Chỉ mặc được khi đang chơi Stegosaurus.');
    expect(btnOf(container, 'Túi tăng trưởng').textContent).toBe('Dùng');
  });
  it('not in game: the buttons say why; in prison too', () => {
    const { container, rerender } = wrap(<Bag me={me({ dino: null })} />);
    expect(btnOf(container, 'Túi tăng trưởng').textContent).toBe('Vào game để dùng');
    expect(btnOf(container, 'Túi tăng trưởng').title).toBe('Vào game để dùng: điều khiển một con dino trong game');
    expect(btnOf(container, 'Hộp dino').disabled).toBe(false);
    rerender(<QueryClientProvider client={new QueryClient()}><ToastProvider><Bag me={me({ prison: { until: 1 } } as never)} /></ToastProvider></QueryClientProvider>);
    expect(q(container, '#bag-dino').textContent).toBe('⛓️ Bạn đang ở tù: không dùng được vật phẩm.');
  });
  it('a growth bag: the box, refused (kept in the box), then done (the box closes, the answer under the bag)', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u.startsWith('/api/items/preview/')) return new Response(JSON.stringify({ species: 'Tyrannosaurus', growth: 0.35, prime: false, stacks: 0, slots: [{ slot: 1, name: null, value: null, minGrowth: 0.25, open: true }] }));
      if (u === '/api/items/use') { n++; return new Response(`{"id":${n}}`, { status: 202 }); }
      if (u === '/api/command/1') return new Response('{"status":"done","ok":false,"messages":["Không được."]}');
      if (u === '/api/command/2') return new Response('{"status":"done","ok":true,"messages":["Xong rồi."]}');
      return new Response('{}');
    }));
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout'] });
    const { container } = wrap(<Bag me={me()} />);
    await act(async () => { fireEvent.click(btnOf(container, 'Túi tăng trưởng')); });
    await waitFor(() => expect((q(container, '#bag-dlg') as unknown as HTMLDialogElement).open).toBe(true));
    expect(q(container, '#bag-dlg-in').textContent).toContain('Dino đang chơi lớn thêm 10% (35% → 45%)');
    await act(async () => { fireEvent.click(q(container, '#bag-dlg [data-dlg="apply"]')); await vi.advanceTimersByTimeAsync(1500); });
    await waitFor(() => expect(q(container, '#bag-dlg-status').textContent).toBe('❌ Không được. Vật phẩm vẫn còn trong túi.'));
    await act(async () => { fireEvent.click(q(container, '#bag-dlg [data-dlg="apply"]')); await vi.advanceTimersByTimeAsync(1500); });
    await waitFor(() => expect(q(container, '#bag-status').textContent).toBe('✅ Xong rồi.'));
    expect((q(container, '#bag-dlg') as unknown as HTMLDialogElement).open).toBe(false);
    vi.useRealTimers();
  });
  it('a dino item: sex, a mutation per open slot, into the garage', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      if (u.startsWith('/api/items/dino-options/')) return new Response(JSON.stringify({ label: 'Tyrannosaurus', growth: 0.55, diet: 'carnivore', openSlots: [1, 2], mutations: [{ name: 'A', description: 'a' }, { name: 'F', femaleOnly: true }] }));
      if (u === '/api/items/dino') { bodies.push(JSON.parse(String(init?.body))); return new Response('{"species":"Tyrannosaurus","growth":0.55,"female":true,"slot":"7"}'); }
      return new Response('{}');
    }));
    const { container } = wrap(<Bag me={me()} />);
    await act(async () => { fireEvent.click(btnOf(container, 'Tyrannosaurus 55%')); });
    await waitFor(() => expect(q(container, '[data-dino-sex="f"]')).not.toBeNull());
    expect(q(container, '#bag-dlg-in').textContent).toContain('🔒 Mở từ 75% (dino 55%)');
    fireEvent.click(q(container, '[data-dino-sex="f"]'));
    expect(q(container, '[data-dino-sex="f"]').className).toBe('on');
    await act(async () => { fireEvent.click(q(container, '[data-dlg="dino"]')); });
    await waitFor(() => expect(q(container, '#bag-status').textContent).toBe('✅ Đã nhận Tyrannosaurus 55% (cái, đủ nhiệm vụ prime) vào gara ô 7. Vào Gara, respawn đúng loài rồi lấy ra.'));
    expect(bodies[0]).toEqual({ uid: 'd1', female: true, mutations: { 1: '', 2: '', 3: '', 4: '' } });
  });
});
