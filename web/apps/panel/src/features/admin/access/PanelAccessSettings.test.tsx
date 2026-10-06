import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PanelAccess } from '@isle/api';
import { clearDrafts } from '../../settings-form/drafts';
import { fakeBridge } from '../../../test/fakeBridge';
import { PanelAccessSettings, linesOf } from './PanelAccessSettings';

let server: PanelAccess;
beforeEach(() => {
  clearDrafts();
  server = { ips: ['1.2.3.4'], saved: false, yourIp: '2405:4802:1d32:eec0::9', yourRule: '2405:4802:1d32:eec0::/64', webEnabled: true };
});
afterEach(() => vi.unstubAllGlobals());

test('the list as lines, "add my network", saved as { ips }', async () => {
  const { puts, show } = fakeBridge('/api/panel-access', () => server, (b: { ips: string[] }) => (server = { ...server, ips: b.ips, saved: true }));
  show(<PanelAccessSettings />);
  const box = await screen.findByLabelText(/Địa chỉ IP được vào panel/);
  expect(box).toHaveValue('1.2.3.4');
  expect(screen.getByText(/chưa lưu trên panel/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Thêm mạng của tôi (2405:4802:1d32:eec0::/64)' }));
  expect(box).toHaveValue('1.2.3.4\n2405:4802:1d32:eec0::/64');
  expect(screen.queryByRole('button', { name: /Thêm mạng của tôi/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Lưu danh sách' }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.body).toEqual({ ips: ['1.2.3.4', '2405:4802:1d32:eec0::/64'] });
  expect(await screen.findByText('Đã lưu danh sách IP, có hiệu lực ngay.')).toBeInTheDocument();
});

test('lines, spaces and commas all split', () => {
  expect(linesOf(' 1.1.1.1\n\n2.2.2.0/24, 3.3.3.3 ')).toEqual(['1.1.1.1', '2.2.2.0/24', '3.3.3.3']);
});
