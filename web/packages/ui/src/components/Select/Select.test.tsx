import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from './Select';

const OPTS = [{ value: 'a', label: 'Một' }, { value: 'b', label: 'Hai' }, { value: 'c', label: 'Ba' }] as const;

function Box({ seen }: { seen: string[] }) {
  const [v, setV] = useState<'a' | 'b' | 'c'>('a');
  return <Select aria-label="Chọn" value={v} options={OPTS} onChange={(x) => { seen.push(x); setV(x); }} />;
}

test('a click opens the list, a click on an option picks it and closes', async () => {
  const seen: string[] = [];
  render(<Box seen={seen} />);
  const btn = screen.getByRole('button', { name: 'Chọn' });
  expect(btn).toHaveTextContent('Một');
  await userEvent.click(btn);
  expect(screen.getByRole('option', { name: 'Một' })).toHaveAttribute('aria-selected', 'true');
  await userEvent.click(screen.getByRole('option', { name: 'Ba' }));
  expect(seen).toEqual(['c']);
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(btn).toHaveTextContent('Ba');
});

test('keys: arrows move, Enter picks, Esc closes without a change', async () => {
  const seen: string[] = [];
  render(<Box seen={seen} />);
  screen.getByRole('button', { name: 'Chọn' }).focus();
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
  expect(seen).toEqual(['b']);
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{Escape}');
  expect(seen).toEqual(['b']);
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});
