import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SvipView } from '@isle/api';
import { fakeBridge } from '../../../test/fakeBridge';
import { SvipPage } from './SvipPage';

const MODES = [
  { key: 'admin', label: 'Chỉ admin', note: 'Đang phát triển' },
  { key: 'testing', label: 'SVip', note: 'Ưu tiên dùng trước' },
  { key: 'all', label: 'Công khai', note: 'Đã phát hành' },
] as const;
let server: SvipView;
beforeEach(() => {
  server = {
    players: [{ steamId: '76561198000000002', note: 'tester', addedAt: 1_780_000_000, by: 'Dev', name: 'Rex' }],
    features: [{ key: 'shop', label: 'Cửa hàng Hổ phách', mode: 'testing' }, { key: 'tele', label: 'Tele con non', mode: 'admin' }],
    modes: [...MODES],
  };
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const b = fakeBridge('/api/svip', () => server, (body: { players: Array<{ steamId: string; note: string }>; features: Record<string, string> }) => {
    server = { ...server, players: body.players.map((p) => ({ ...p, addedAt: 1, by: 'Dev', name: null })),
      features: server.features.map((f) => ({ ...f, mode: body.features[f.key] as never })) };
    return server;
  });
  b.show(<SvipPage />);
  return b;
}

test('add: a bad SteamID refused, a good one saved with the whole list', async () => {
  const { puts } = setup();
  expect(await screen.findByRole('link', { name: 'Rex' })).toHaveAttribute('href', '/#player/76561198000000002');
  await userEvent.type(screen.getByLabelText('SteamID'), '123');
  await userEvent.click(screen.getByRole('button', { name: 'Thêm SVip' }));
  expect(await screen.findByText('SteamID: 17 chữ số, bắt đầu bằng 7656…')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('SteamID'));
  await userEvent.type(screen.getByLabelText('SteamID'), '76561198000000003');
  await userEvent.type(screen.getByLabelText(/Ghi chú/), 'mới');
  await userEvent.click(screen.getByRole('button', { name: 'Thêm SVip' }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.body).toEqual({
    players: [{ steamId: '76561198000000002', note: 'tester' }, { steamId: '76561198000000003', note: 'mới' }],
    features: { shop: 'testing', tele: 'admin' },
  });
  expect(await screen.findByText('76561198000000003')).toBeInTheDocument();
  expect(screen.getByLabelText('SteamID')).toHaveValue('');
});

test('a release level asks first, then saves', async () => {
  const { puts } = setup();
  const group = await screen.findByRole('group', { name: 'Mức phát hành: Tele con non' });
  await userEvent.click(within(group).getByRole('button', { name: /Công khai/ }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('"Tele con non": Công khai (Đã phát hành)?');
  expect(puts).toHaveLength(0);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Phát hành' }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.body.features).toEqual({ shop: 'testing', tele: 'all' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(within(screen.getByRole('group', { name: 'Mức phát hành: Tele con non' })).getByRole('button', { name: /Công khai/ })).toHaveAttribute('aria-pressed', 'true');
});
