import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeApi } from '../../../test/fakeBridge';
import { SpeciesCaps, withCap } from './SpeciesCaps';

afterEach(() => vi.unstubAllGlobals());

test('a limit set, or 0 = no limit, the others kept', () => {
  expect(withCap({}, 'Tyrannosaurus', 5)).toEqual({ Tyrannosaurus: { cap: 5 } });
  expect(withCap({ Tyrannosaurus: { cap: 5 }, Allosaurus: { cap: 3 } }, 'Tyrannosaurus', 0)).toEqual({ Allosaurus: { cap: 3 } });
});

test('every species has its number (0 = no limit); alive, SVip / admin apart, who waits to be removed; saved whole', async () => {
  location.hash = '#server/caps';
  let settings = { enabled: true, graceS: 30, species: { Tyrannosaurus: { cap: 5 } } };
  const api = fakeApi({
    'GET /api/species-cap': () => ({
      settings, species: ['Allosaurus', 'Tyrannosaurus'], allowed: ['Allosaurus', 'Tyrannosaurus'],
      counts: [{ species: 'Tyrannosaurus', alive: 5, free: 2, cap: 5 }],
      over: [{ steamId: '76561198000000011', name: 'Rex', species: 'Tyrannosaurus', killAt: Math.floor(Date.now() / 1000) + 20 }],
    }),
    'PUT /api/species-cap': (b: typeof settings) => { settings = b; return { settings: b }; },
  });
  api.show(<SpeciesCaps />);
  expect(await screen.findByText(/\+2 SVip \/ admin/)).toBeInTheDocument();
  expect(screen.getByText(/Rex \(.+\) còn \d+ giây/)).toBeInTheDocument();
  expect(screen.getByText('không giới hạn')).toBeInTheDocument();   // Allosaurus, 0
  const allo = screen.getByLabelText(/Tối đa Allo/);
  expect(allo).toHaveValue('0');
  await userEvent.click(allo.parentElement!.querySelector('[aria-label="Tăng"]')!);
  await userEvent.click(screen.getByRole('button', { name: 'Lưu giới hạn loài' }));
  await waitFor(() => expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({
    enabled: true, graceS: 30, species: { Tyrannosaurus: { cap: 5 }, Allosaurus: { cap: 1 } } }));
});
