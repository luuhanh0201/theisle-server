import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeApi } from '../../../test/fakeBridge';
import { Prison, multiplierOf, prisonBody, stateOf, type PrisonView } from './Prison';

const settings = {
  enabled: true, killPenaltyMin: 10, remindMin: 5, repeatStep: 0.5, stingGraceSec: 10, stingEverySec: 3, stingPct: 10,
  caughtMode: 'teleport' as const, catchPct: 20,
  offenses: [{ id: 'babykill', name: 'Giết baby', minutes: 30 }, { id: 'toxic', name: 'Toxic / chửi bới', minutes: 15 }],
};
const inmate = {
  id: 'abcdef0123', steamId: '76561198000000012', name: 'Carno Tester', offense: 'Toxic / chửi bới', reason: 'chửi', multiplier: 1, minutes: 15,
  totalSec: 900, prior: 0, by: 'Dev', at: 1_791_000_000, remainingSec: 600, escaped: false, escapes: 1, inside: true, online: true, jailed: true, log: [],
};
const view = (over: Partial<PrisonView> = {}): PrisonView => ({
  settings, zone: { id: 'z1', name: 'Đảo tù', enabled: true, drops: 12 }, modState: { t: Math.floor(Date.now() / 1000) - 30 },
  active: [inmate], history: [{ id: 'h1', steamId: '76561198000000011', name: 'Rex Tester', offense: 'Giết baby', reason: '', totalSec: 1800, by: 'Dev', endedAt: 1_791_000_000, outcome: 'served', escapes: 0 }],
  priors: { '76561198000000011': 2 }, hunters: [{ steamId: '76561198000000012', name: 'Carno Tester', count: 3, last: 1_791_000_000 }], ...over,
});
const players = { players: [{ steamId: '76561198000000011', name: 'Rex Tester', species: 'BP_Tyrannosaurus_C', online: true }] };
const messages = { texts: {}, catalog: [{ key: 'prison.jailed.announce', default: '🔒 {name} bị bỏ tù {duration}. Lý do: {reason}' }] };
afterEach(() => vi.unstubAllGlobals());

test('the repeat multiplier, the state shown, the body saved', () => {
  expect(multiplierOf(0.5, 2)).toBe(2);
  expect(multiplierOf(0.3, 1)).toBe(1.3);
  expect(stateOf({ release: true, escaped: true, online: true, jailed: true, inside: true }).text).toBe('🔓 chờ thả (khi online)');
  expect(stateOf({ escaped: true, online: false, jailed: true, inside: false }).tone).toBe('alert');
  expect(stateOf({ escaped: false, online: false, jailed: true, inside: true }).text).toBe('offline · dừng đếm');
  expect(stateOf({ escaped: false, online: true, jailed: false, inside: false }).text).toBe('chưa vào tù');
  expect(prisonBody({ ...settings, offenses: [{ id: 'a', name: ' A ', minutes: 5.4 }, { id: '', name: 'Mới', minutes: 30 }, { id: '', name: '  ', minutes: 9 }] }).offenses)
    .toEqual([{ id: 'a', name: 'A', minutes: 5 }, { name: 'Mới', minutes: 30 }]);
});

test('jail the first one online: the offense minutes × the repeat multiplier, the preview, the POST', async () => {
  const { calls, show } = fakeApi({ 'GET /api/prison': view(), 'GET /api/players': players, 'GET /api/messages': messages, 'POST /api/prison/jail': { ok: true } });
  show(<Prison />);
  expect(await screen.findByText(/điểm thả · đang/)).toBeInTheDocument();
  expect(await screen.findByText('30 phút × 2 (tiền án: 2)')).toBeInTheDocument();
  expect(screen.getByLabelText('Thời gian (phút)')).toHaveValue('60');
  expect(screen.getByText('🔒 Rex Tester bị bỏ tù 1 giờ. Lý do: Giết baby')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Bỏ tù' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Bỏ tù' }));
  await waitFor(() => expect(calls.find((c) => c.url === '/api/prison/jail')?.body)
    .toEqual({ steamId: '76561198000000011', name: 'Rex Tester', offenseId: 'babykill', minutes: 60, reason: '' }));
});

test('prison off: refused before any dialog', async () => {
  const { calls, show } = fakeApi({ 'GET /api/prison': view({ settings: { ...settings, enabled: false } }), 'GET /api/players': players, 'GET /api/messages': messages });
  show(<Prison />);
  expect(await screen.findByText(/Nhà tù đang TẮT/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Bỏ tù' }));
  expect(await screen.findByText(/Nhà tù đang tắt: tick/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(calls.some((c) => c.method === 'POST')).toBe(false);
});

test('change a sentence, release, save the settings with a new offense', async () => {
  const { calls, show } = fakeApi({
    'GET /api/prison': view(), 'GET /api/players': players, 'GET /api/messages': messages,
    'POST /api/prison/sentence/abcdef0123/extend': { ok: true }, 'POST /api/prison/sentence/abcdef0123/release': { ok: true }, 'PUT /api/prison/settings': settings,
  });
  show(<Prison />);
  expect(await screen.findByText('1 người')).toBeInTheDocument();
  expect(screen.getByText('🔒 trong tù')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Đổi án' }));
  let dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Đổi án' }));
  await waitFor(() => expect(calls.find((c) => c.url.endsWith('/extend'))?.body).toEqual({ minutes: 10 }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: 'Thả' }));
  dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Thả' }));
  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/release'))).toBe(true));
  await userEvent.click(screen.getByRole('button', { name: '+ Thêm lỗi' }));
  const names = screen.getAllByLabelText('Tên lỗi');
  await userEvent.type(names[names.length - 1]!, 'Chặn spawn');
  await userEvent.click(screen.getAllByRole('button', { name: 'Xoá' })[0]!);
  await userEvent.click(screen.getByRole('button', { name: 'Lưu cài đặt nhà tù' }));
  await waitFor(() => expect(calls.find((c) => c.url === '/api/prison/settings')?.body.offenses)
    .toEqual([{ id: 'toxic', name: 'Toxic / chửi bới', minutes: 15 }, { name: 'Chặn spawn', minutes: 30 }]));
});
