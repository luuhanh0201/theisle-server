import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeApi } from '../../../test/fakeBridge';
import { Bans, banMatch, isSteamId, type BanRow } from './Bans';

const row = (p: Partial<BanRow>): BanRow => ({
  steamId: '76561198000000099', bannedTime: '2026.10.01-10.00.00', name: 'Griefer', reason: 'Phá game', bannedAt: 1_791_000_000, endsAt: 1_791_259_200,
  permanent: false, by: 'Rcon', duration: '3 ngày', active: true, ...p,
});
const now = row({});
const old = row({ steamId: '76561198000000098', name: 'Old', reason: 'Spam', active: false, bannedTime: 'x' });
const view = {
  bans: [now, old],
  reasons: ['Phá game', 'Spam chat'], permanentHours: 87600, rcon: true, admins: ['76561198000000099'],
};
const players = { players: [{ steamId: '76561198000000011', name: 'Rex Tester', species: 'BP_Tyrannosaurus_C', online: true }] };
const messages = { texts: {}, catalog: [{ key: 'ban.announce', default: '{name} bị ban {duration}: {reason}' }] };
afterEach(() => vi.unstubAllGlobals());

test('search and the status filter', () => {
  expect(banMatch(now, 'griefer', 'all')).toBe(true);
  expect(banMatch(now, 'phá', 'active')).toBe(true);
  expect(banMatch(now, '', 'expired')).toBe(false);
  expect(banMatch(old, '98', 'expired')).toBe(true);
  expect(isSteamId('76561198000000011')).toBe(true);
  expect(isSteamId('7656119800000001')).toBe(false);
});

test('ban the first player online, with a reason template and the preview of the announce', async () => {
  const { calls, show } = fakeApi({ 'GET /api/bans': view, 'GET /api/players': players, 'GET /api/messages': messages, 'POST /api/bans': { kicked: true } });
  show(<Bans />);
  expect(await screen.findByText('Griefer')).toBeInTheDocument();
  expect(screen.getByText('1 đang ban · 2 tất cả')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Ban' }));
  expect(await screen.findByText('Cần ghi lý do ban.')).toBeInTheDocument();
  await userEvent.type(screen.getByPlaceholderText(/Ghi lý do/), 'Giết người mới');
  expect(await screen.findByText('Rex Tester bị ban 3 ngày: Giết người mới')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Ban' }));
  const dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ban' }));
  await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url === '/api/bans')?.body)
    .toEqual({ steamId: '76561198000000011', name: 'Rex Tester', reason: 'Giết người mới', hours: 72 }));
  expect(await screen.findByText('Đã ban Rex Tester và kick khỏi server.')).toBeInTheDocument();
});

test('a SteamID typed in: wrong one refused; an admin account warned', async () => {
  const { calls, show } = fakeApi({ 'GET /api/bans': view, 'GET /api/players': { players: [] }, 'GET /api/messages': messages });
  show(<Bans />);
  await userEvent.type(await screen.findByLabelText('SteamID64'), '123');
  await userEvent.type(screen.getByPlaceholderText(/Ghi lý do/), 'x');
  await userEvent.click(screen.getByRole('button', { name: 'Ban' }));
  expect(await screen.findByText('Chọn người chơi hoặc nhập SteamID64 đúng.')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('SteamID64'));
  await userEvent.type(screen.getByLabelText('SteamID64'), '76561198000000099');
  expect(await screen.findByText(/là admin server/)).toBeInTheDocument();
  expect(calls.some((c) => c.method === 'POST')).toBe(false);
});

test('edit: nothing changed is refused, a new reason is sent; unban; reasons saved', async () => {
  const { calls, show } = fakeApi({
    'GET /api/bans': view, 'GET /api/players': players, 'GET /api/messages': messages,
    'POST /api/bans/edit': { ok: true }, 'POST /api/bans/unban': { ok: true }, 'PUT /api/ban-reasons': { ok: true },
  });
  show(<Bans />);
  await userEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
  let dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
  expect(await within(dialog).findByText('Chưa đổi gì.')).toBeInTheDocument();
  await userEvent.clear(within(dialog).getByLabelText('Lý do'));
  await userEvent.type(within(dialog).getByLabelText('Lý do'), 'Hack');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(calls.find((c) => c.url === '/api/bans/edit')?.body)
    .toEqual({ steamId: '76561198000000099', bannedTime: '2026.10.01-10.00.00', reason: 'Hack' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: 'Gỡ ban' }));
  dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Gỡ ban' }));
  await waitFor(() => expect(calls.find((c) => c.url === '/api/bans/unban')?.body).toEqual({ steamId: '76561198000000099', bannedTime: '2026.10.01-10.00.00' }));
  const box = screen.getByLabelText('Mẫu lý do');
  await userEvent.type(box, '\nAFK  \n\n');
  await userEvent.click(screen.getByRole('button', { name: 'Lưu mẫu lý do' }));
  await waitFor(() => expect(calls.find((c) => c.url === '/api/ban-reasons')?.body).toEqual({ reasons: ['Phá game', 'Spam chat', 'AFK'] }));
});
