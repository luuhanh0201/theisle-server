import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MessagesSettings as Messages } from '@isle/api';
import { clearDrafts } from '../../settings-form/drafts';
import { fakeBridge } from '../../../test/fakeBridge';
import { MessagesSettings } from './MessagesSettings';

const CATALOG = [
  { key: 'hello.welcome', group: 'hello', label: 'Chào khi vào game', default: 'Welcome', vars: [] },
  { key: 'ptera.grab', group: 'ptera', label: 'Gắp được', default: 'Đã gắp {name}', vars: ['name'] },
  { key: 'guard.warn', group: 'guard', label: 'Cảnh báo vùng', default: 'Ra khỏi {zone}', vars: ['zone'], offByDefault: true },
];
let server: Messages;
beforeEach(() => {
  clearDrafts();
  server = { texts: { 'hello.welcome': 'Chào' }, countdownMarks: [900, 60], periodic: [{ id: 'p1', text: 'Discord', everyMin: 30, enabled: true }],
    corpseWipe: { everyMin: 0, warnSec: 60 }, catalog: CATALOG };
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const bridge = fakeBridge('/api/messages', () => server, (b) => {
    // As the bridge: a new periodic gets an id; the answer has no catalog.
    const saved = { ...b, periodic: b.periodic.map((p: { id?: string }, i: number) => ({ ...p, id: p.id ?? `n${i}` })) };
    server = { ...saved, catalog: CATALOG };
    return saved;
  });
  bridge.show(<MessagesSettings />);
  return bridge;
}

test('loads the timing and the texts by group, with tags, count and examples', async () => {
  setup();
  expect(await screen.findByLabelText(/Mốc đếm ngược/)).toHaveValue('15p, 1p');
  expect(screen.getByText('3 tin · 1 đã sửa')).toBeInTheDocument();
  expect(screen.getByLabelText('Chào khi vào game')).toHaveValue('Chào');
  expect(screen.getByText('đã sửa')).toBeInTheDocument();
  expect(screen.getByText('mặc định tắt')).toBeInTheDocument();
  expect(screen.getByLabelText('Cảnh báo vùng')).toBeDisabled();
  expect(screen.getByText('Đã gắp Rex')).toBeInTheDocument();
  await userEvent.type(screen.getByRole('searchbox', { name: 'Tìm tin' }), 'gắp');
  expect(screen.queryByLabelText('Chào khi vào game')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Gắp được')).toBeInTheDocument();
});

test('edits: a text, a variable, Gửi, Về mặc định, marks, a periodic; saved without the catalog', async () => {
  const { puts } = setup();
  const grab = await screen.findByLabelText('Gắp được');
  await userEvent.clear(grab);
  await userEvent.type(grab, 'Bắt ');
  const item = grab.closest('div')!.parentElement!;
  await userEvent.click(within(item).getByRole('button', { name: '{name}' }));
  expect(grab).toHaveValue('Bắt {name}');
  // Turn the off-by-default one on: its suggested text is what gets sent.
  const guard = screen.getByLabelText('Cảnh báo vùng').closest('div')!.parentElement!;
  await userEvent.click(within(guard).getByRole('switch', { name: 'Gửi' }));
  expect(screen.getByLabelText('Cảnh báo vùng')).toBeEnabled();
  // The welcome back to its default.
  const welcome = screen.getByLabelText('Chào khi vào game').closest('div')!.parentElement!;
  await userEvent.click(within(welcome).getByRole('button', { name: 'Về mặc định' }));
  expect(screen.getByLabelText('Chào khi vào game')).toHaveValue('Welcome');
  const marks = screen.getByLabelText(/Mốc đếm ngược/);
  await userEvent.clear(marks);
  await userEvent.type(marks, '5p, 30s');
  await userEvent.click(screen.getByRole('button', { name: '+ Thêm thông báo định kỳ' }));
  await userEvent.type(screen.getAllByLabelText('Nội dung thông báo định kỳ')[1]!, 'Luật server');
  await userEvent.click(screen.getByRole('button', { name: 'Lưu thông báo' }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]).toEqual({ token: 'tok', body: {
    texts: { 'ptera.grab': 'Bắt {name}', 'guard.warn': 'Ra khỏi {zone}' },
    countdownMarks: [300, 30],
    periodic: [{ id: 'p1', text: 'Discord', everyMin: 30, enabled: true }, { text: 'Luật server', everyMin: 30, enabled: true }],
    corpseWipe: { everyMin: 0, warnSec: 60 },
  } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu thông báo' })).toBeDisabled());
  expect(screen.getByText('3 tin · 2 đã sửa')).toBeInTheDocument();
});

test('unreadable marks are flagged', async () => {
  setup();
  const marks = await screen.findByLabelText(/Mốc đếm ngược/);
  await userEvent.clear(marks);
  await userEvent.type(marks, '5 xyz');
  expect(marks).toHaveAttribute('aria-invalid', 'true');
});

test('emptying a text: the box stays open while typing, and "" (not sent) is what is saved', async () => {
  const { puts } = setup();
  const welcome = await screen.findByLabelText('Chào khi vào game');
  await userEvent.clear(welcome);
  expect(welcome).toBeEnabled();
  expect(welcome).toHaveValue('');
  expect(screen.getByText('đã tắt')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Lưu thông báo' }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.body.texts).toEqual({ 'hello.welcome': '' });
});
