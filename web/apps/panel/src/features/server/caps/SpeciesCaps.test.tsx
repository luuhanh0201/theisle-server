import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeApi } from '../../../test/fakeBridge';
import { DEFAULT_RULE, SpeciesCaps, withRule } from './SpeciesCaps';

afterEach(() => vi.unstubAllGlobals());

test('a limit set or taken away, the others kept', () => {
  expect(withRule({}, 'Tyrannosaurus', DEFAULT_RULE)).toEqual({ Tyrannosaurus: { cap: 8, reserve: 0 } });
  expect(withRule({ Tyrannosaurus: DEFAULT_RULE, Allosaurus: { cap: 3, reserve: 1 } }, 'Tyrannosaurus', null)).toEqual({ Allosaurus: { cap: 3, reserve: 1 } });
});

test('each species: off = no limit; on = common + priority slots; alive, hidden, who waits to be removed; saved whole', async () => {
  location.hash = '#server/caps';
  let settings = { enabled: true, graceS: 30, species: { Tyrannosaurus: { cap: 8, reserve: 2 } } };
  const api = fakeApi({
    'GET /api/species-cap': () => ({
      settings, species: ['Allosaurus', 'Tyrannosaurus'], allowed: ['Allosaurus', 'Tyrannosaurus'], rcon: true,
      counts: [{ species: 'Tyrannosaurus', alive: 10, cap: 8, reserve: 2, hidden: true }],
      over: [{ steamId: '76561198000000011', name: 'Rex', species: 'Tyrannosaurus', killAt: Math.floor(Date.now() / 1000) + 20 }],
    }),
    'PUT /api/species-cap': (b: typeof settings) => { settings = b; return { settings: b }; },
  });
  api.show(<SpeciesCaps />);
  expect(await screen.findByText('đã ẩn khỏi bảng chọn')).toBeInTheDocument();
  expect(screen.getByText(/10 \/ 10/)).toBeInTheDocument();
  expect(screen.getByText(/Rex \(.+\) còn \d+ giây/)).toBeInTheDocument();
  expect(screen.getByText('không giới hạn')).toBeInTheDocument();   // Allosaurus
  await userEvent.click(screen.getByRole('switch', { name: /Giới hạn Allo/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Lưu giới hạn loài' }));
  await waitFor(() => expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({
    enabled: true, graceS: 30, species: { Tyrannosaurus: { cap: 8, reserve: 2 }, Allosaurus: { cap: 8, reserve: 0 } } }));
});
