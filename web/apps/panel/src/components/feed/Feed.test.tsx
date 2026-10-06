import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Feed } from './Feed';
import type { FeedEvent } from './describe';

const death: FeedEvent = { id: 7, t: 1_791_296_000, type: 'death', steamId: '76561198000000012', name: 'Carno', species: 'BP_Carnotaurus_C', growth: 0.8,
  killer: '76561198000000011', killerName: 'Rex', killerSpecies: 'BP_Tyrannosaurus_C', attributed: true, lastHit: 350, lifeSeconds: 35, loc: { x: 148697, y: 349211 } };
const bite: FeedEvent = { id: 6, t: 1_791_295_990, type: 'damage', attacker: '76561198000000011', attackerName: 'Rex', victim: '76561198000000012', victimName: 'Carno',
  attackerSpecies: 'BP_Tyrannosaurus_C', victimSpecies: 'BP_Carnotaurus_C', amount: 350, ticks: 3 };

function show(events: FeedEvent[]) {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => new Response(JSON.stringify(u.includes('kill-scene') ? { error: 'x' } : u.includes('catalog') ? { species: [] } : { reference: [], notes: {} }),
    { status: u.includes('kill-scene') ? 404 : 200, headers: { 'content-type': 'application/json' } })));
  return render(<QueryClientProvider client={new QueryClient()}><Feed events={events} /></QueryClientProvider>);
}
afterEach(() => vi.unstubAllGlobals());

test('a kill: killer and victim linked to their pages, the line under it, the growth as the value', () => {
  show([death]);
  const li = screen.getByText('đã giết', { exact: false }).closest('li')!;
  expect(within(li).getByRole('link', { name: 'Rex' })).toHaveAttribute('href', '#player/76561198000000011');
  expect(within(li).getByRole('link', { name: 'Carno' })).toHaveAttribute('href', '#player/76561198000000012');
  expect(li).toHaveTextContent('Tyrannosaurus giết Carnotaurus 80% · đòn cuối 350 · sống 35s');
  expect(li).toHaveTextContent('80%growth');
  expect(within(li).getByText('Chết')).toBeInTheDocument();
});

test('a hold bite: its ticks under the damage', () => {
  show([bite]);
  expect(screen.getByText('cắn')).toBeInTheDocument();
  expect(screen.getByText(/−350/).closest('span')).toHaveTextContent('−350cắn giữ ×3');
});

test('the 📍 opens the scene; without one saved, only the death\'s spot (and it closes)', async () => {
  show([death]);
  await userEvent.click(screen.getByRole('button', { name: /📍 148\.697, 349\.211/ }));
  const dialog = screen.getByRole('dialog', { name: 'Hiện trường lần chết' });
  expect(within(dialog).getByText('Rex giết Carno')).toBeInTheDocument();
  expect(await within(dialog).findByText(/chỉ có vị trí người chết/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('empty', () => {
  show([]);
  expect(screen.getByText('Chưa có sự kiện')).toBeInTheDocument();
});
