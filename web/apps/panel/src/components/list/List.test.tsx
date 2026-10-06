import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pager, pageOf } from './List';

test('the pager: what is shown, the pages around, ‹ ›', async () => {
  const seen: number[] = [];
  render(<Pager total={95} page={5} limit={10} unit="người chơi" onPage={(p) => seen.push(p)} />);
  expect(screen.getByText('Hiển thị 41-50 / 95 người chơi · trang 5/10')).toBeInTheDocument();
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['‹', '1', '3', '4', '5', '6', '7', '10', '›']);
  await userEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  expect(seen).toEqual([6]);
});

test('a page kept within the list when it shrinks', () => {
  expect(pageOf([1, 2, 3, 4, 5], 9, 2)).toEqual({ rows: [5], page: 3 });
  expect(pageOf([], 2, 20)).toEqual({ rows: [], page: 1 });
});
