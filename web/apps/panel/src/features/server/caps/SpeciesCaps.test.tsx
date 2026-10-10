import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeApi } from '../../../test/fakeBridge';
import { SpeciesCaps, withCap } from './SpeciesCaps';

afterEach(() => vi.unstubAllGlobals());

test('a limit set, or 0 = no limit, the others kept', () => {
  expect(withCap({}, 'Tyrannosaurus', 5)).toEqual({ Tyrannosaurus: { cap: 5 } });
  expect(withCap({ Tyrannosaurus: { cap: 5 }, Allosaurus: { cap: 3 } }, 'Tyrannosaurus', 0)).toEqual({ Allosaurus: { cap: 3 } });
});

test('every species has its number (0 = no limit); alive, SVip / admin apart, off the picker; saved whole', async () => {
  location.hash = '#server/caps';
  let settings = { enabled: true, species: { Tyrannosaurus: { cap: 5 } } };
  const api = fakeApi({
    'GET /api/species-cap': () => ({
      settings, species: ['Allosaurus', 'Tyrannosaurus'], allowed: ['Allosaurus', 'Tyrannosaurus'], rcon: true,
      counts: [{ species: 'Tyrannosaurus', alive: 5, free: 2, cap: 5, hidden: true }],
    }),
    'PUT /api/species-cap': (b: typeof settings) => { settings = b; return { settings: b }; },
  });
  api.show(<SpeciesCaps />);
  expect(await screen.findByText(/\+2 SVip \/ admin/)).toBeInTheDocument();
  expect(screen.getByText('đã ẩn khỏi bảng chọn')).toBeInTheDocument();
  expect(screen.getByText('không giới hạn')).toBeInTheDocument();   // Allosaurus, 0
  const allo = screen.getByLabelText(/Tối đa Allo/);
  expect(allo).toHaveValue('0');
  await userEvent.click(allo.parentElement!.querySelector('[aria-label="Tăng"]')!);
  await userEvent.click(screen.getByRole('button', { name: 'Lưu giới hạn loài' }));
  await waitFor(() => expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({
    enabled: true, species: { Tyrannosaurus: { cap: 5 }, Allosaurus: { cap: 1 } } }));
});
