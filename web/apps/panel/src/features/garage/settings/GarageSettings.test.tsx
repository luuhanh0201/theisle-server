import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GarageSettings as Settings, GarageSettingsState } from '@isle/api';
import { clearDrafts } from '../../settings-form/drafts';
import { fakeBridge } from '../../../test/fakeBridge';
import { GarageSettings } from './GarageSettings';

let server: GarageSettingsState;
beforeEach(() => {
  clearDrafts();
  server = { redeemAt: 'current', maxSlots: 3, storeCountdown: 30, cooldown: 180, minHealthPct: 0, minGrowthPct: 0,
    tiers: { vip: { maxSlots: 5, cooldown: 120 }, svip: { maxSlots: 0, cooldown: 60 } }, memberCounts: { vip: 4, svip: 2, admin: 3 } };
});
afterEach(() => vi.unstubAllGlobals());

test('tiers and spot edited; saved without memberCounts; a new count is no "change"', async () => {
  const { puts, qc, show } = fakeBridge('/api/garage-settings', () => server, (b: Settings) => { server = { ...b, memberCounts: server.memberCounts }; return b; });
  show(<GarageSettings />);
  const vip = await screen.findByLabelText('VIP: số ô gara');
  expect(vip).toHaveValue('5');
  expect(screen.getByText(/Hiện có: 4 VIP · 2 SVip · 3 admin/)).toBeInTheDocument();
  server = { ...server, memberCounts: { vip: 5, svip: 2, admin: 3 } };
  await act(() => qc.refetchQueries());
  expect(await screen.findByText(/Hiện có: 5 VIP/)).toBeInTheDocument();
  expect(screen.queryByText('Có thay đổi mới từ máy chủ.')).not.toBeInTheDocument();
  await userEvent.click(vip.parentElement!.querySelector('[aria-label="Tăng"]')!);
  await userEvent.click(screen.getByRole('button', { name: /Vị trí xuất hiện/ }));
  await userEvent.click(screen.getByRole('option', { name: 'Người chơi tự chọn trên web' }));
  expect(screen.getByText(/chọn "chỗ đang đứng" hoặc "chỗ đã cất"/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Lưu cài đặt' }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.body).toEqual({ redeemAt: 'choice', maxSlots: 3, storeCountdown: 30, cooldown: 180, minHealthPct: 0, minGrowthPct: 0,
    tiers: { vip: { maxSlots: 6, cooldown: 120 }, svip: { maxSlots: 0, cooldown: 60 } } });
  expect(await screen.findByText('Đã lưu, áp dụng ngay cho lần cất / lấy ra kế tiếp.')).toBeInTheDocument();
});
