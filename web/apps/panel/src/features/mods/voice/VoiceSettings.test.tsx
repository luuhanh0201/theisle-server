import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { VoiceSettings as Voice } from '@isle/api';
import { clearDrafts } from '../../settings-form/drafts';
import { fakeBridge } from '../../../test/fakeBridge';
import { VoiceSettings } from './VoiceSettings';

let server: Voice;
beforeEach(() => {
  clearDrafts();
  server = { nameMode: 'name', enabled: true, url: 'wss://voice.example' };
});
afterEach(() => vi.unstubAllGlobals());

test('the status line, the system select, a save of nameMode only', async () => {
  const { puts, show } = fakeBridge('/api/voice-settings', () => server, (b: { nameMode: 'name' | 'id' | 'none' }) => {
    server = { ...server, ...b };
    return { nameMode: b.nameMode };
  });
  show(<VoiceSettings />);
  expect(await screen.findByText('wss://voice.example')).toBeInTheDocument();
  expect(screen.getByText(/hiện tên trong game của người nói/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Người chơi thấy gì/ }));
  await userEvent.click(screen.getByRole('option', { name: 'Không hiện gì' }));
  expect(screen.getByText(/Hợp với server nhập vai/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Lưu cài đặt' }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]).toEqual({ body: { nameMode: 'none' }, token: 'tok' });
  // The PUT's answer has no status: the line stays, and it is no "change from the server".
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu cài đặt' })).toBeDisabled());
  expect(screen.getByText('wss://voice.example')).toBeInTheDocument();
});

test('voice off on the bridge: said, and the status changing is not a settings change', async () => {
  server = { nameMode: 'id', enabled: false, url: null };
  const { qc, show } = fakeBridge('/api/voice-settings', () => server, (b) => b);
  show(<VoiceSettings />);
  expect(await screen.findByText(/Voice chưa bật trên bridge/)).toBeInTheDocument();
  server = { nameMode: 'id', enabled: true, url: 'wss://v' };
  await act(() => qc.refetchQueries());
  expect(await screen.findByText('wss://v')).toBeInTheDocument();
  expect(screen.queryByText('Có thay đổi mới từ máy chủ.')).not.toBeInTheDocument();
});
