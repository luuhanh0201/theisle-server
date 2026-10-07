import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
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

test('a key right after the box is drawn is kept (nothing puts the first value back over it)', async () => {
  // Drawn by an ordinary render (data that came back), a key as soon as the page changes, before React's
  // effects run: what a busy machine gave Cửa hàng's test (2026-10-07, the old effect put "1" back over "2").
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const before = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    const typed = new Promise<string>((done) => {
      new MutationObserver((_, mo) => {
        const box = host.querySelector('input');
        if (!box) return;
        mo.disconnect();
        // A key, as the browser sends it.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, '2');
        box.dispatchEvent(new Event('input', { bubbles: true }));
        done(box.value);
      }).observe(host, { childList: true, subtree: true });
    });
    root.render(<Harness start={1} />);
    expect(await typed).toBe('2');
  } finally {
    root.unmount();
    host.remove();
    g.IS_REACT_ACT_ENVIRONMENT = before;
  }
});
