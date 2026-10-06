import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FishSettings as Settings, FishState } from '@isle/api';
import { clearDrafts } from '../../settings-form/drafts';
import { fakeBridge } from '../../../test/fakeBridge';
import { FishSettings, savedText } from './FishSettings';

const SPECIES = [
  { key: 'Catfish', cls: 'BP_Catfish_C', label: 'Catfish (cá trê)' },
  { key: 'Forktail', cls: 'BP_Forktail_C', label: 'Forktail' },
  { key: 'Hoplo', cls: 'BP_Hoplo_C', label: 'Hoplo' },
];
let server: FishState;
beforeEach(() => {
  clearDrafts();
  server = { settings: { control: true, perPlayer: 12, perWater: 28, cooldownSec: 0.5, species: ['Catfish', 'Hoplo'] }, species: SPECIES,
    census: { t: Math.floor(Date.now() / 1000), online: 2, total: 9, species: { BP_Catfish_C: 5, BP_Hoplo_C: 4 }, perPlayer: 12, perWater: 28, cooldownSec: 0.5 },
    disallowed: ['Forktail'] };
});
afterEach(() => vi.unstubAllGlobals());

test('species ticked in the bridge\'s order, the census, the toast from the RCON answer', async () => {
  const { puts, show } = fakeBridge('/api/fish-settings', () => server, (b: Settings) => {
    server = { ...server, settings: b };
    return { settings: b, disallowed: [], rcon: 'restart needed' };
  });
  show(<FishSettings />);
  expect(await screen.findByRole('checkbox', { name: 'Forktail' })).not.toBeChecked();
  expect(screen.getByText(/Catfish \(cá trê\) 5 · Hoplo 4/)).toBeInTheDocument();
  expect(screen.getByText(/Đang cấm: Forktail/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Forktail' }));
  await userEvent.click(screen.getByRole('button', { name: 'Lưu cài đặt' }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.body.species).toEqual(['Catfish', 'Forktail', 'Hoplo']);
  expect(await screen.findByText('Đã lưu, loài vừa mở lại sẽ có sau lần restart tới.')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu cài đặt' })).toBeDisabled());
});

test('the save texts', () => {
  expect(savedText({ rcon: 'sent' })).toBe('Đã lưu, mật độ áp dụng trong ~30 giây.');
  expect(savedText({ rcon: 'failed: timeout' })).toBe('Đã lưu, nhưng RCON lỗi (failed: timeout), loài áp dụng ở lần restart tới.');
});
