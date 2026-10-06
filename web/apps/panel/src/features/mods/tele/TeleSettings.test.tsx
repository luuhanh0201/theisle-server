import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@isle/ui';
import { SessionProvider } from '../../../app/session';
import { clearDrafts } from '../../settings-form/drafts';
import { UnsavedBar } from '../../settings-form/UnsavedBar';
import { TeleSettings } from './TeleSettings';

// The bridge, faked: /api/me (a Steam login with its token) and the tele settings.
let server: Record<string, number>;
const puts: Array<{ body: unknown; token: string | null }> = [];
beforeEach(() => {
  server = { maxGrowthPct: 40, targetMaxGrowthPct: 40, codeMinutes: 5, cooldownS: 60, combatS: 60, countdownS: 5 };
  puts.length = 0;
  clearDrafts();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/me') return json({ steamId: '76561198000000001', name: 'Dev', ip: '1.2.3.4', via: 'web', token: 'tok', perms: ['mods.view', 'mods.edit'], super: false });
    if (url === '/api/tele-settings' && init?.method === 'PUT') {
      puts.push({ body: JSON.parse(String(init.body)), token: new Headers(init.headers).get('x-admin-token') });
      server = JSON.parse(String(init.body));
      return json(server);
    }
    if (url === '/api/tele-settings') return json(server);
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (show = true) => (
    <QueryClientProvider client={qc}><ToastProvider><SessionProvider>
      {show ? <TeleSettings /> : <p>khác</p>}
      <UnsavedBar here={show ? "#mods/tele" : "#mods/ptera"} />
    </SessionProvider></ToastProvider></QueryClientProvider>
  );
  const r = render(view());
  return { qc, rerender: (show: boolean) => r.rerender(view(show)) };
}

test('loads, edits, saves with the login\'s token; the save button only with a change', async () => {
  setup();
  const box = await screen.findByLabelText(/người dịch chuyển/);
  expect(box).toHaveValue('40');
  const save = screen.getByRole('button', { name: 'Lưu cài đặt' });
  expect(save).toBeDisabled();
  await userEvent.click(box.parentElement!.querySelector('[aria-label="Tăng"]')!);
  expect(box).toHaveValue('41');
  expect(screen.getByText(/chưa lưu/)).toBeInTheDocument();
  await userEvent.click(save);
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]).toEqual({ body: { ...server, maxGrowthPct: 41 }, token: 'tok' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu cài đặt' })).toBeDisabled());
  expect(screen.queryByText(/chưa lưu/)).not.toBeInTheDocument();
});

test('a change on the server: the "Có thay đổi mới" bar, the form untouched until Tải lại', async () => {
  const { qc } = setup();
  const code = await screen.findByLabelText(/Mã dùng được/);
  server = { ...server, codeMinutes: 10 };
  await act(() => qc.refetchQueries());
  expect(await screen.findByText('Có thay đổi mới từ máy chủ.')).toBeInTheDocument();
  expect(code).toHaveValue('5');
  await userEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
  expect(screen.getByLabelText(/Mã dùng được/)).toHaveValue('10');
  expect(screen.queryByText('Có thay đổi mới từ máy chủ.')).not.toBeInTheDocument();
});

test('an unsaved edit survives leaving the page and coming back', async () => {
  const { rerender } = setup();
  const box = await screen.findByLabelText(/Hồi sau mỗi lần/);
  await userEvent.click(box.parentElement!.querySelector('[aria-label="Tăng"]')!);
  expect(box).toHaveValue('65');
  rerender(false);
  expect(screen.getByText(/Có thay đổi chưa lưu ở/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Tele con non' })).toHaveAttribute('href', '#mods/tele');
  rerender(true);
  expect(await screen.findByLabelText(/Hồi sau mỗi lần/)).toHaveValue('65');
});
