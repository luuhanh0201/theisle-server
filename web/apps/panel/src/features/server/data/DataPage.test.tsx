import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BackupsView } from '@isle/api';
import { fakeApi } from '../../../test/fakeBridge';
import { DataPage, bkSize } from './DataPage';

const view = (phase: string): BackupsView => ({
  backups: [{ name: 'data-20261006-040000-scheduled.tar.gz', kind: 'data', size: 2_500_000, createdAt: 1_791_000_000, reason: 'scheduled', parts: [] }],
  settings: { atScheduledRestart: true, keep: 7 },
  parts: [{ key: 'dinos', label: 'Dino người chơi (save game)' }, { key: 'garage', label: 'Gara (dino đã cất)' }],
  phase,
});
afterEach(() => vi.unstubAllGlobals());

test('sizes', () => {
  expect(bkSize(2_500_000)).toBe('2.4 MB');
  expect(bkSize(300)).toBe('1 KB');
});

test('server running: restore and wipe locked, said why; backup now and the settings saved', async () => {
  const { calls, show } = fakeApi({
    'GET /api/backups': view('running'), 'POST /api/backups': { name: 'data-x.tar.gz', size: 2048 }, 'PUT /api/backup-settings': { ok: true },
  });
  show(<DataPage />);
  expect(await screen.findByText(/chỉ làm được khi/)).toBeInTheDocument();
  expect(screen.getByText('tự động (restart định kỳ)')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Khôi phục' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Xoá dữ liệu…' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Backup ngay' }));
  expect(await screen.findByText('Đã backup: data-x.tar.gz (2 KB).')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('switch', { name: /Tự backup/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(calls.find((c) => c.url === '/api/backup-settings')?.body).toEqual({ atScheduledRestart: false, keep: 7 }));
});

test('server stopped: a wipe needs the words typed, with the parts ticked', async () => {
  const { calls, show } = fakeApi({ 'GET /api/backups': view('stopped'), 'POST /api/backups/wipe': { wiped: ['garage'], backup: 'b.tar.gz' } });
  show(<DataPage />);
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Dino người chơi (save game)' }));
  await userEvent.click(screen.getByRole('button', { name: 'Xoá dữ liệu…' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('Xoá: Gara (dino đã cất).');
  await userEvent.type(within(dialog).getByLabelText(/Gõ XOA DU LIEU/), 'xoa');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Xoá dữ liệu' }));
  expect(await within(dialog).findByText('Gõ đúng: XOA DU LIEU')).toBeInTheDocument();
  expect(calls.some((c) => c.url === '/api/backups/wipe')).toBe(false);
  await userEvent.clear(within(dialog).getByLabelText(/Gõ XOA DU LIEU/));
  await userEvent.type(within(dialog).getByLabelText(/Gõ XOA DU LIEU/), 'XOA DU LIEU');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Xoá dữ liệu' }));
  await waitFor(() => expect(calls.find((c) => c.url === '/api/backups/wipe')?.body).toEqual({ parts: ['garage'], confirm: 'XOA DU LIEU' }));
});
