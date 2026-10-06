import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../app/toast';
import { Shop, shopBlock, shopMax, type Listing, type ShopData } from '../features/shop/Shop';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});

const L = (x: Partial<Listing> & { type?: string; name?: string }): Listing => ({
  id: `sh_${x.name ?? 'a'}`, price: 50, dailyLimit: 5, bought: 0, left: 5,
  item: { id: 'it', type: x.type ?? 'food_box', name: x.name ?? 'Hộp food', rarity: 'common', data: { amount: 0.2 } }, ...x,
});
const DATA: ShopData = { currency: 'Hổ phách', balance: 400, maxQty: 10, listings: [
  L({ name: 'Hộp food' }), L({ name: 'Túi', type: 'growth_bag', price: 300, left: 0 }), L({ name: 'Hộp dino', type: 'dino_box', price: 3000, left: 1, dailyLimit: 1 }),
  L({ name: 'Skin', type: 'skin', price: 100, left: null, dailyLimit: 0, owned: true }),
] };

describe('shop helpers', () => {
  it('why a listing cannot be bought', () => {
    expect(DATA.listings.map((l) => shopBlock(DATA, l))).toEqual([null, 'Hết lượt hôm nay', 'Chưa đủ Hổ phách', 'Đã có']);
    expect(shopBlock({ ...DATA, locked: 'x' }, DATA.listings[0]!)).toBe('🧪 Đang thử nghiệm');
  });
  it('the most at once: the max, what is left today, what the balance pays', () => {
    expect(shopMax(DATA, DATA.listings[0]!)).toBe(5);
    expect(shopMax({ ...DATA, balance: 120 }, DATA.listings[0]!)).toBe(2);
    expect(shopMax({ ...DATA, balance: 10 }, DATA.listings[0]!)).toBe(1);
  });
});

describe('Cửa hàng', () => {
  afterEach(() => { vi.unstubAllGlobals(); location.hash = ''; });
  it('loads when shown; buys with the box; reads again', async () => {
    location.hash = '#shop';
    let balance = 400;
    const buys: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      if (u === '/api/shop') return new Response(JSON.stringify({ ...DATA, balance }));
      if (u === '/api/shop/buy') { buys.push(JSON.parse(String(init?.body))); balance -= 100; return new Response('{"qty":2,"item":"Hộp food","spent":100,"balance":300}'); }
      return new Response('{}');
    }));
    const { container } = render(<QueryClientProvider client={new QueryClient()}><ToastProvider><Shop /></ToastProvider></QueryClientProvider>);
    await waitFor(() => expect(container.querySelector('#shop-bal')?.textContent).toBe('Bạn có400 '));
    const btns = [...container.querySelectorAll('[data-shop-buy]')].map((b) => `${b.textContent}${(b as HTMLButtonElement).disabled ? '(x)' : ''}`);
    expect(btns).toEqual(['Mua', 'Hết lượt hôm nay(x)', 'Chưa đủ Hổ phách(x)', 'Đã có(x)']);
    const input = container.querySelector('.shop-item .act input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input);
    fireEvent.click(container.querySelector('[data-shop-buy]') as HTMLElement);
    expect((container.querySelector('#shop-dlg') as HTMLDialogElement).open).toBe(true);
    expect(container.querySelector('#shop-dlg-in')?.textContent).toContain('Mua 2 × Hộp food');
    expect(container.querySelector('#shop-dlg-in')?.textContent).toContain('Hôm nay còn mua được 3 cái sau lần này.');
    await act(async () => { fireEvent.click(container.querySelector('[data-shop-dlg="buy"]') as HTMLElement); });
    await waitFor(() => expect(container.querySelector('#shop-status')?.textContent).toBe('✅ Đã mua 2 × Hộp food (100 ). Xem trong Túi đồ.'));
    expect(buys).toEqual([{ listing: 'sh_Hộp food', qty: 2 }]);
    expect((container.querySelector('#shop-dlg') as HTMLDialogElement).open).toBe(false);
    await waitFor(() => expect(container.querySelector('#shop-bal')?.textContent).toBe('Bạn có300 '));
    expect(container.querySelector('#global-toast')?.textContent).toBe('✅ Đã mua 2 × Hộp food, xem trong Túi đồ');
  });
  it('locked: the line why, every button off; refused: in the box', async () => {
    location.hash = '#shop';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...DATA, locked: 'Đang thử nghiệm cho SVip.' }))));
    const { container } = render(<QueryClientProvider client={new QueryClient()}><ToastProvider><Shop /></ToastProvider></QueryClientProvider>);
    await waitFor(() => expect(container.querySelector('#shop-status')?.textContent).toBe('🧪 Đang thử nghiệm cho SVip.'));
    expect([...container.querySelectorAll('[data-shop-buy]')].every((b) => (b as HTMLButtonElement).disabled && b.textContent === '🧪 Đang thử nghiệm')).toBe(true);
  });
  it('not logged in: the error, nothing listed', async () => {
    location.hash = '#shop';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"not logged in"}', { status: 401 })));
    const { container } = render(<QueryClientProvider client={new QueryClient()}><ToastProvider><Shop /></ToastProvider></QueryClientProvider>);
    await waitFor(() => expect(container.querySelector('#shop-status')?.textContent).toBe('❌ not logged in'));
    expect(container.querySelector('#shop-list')?.textContent).toBe('Đang tải cửa hàng…');
  });
});
