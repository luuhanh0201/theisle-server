import { afterEach, beforeEach, vi } from 'vitest';
import { IMG_RETRY_DELAYS_MS, retryImages } from './imgRetry';

let stop: () => void;
beforeEach(() => { vi.useFakeTimers(); stop = retryImages(document); });
afterEach(() => { stop(); vi.useRealTimers(); document.body.innerHTML = ''; });

const img = (src: string): HTMLImageElement => {
  const el = document.createElement('img');
  el.src = src;
  document.body.append(el);
  return el;
};
const fail = (el: HTMLImageElement): void => { el.dispatchEvent(new Event('error')); };
const load = (el: HTMLImageElement): void => { el.dispatchEvent(new Event('load')); };

test('a failed image is hidden, asked again after a second with a new address, shown when it loads', () => {
  const logo = img('https://xomgay.online/img/logo-96.webp');
  fail(logo);
  expect(logo.style.visibility).toBe('hidden');
  expect(logo.src).toBe('https://xomgay.online/img/logo-96.webp');
  vi.advanceTimersByTime(IMG_RETRY_DELAYS_MS[0] as number);
  expect(logo.src).toMatch(/^https:\/\/xomgay\.online\/img\/logo-96\.webp\?imgRetry=\d+$/);
  load(logo);
  expect(logo.style.visibility).toBe('');
  expect(logo.dataset.imgSrc).toBeUndefined();
});

test('it keeps trying, waiting longer each time; after the last try it stays hidden until the network is back', () => {
  const el = img('https://xomgay.online/amber.svg?v=2');
  const seen: string[] = [];
  for (const ms of IMG_RETRY_DELAYS_MS) {
    const before = el.src;
    fail(el);
    vi.advanceTimersByTime(ms - 1);
    expect(el.src).toBe(before);   // not before its time
    vi.advanceTimersByTime(1);
    expect(seen).not.toContain(el.src);   // each try a new request
    expect(new URL(el.src).searchParams.get('v')).toBe('2');   // the page's own query kept
    seen.push(el.src);
  }
  fail(el);
  vi.advanceTimersByTime(120_000);
  expect(el.src).toBe(seen.at(-1));
  expect(el.style.visibility).toBe('hidden');
  window.dispatchEvent(new Event('online'));
  expect(el.src).not.toBe(seen.at(-1));
  load(el);
  expect(el.style.visibility).toBe('');
});

test('the page moving the image to another address starts its tries again; data: images are left alone', () => {
  const el = img('https://xomgay.online/img/a.webp');
  for (let i = 0; i < 3; i++) { fail(el); vi.advanceTimersByTime(60_000); }
  el.src = 'https://xomgay.online/img/b.webp';
  fail(el);
  expect(el.dataset.imgSrc).toBe('https://xomgay.online/img/b.webp');
  expect(el.dataset.imgTry).toBe('1');
  const data = img('data:image/svg+xml,%3Csvg%2F%3E');
  fail(data);
  expect(data.style.visibility).toBe('');
  expect(data.dataset.imgSrc).toBeUndefined();
});

test('an image taken off the page is not asked again; stopping cancels the waiting tries', () => {
  const gone = img('https://xomgay.online/img/x.webp');
  fail(gone);
  gone.remove();
  vi.advanceTimersByTime(1000);
  expect(gone.src).toBe('https://xomgay.online/img/x.webp');
  const kept = img('https://xomgay.online/img/y.webp');
  fail(kept);
  stop();
  vi.advanceTimersByTime(1000);
  expect(kept.src).toBe('https://xomgay.online/img/y.webp');
  stop = () => undefined;
});
