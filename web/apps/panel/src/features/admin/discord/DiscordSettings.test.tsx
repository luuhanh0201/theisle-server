import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DiscordView } from '@isle/api';
import { clearDrafts } from '../../settings-form/drafts';
import { fakeBridge } from '../../../test/fakeBridge';
import { DiscordSettings } from './DiscordSettings';
import { bodyOf, draftOf, withoutChannel } from './form';

const KINDS = [
  { key: 'join', group: 'Người chơi', label: 'Vào server' },
  { key: 'kill', group: 'Chiến đấu', label: 'Người chơi giết người chơi' },
];
let server: DiscordView;
beforeEach(() => {
  clearDrafts();
  server = {
    enabled: true, routes: { join: 'a' }, mentions: { kill: '123456789012345678' },
    channels: [{ id: 'a', name: 'killfeed', hint: 'webhook 111 · …abcd' }], relay: { url: 'https://r.workers.dev', hasSecret: true }, board: null,
    kinds: KINDS,
    status: { queued: 2, dropped: 0, relay: { lastOkAt: null, lastError: null },
      channels: { a: { queued: 0, lastOkAt: null, lastError: null, waitUntil: 0, webhook: { name: 'Log', channelId: '99991234', error: null, at: 0 } } } },
  };
});
afterEach(() => vi.unstubAllGlobals());

test('the body: a URL and the secret only when typed, routes and board of a deleted channel go', () => {
  const d = draftOf(server);
  expect(bodyOf(d)).toEqual({ enabled: true, routes: { join: 'a' }, mentions: { kill: '123456789012345678' },
    channels: [{ id: 'a', name: 'killfeed' }], relay: { url: 'https://r.workers.dev' }, board: null });
  const typed = { ...d, channels: [{ ...d.channels[0]!, url: 'https://discord.com/api/webhooks/1/x' }], relay: { ...d.relay, secret: 's' }, board: 'a' };
  expect(bodyOf(typed)).toMatchObject({ channels: [{ id: 'a', name: 'killfeed', url: 'https://discord.com/api/webhooks/1/x' }], relay: { url: 'https://r.workers.dev', secret: 's' } });
  expect(withoutChannel(typed, 'a')).toMatchObject({ channels: [], routes: {}, board: null });
  expect(bodyOf({ ...d, relay: { url: '', secret: 'x', hasSecret: true } })).toMatchObject({ relay: null });
});

test('the page: status, the role tag kept, a route changed and saved', async () => {
  const { puts, show } = fakeBridge('/api/discord', () => server, (b) => ({ ...server, ...b, channels: server.channels, relay: server.relay }));
  show(<DiscordSettings />);
  expect(await screen.findByText(/Đang gửi · 2 tin đang chờ/)).toBeInTheDocument();
  expect(screen.getByText(/Webhook trong Discord: "Log" · kênh …1234/)).toBeInTheDocument();
  expect(screen.getByLabelText('ID role: Người chơi giết người chơi')).toHaveValue('123456789012345678');
  expect(screen.getByRole('button', { name: 'Kênh: Vào server' })).toHaveTextContent('killfeed');
  await userEvent.click(screen.getByRole('button', { name: 'Kênh: Người chơi giết người chơi' }));
  await userEvent.click(screen.getByRole('option', { name: 'killfeed' }));
  await userEvent.click(screen.getByRole('button', { name: 'Tag: Vào server' }));
  await userEvent.click(screen.getByRole('option', { name: '@here' }));
  await userEvent.click(screen.getByRole('button', { name: 'Lưu Discord' }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.body).toMatchObject({ routes: { join: 'a', kill: 'a' }, mentions: { kill: '123456789012345678', join: 'here' } });
  expect(await screen.findByText('Đã lưu Discord.')).toBeInTheDocument();
});

test('trying a channel with unsaved changes is refused', async () => {
  const { show } = fakeBridge('/api/discord', () => server, (b) => b);
  show(<DiscordSettings />);
  await userEvent.type(await screen.findByLabelText('Tên kênh'), 'x');
  await userEvent.click(screen.getByRole('button', { name: 'Thử' }));
  expect(await screen.findByText('Lưu trước rồi mới thử (kênh này chưa lưu).')).toBeInTheDocument();
});
