import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NewsSettings as News } from '@isle/api';
import { clearDrafts } from '../../settings-form/drafts';
import { fakeBridge } from '../../../test/fakeBridge';
import { NewsSettings } from './NewsSettings';

let server: News;
beforeEach(() => {
  clearDrafts();
  server = { items: [{ id: 'n_1', title: 'Bản 1.0', body: 'Dòng 1\nDòng 2', at: 1_791_296_000, shown: true }], limits: { items: 50, title: 120, body: 3000 } };
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const bridge = fakeBridge('/api/news', () => server, (b) => {
    // As the bridge: a new note gets an id and a date.
    const saved = { items: b.items.map((n: { id?: string; at?: number }, i: number) => ({ ...n, id: n.id ?? `n_new${i}`, at: n.at ?? 1_791_300_000 })) };
    server = { ...saved, limits: server.limits };
    return saved;
  });
  bridge.show(<NewsSettings />);
  return bridge;
}

test('loads the notes; writes a new one on top, hides the old one, saves the list with the token', async () => {
  const { puts } = setup();
  expect(await screen.findByDisplayValue('Bản 1.0')).toBeInTheDocument();
  expect(screen.getByText('1 tin · 1 đang hiện')).toBeInTheDocument();
  expect(screen.getByText(/^Đăng lúc/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '+ Viết tin mới' }));
  const titles = screen.getAllByLabelText('Tiêu đề tin');
  expect(titles).toHaveLength(2);
  expect(screen.getByText(/ngày đăng là lúc bấm Lưu · cần tiêu đề/)).toBeInTheDocument();
  await userEvent.type(titles[0]!, 'Bản 1.1');
  await userEvent.type(screen.getAllByLabelText('Nội dung tin')[0]!, 'Kênh tin mới');
  await userEvent.click(screen.getAllByRole('switch')[1]!);
  await userEvent.click(screen.getByRole('button', { name: 'Lưu tin cập nhật' }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.token).toBe('tok');
  expect(puts[0]!.body).toEqual({ items: [
    { title: 'Bản 1.1', body: 'Kênh tin mới', shown: true },
    { id: 'n_1', title: 'Bản 1.0', body: 'Dòng 1\nDòng 2', at: 1_791_296_000, shown: false },
  ] });
  expect(await screen.findByText('2 tin · 1 đang hiện')).toBeInTheDocument();
});

test('Xoá takes a note off the list (saved with Lưu)', async () => {
  const { puts } = setup();
  await screen.findByDisplayValue('Bản 1.0');
  await userEvent.click(screen.getByRole('button', { name: 'Xoá' }));
  expect(screen.getByText('Chưa có tin nào.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Lưu tin cập nhật' }));
  await waitFor(() => expect(puts[0]?.body).toEqual({ items: [] }));
});
