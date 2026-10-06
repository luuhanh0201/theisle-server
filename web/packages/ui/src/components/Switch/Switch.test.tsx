import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from './Switch';

test('a switch (role switch), its label clicks it', async () => {
  const seen: boolean[] = [];
  render(<Switch checked={false} onChange={(v) => seen.push(v)} label="Bật" />);
  await userEvent.click(screen.getByText('Bật'));
  expect(seen).toEqual([true]);
  expect(screen.getByRole('switch')).not.toBeChecked();
});
