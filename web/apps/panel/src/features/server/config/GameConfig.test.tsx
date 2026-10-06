import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameConfig as Config } from '@isle/api';
import { fakeApi } from '../../../test/fakeBridge';
import { GameConfig } from './GameConfig';

let server: Config;
beforeEach(() => {
  location.hash = '#server/cfg:server';
  server = {
    settings: {}, effective: { ServerName: 'Test', MaxPlayerCount: 100 }, iniWrittenAt: null, pendingRestart: true,
    schema: {
      ServerName: { section: 'S', group: 'server', label: 'Tên server', help: 'Tên trong danh sách', type: 'text', maxLen: 64, default: '' },
      MaxPlayerCount: { section: 'S', group: 'server', label: 'Số người chơi tối đa', help: '', type: 'int', min: 1, max: 200, default: 100 },
      AllowedClasses: { section: 'S', group: 'spawn', label: 'Loài được chơi', help: '', type: 'list', itemHelp: '', max: 60 },
    },
    knownPlayables: ['Carnotaurus', 'Troodon'], groups: { server: 'Máy chủ', spawn: 'Loài & điểm spawn', ai: 'AI & thực vật' },
  };
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const api = fakeApi({
    'GET /api/game-config': () => server, 'GET /api/catalog': { species: [] },
    'PUT /api/game-config': (b: { settings: Record<string, unknown> }) => { server = { ...server, settings: b.settings }; return { settings: b.settings, operation: null }; },
  });
  api.show(<GameConfig />);
  return api;
}

test('a group at a time; edits in two groups (dots) saved together, the whole form', async () => {
  const { calls } = setup();
  expect(await screen.findByText('Cấu hình game · Máy chủ')).toBeInTheDocument();
  expect(screen.getByText(/cần/)).toHaveTextContent('khởi động lại');
  expect(screen.queryByRole('link', { name: 'AI & thực vật' })).not.toBeInTheDocument();   // a group with no key on this form
  await userEvent.click(screen.getByLabelText(/Số người chơi tối đa/).parentElement!.querySelector('[aria-label="Giảm"]')!);
  location.hash = '#server/cfg%3Aspawn';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  expect(await screen.findByText('Cấu hình game · Loài & điểm spawn')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Troodon' }));
  const nav = screen.getByRole('navigation', { name: 'Nhóm cấu hình game' });
  expect(within(nav).getAllByTitle('Có thay đổi chưa lưu')).toHaveLength(2);
  await userEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
  await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ settings: { ServerName: 'Test', MaxPlayerCount: 99, AllowedClasses: ['Troodon'] } }));
  await waitFor(() => expect(within(nav).queryAllByTitle('Có thay đổi chưa lưu')).toHaveLength(0));
});

test('Lưu & khởi động lại: asks the countdown and the reason, sends them with the settings', async () => {
  const { calls } = setup();
  await screen.findByText('Cấu hình game · Máy chủ');
  await userEvent.click(screen.getByRole('button', { name: 'Lưu & khởi động lại…' }));
  const dialog = screen.getByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText(/Lý do/), 'đổi tên');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu & khởi động lại' }));
  await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
    settings: { ServerName: 'Test', MaxPlayerCount: 100, AllowedClasses: [] }, restart: { countdownSeconds: 300, reason: 'đổi tên' },
  }));
  expect(await screen.findByText('Đã lưu, server sẽ khởi động lại.')).toBeInTheDocument();
});
