import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { NumberInput } from './NumberInput';

function Harness({ start = 5, min = 0, max = 10, step = 1 }: { start?: number; min?: number; max?: number; step?: number }) {
  const [v, setV] = useState(start);
  return <><NumberInput aria-label="n" value={v} min={min} max={max} step={step} onChange={setV} /><output>{v}</output></>;
}

test('− / + step the value and stop at the limits', async () => {
  render(<Harness start={9} />);
  await userEvent.click(screen.getByLabelText('Tăng'));
  expect(document.querySelector('output')).toHaveTextContent('10');
  expect(screen.getByLabelText('Tăng')).toBeDisabled();
  await userEvent.click(screen.getByLabelText('Giảm'));
  expect(document.querySelector('output')).toHaveTextContent('9');
});

test('typed text is clamped when the box is left; nonsense goes back to the last value', async () => {
  render(<Harness />);
  const box = screen.getByLabelText('n');
  await userEvent.clear(box);
  await userEvent.type(box, '42');
  fireEvent.blur(box);
  expect(document.querySelector('output')).toHaveTextContent('10');
  await userEvent.clear(box);
  await userEvent.type(box, 'abc');
  fireEvent.blur(box);
  expect(box).toHaveValue('10');
});

test('a decimal step keeps its decimals, a comma is read as a point', async () => {
  render(<Harness start={0.1} max={1} step={0.1} />);
  await userEvent.click(screen.getByLabelText('Tăng'));
  expect(document.querySelector('output')).toHaveTextContent('0.2');
  const box = screen.getByLabelText('n');
  await userEvent.clear(box);
  await userEvent.type(box, '0,5{Enter}');
  expect(document.querySelector('output')).toHaveTextContent('0.5');
});
