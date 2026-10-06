import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateTimeInput, parseDateTime, shownDateTime } from './DateTimeInput';

function Box({ kind, start, seen }: { kind: 'time' | 'date' | 'datetime'; start: string; seen: string[] }) {
  const [v, setV] = useState(start);
  return <DateTimeInput aria-label="Lúc" kind={kind} value={v} onChange={(x) => { seen.push(x); setV(x); }} />;
}

test('values in the native formats, shown the Vietnamese way', () => {
  expect(parseDateTime('2026-10-06T21:30')).toEqual({ y: 2026, m: 9, d: 6, h: 21, mi: 30 });
  expect(shownDateTime('datetime', '2026-10-06T21:30')).toBe('06/10/2026 21:30');
  expect(shownDateTime('date', '2026-10-06')).toBe('06/10/2026');
  expect(shownDateTime('time', '04:05')).toBe('04:05');
  expect(shownDateTime('datetime', '')).toBe('');
});

test('time: + and a quick time, Xong gives "HH:MM"', async () => {
  const seen: string[] = [];
  render(<Box kind="time" start="04:00" seen={seen} />);
  await userEvent.click(screen.getByRole('button', { name: 'Lúc' }));
  await userEvent.click(screen.getByRole('button', { name: 'Giờ tăng' }));
  await userEvent.click(screen.getByRole('button', { name: 'Phút tăng' }));
  await userEvent.click(screen.getByRole('button', { name: 'Xong' }));
  expect(seen).toEqual(['05:05']);
  await userEvent.click(screen.getByRole('button', { name: 'Lúc' }));
  await userEvent.click(screen.getByRole('button', { name: '18:00' }));
  await userEvent.click(screen.getByRole('button', { name: 'Xong' }));
  expect(seen).toEqual(['05:05', '18:00']);
  expect(screen.getByRole('button', { name: 'Lúc' })).toHaveTextContent('18:00');
});

test('datetime: a day and an hour typed; Esc drops the change', async () => {
  const seen: string[] = [];
  render(<Box kind="datetime" start="2026-10-06T00:00" seen={seen} />);
  await userEvent.click(screen.getByRole('button', { name: 'Lúc' }));
  await userEvent.click(screen.getByRole('button', { name: '10/10/2026' }));
  const h = screen.getByRole('textbox', { name: 'Giờ' });
  await userEvent.clear(h);
  await userEvent.type(h, '21{Enter}');
  await userEvent.click(screen.getByRole('button', { name: 'Xong' }));
  expect(seen).toEqual(['2026-10-10T21:00']);
  await userEvent.click(screen.getByRole('button', { name: 'Lúc' }));
  await userEvent.click(screen.getByRole('button', { name: '12/10/2026' }));
  await userEvent.keyboard('{Escape}');
  expect(seen).toEqual(['2026-10-10T21:00']);
});
