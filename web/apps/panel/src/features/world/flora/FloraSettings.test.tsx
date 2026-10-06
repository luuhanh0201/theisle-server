import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FloraSettings as Settings, FloraState } from '@isle/api';
import { clearDrafts } from '../../settings-form/drafts';
import { fakeBridge } from '../../../test/fakeBridge';
import { FloraSettings } from './FloraSettings';

let server: FloraState;
beforeEach(() => {
  clearDrafts();
  server = {
    settings: { control: false, migrationNutrientPct: 60, migrationMultiplier: 2, massNutrientPct: 90, massMultiplier: 4, outsideAmountPct: 20, migrationMaxPerArea: 30, massMaxPerArea: 60, outsideMaxPerArea: 10 },
    control: { t: Math.floor(Date.now() / 1000) - 120, on: true, active: 3, plants: 400, plantsNutri: 250, fruits: 80, fruitsNutri: 40, trimmed: 12 },
    t: Math.floor(Date.now() / 1000),
  };
});
afterEach(() => vi.unstubAllGlobals());

test('the settings out of { settings }, the last round shown, the PUT flat, its flat answer taken', async () => {
  const { puts, show } = fakeBridge('/api/flora-settings', () => server, (b: Settings) => { server = { ...server, settings: b }; return b; });
  show(<FloraSettings />);
  expect(await screen.findByLabelText(/Di cư: % cây có chất/)).toHaveValue('60');
  expect(screen.getByText(/vừa gỡ 12 cây vượt mức/)).toBeInTheDocument();
  expect(screen.getByText('250/400')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('switch', { name: 'Bật điều khiển thực vật' }));
  await userEvent.click(screen.getByRole('button', { name: 'Lưu cài đặt' }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.body).toEqual({ ...server.settings, control: true });
  expect(await screen.findByText('Đã lưu, mod áp dụng trong ~15 giây.')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu cài đặt' })).toBeDisabled());
  expect(screen.queryByText('Có thay đổi mới từ máy chủ.')).not.toBeInTheDocument();
});

test('no data from the mod yet: said', async () => {
  server = { ...server, control: null, t: null };
  const { show } = fakeBridge('/api/flora-settings', () => server, (b) => b);
  show(<FloraSettings />);
  expect(await screen.findByText('Chưa có dữ liệu từ mod Flora.')).toBeInTheDocument();
});
