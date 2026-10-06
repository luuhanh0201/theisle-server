import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ServerStatusFull } from '@isle/api';
import { fakeApi } from '../../../test/fakeBridge';
import { ServerOps } from './ServerOps';

const NOW = Date.now();
const status = (over: Partial<ServerStatusFull> = {}): ServerStatusFull => ({
  phase: 'running', unit: { activeState: 'active', subState: 'running', since: Math.floor(NOW / 1000) - 3600, pid: 1234 },
  modsLoadedAt: Math.floor(NOW / 1000) - 600, operation: null, lastOperation: null,
  schedule: { daily: ['04:00'], countdownMinutes: 5, next: null }, timeZone: 'Asia/Ho_Chi_Minh', rconEnabled: true, writesEnabled: true,
  unitName: 'theisle.service', now: NOW, ...over,
});
const base = (st: ServerStatusFull) => ({
  'GET /api/server/status': st,
  'GET /api/server/readiness': { verdict: 'ready', summary: 'Sẵn sàng', checks: [{ id: 'unit', label: 'Tiến trình game', state: 'ok', detail: 'active' }], lastJoin: null, checkedAt: Math.floor(NOW / 1000) },
  'GET /api/server/growth-events': { events: [], applied: null, daily: ['04:00'], limits: { min: 0.1, max: 20 } },
  'GET /api/ddos': { enabled: true, pps: 20000, mbps: 50, sustainSec: 30, iface: 'eth0', attack: null, history: [{ t: 1, pps: 120, mbps: 1, outMbps: 2 }] },
  'GET /api/rcon/commands': { enabled: true, commands: { toggleAi: { label: 'AI', args: 'none', read: false, toggle: true }, save: { label: 'Lưu game', args: 'none', read: false, toggle: false } } },
});
afterEach(() => vi.unstubAllGlobals());

test('the state, start disabled while running; a restart asks, with the countdown and the reason', async () => {
  const { calls, show } = fakeApi({ ...base(status()), 'POST /api/server/restart': { ok: true } });
  show(<ServerOps />);
  expect(await screen.findByText('Đang chạy')).toBeInTheDocument();
  expect(screen.getByText('active · PID 1234')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '▶ Bật server' })).toBeDisabled();
  expect(screen.getByText('Sẵn sàng')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '↻ Khởi động lại' }));
  const dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Báo trước cho người chơi' }));
  await userEvent.click(screen.getByRole('option', { name: '10 phút' }));
  await userEvent.type(within(dialog).getByLabelText(/Lý do/), 'bảo trì');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Khởi động lại' }));
  await waitFor(() => expect(calls.find((c) => c.url === '/api/server/restart')?.body).toEqual({ countdownSeconds: 600, reason: 'bảo trì' }));
});

test('an operation counting down: its steps and Huỷ', async () => {
  const op = { id: 1, kind: 'restart' as const, source: 'schedule' as const, reason: '', startedAt: NOW, runAt: NOW + 125_000, step: 'countdown' as const, finishedAt: null, message: null };
  const { calls, show } = fakeApi({ ...base(status({ operation: op })), 'POST /api/server/cancel': { ok: true } });
  show(<ServerOps />);
  expect((await screen.findAllByText('định kỳ')).length).toBeGreaterThan(0);
  expect(screen.getByText(/^2:0[45]$/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '↻ Khởi động lại' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/server/cancel')).toBe(true));
});

test('the schedule: a time removed and one added, saved with the warning', async () => {
  const { calls, show } = fakeApi({ ...base(status()), 'PUT /api/server/schedule': { ok: true } });
  show(<ServerOps />);
  await userEvent.click(await screen.findByRole('button', { name: 'Bỏ 04:00' }));
  expect(screen.getByText('Chưa có giờ nào.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Giờ' }));
  await userEvent.click(screen.getByRole('button', { name: '18:00' }));
  await userEvent.click(screen.getByRole('button', { name: 'Xong' }));
  await userEvent.click(screen.getByRole('button', { name: '+ Thêm giờ' }));
  await userEvent.click(screen.getByRole('button', { name: 'Lưu lịch' }));
  await waitFor(() => expect(calls.find((c) => c.url === '/api/server/schedule')?.body).toEqual({ daily: ['18:00'], countdownMinutes: 5 }));
});

test('RCON: a box left empty is refused; a toggle asks first; the answer shown', async () => {
  const { calls, show } = fakeApi({ ...base(status()), 'POST /api/rcon/toggleAi': { response: 'AI: off' }, 'POST /api/rcon/announce': { response: '' } });
  show(<ServerOps />);
  await userEvent.click(await screen.findByRole('button', { name: 'Gửi' }));
  expect(await screen.findByText('Nhập giá trị trước.')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Thông báo toàn server'), 'Chào');
  await userEvent.click(screen.getByRole('button', { name: 'Gửi' }));
  await waitFor(() => expect(calls.find((c) => c.url === '/api/rcon/announce')?.body).toEqual({ args: 'Chào' }));
  await userEvent.click(screen.getByRole('button', { name: '⇄ AI' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Thực hiện' }));
  expect(await screen.findByText(/AI: off/)).toBeInTheDocument();
});
