import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CommandsSettings as Settings } from '@isle/api';
import { clearDrafts } from '../../settings-form/drafts';
import { fakeBridge } from '../fakeBridge';
import { CommandsSettings } from './CommandsSettings';

let server: Settings;
beforeEach(() => {
  clearDrafts();
  server = { slayCooldown: 300, unstuckCooldown: 600, foodCooldown: 30, enabled: { slay: true, unstuck: true, prime: true, status: true, food: true } };
});
afterEach(() => vi.unstubAllGlobals());

test('the waits and the on / off switches, saved in the shape the bridge takes', async () => {
  const { puts, show } = fakeBridge('/api/commands-settings', () => server, (b: Settings) => (server = b));
  show(<CommandsSettings />);
  const slay = await screen.findByLabelText(/hai lần !slay/);
  expect(slay).toHaveValue('300');
  expect(screen.getByLabelText(/hai lần !food/)).toHaveValue('30');
  const save = screen.getByRole('button', { name: 'Lưu cài đặt' });
  expect(save).toBeDisabled();
  await userEvent.click(screen.getByRole('switch', { name: '!prime' }));
  await userEvent.clear(slay);
  await userEvent.type(slay, '120{Enter}');
  await userEvent.click(save);
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]).toEqual({ token: 'tok', body: {
    slayCooldown: 120, unstuckCooldown: 600, foodCooldown: 30,
    enabled: { slay: true, unstuck: true, prime: false, status: true, food: true },
  } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu cài đặt' })).toBeDisabled());
});
