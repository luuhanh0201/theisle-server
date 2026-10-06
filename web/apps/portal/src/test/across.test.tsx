import { act, fireEvent, render } from '@testing-library/react';
import { CommandPalette, PALETTE, paletteResults } from '../app/CommandPalette';
import { TOUR_KEY, TOUR_STEPS, Tour, useTour } from '../app/Tour';
import { ToastProvider } from '../app/toast';

afterEach(() => { location.hash = ''; vi.useRealTimers(); vi.unstubAllGlobals(); });
const key = (k: string, extra: KeyboardEventInit = {}) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra })); });

describe('command palette', () => {
  it('the entries, a search by title, text or group', () => {
    expect(PALETTE).toHaveLength(40);
    expect(paletteResults('').map((i) => i.cat)).toEqual([...paletteResults('')].map((i) => i.cat).sort((a, b) => ['pages', 'species', 'commands', 'locations'].indexOf(a) - ['pages', 'species', 'commands', 'locations'].indexOf(b)));
    expect(paletteResults('!slay').map((i) => i.id)).toEqual(['cmd-slay']);
    expect(paletteResults('LỆNH CHAT').every((i) => i.cat === 'commands')).toBe(true);
  });
  it('Ctrl+K opens it, arrows and Enter go, Esc closes; nothing found says so', () => {
    const onTour = vi.fn();
    const { container } = render(<ToastProvider><CommandPalette onTour={onTour} /></ToastProvider>);
    const modal = container.querySelector('#cmd-palette-modal') as HTMLElement;
    expect(modal.hidden).toBe(true);
    key('k', { ctrlKey: true });
    expect(modal.hidden).toBe(false);
    expect(container.querySelector('.cmd-item.active')?.getAttribute('data-cmd-id')).toBe('action-join-direct');
    const input = container.querySelector('#cmd-search-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'gara' } });
    expect(container.querySelector('.cmd-item.active')?.getAttribute('data-cmd-id')).toBe('page-gara');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(location.hash).toBe('#gara');
    expect(modal.hidden).toBe(true);
    key('k', { metaKey: true });
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(container.querySelector('#cmd-results-list')?.textContent).toBe('🔍Không tìm thấy kết quả phù hợp với "zzz"');
    key('Escape');
    expect(modal.hidden).toBe(true);
    key('k', { ctrlKey: true });
    fireEvent.change(input, { target: { value: 'tour' } });
    fireEvent.click(container.querySelector('[data-cmd-id="action-tour"]') as HTMLElement);
    expect(onTour).toHaveBeenCalled();
  });
  it('a species: Skin Studio and a toast; a place: the map', () => {
    const { container } = render(<ToastProvider><CommandPalette onTour={() => undefined} /></ToastProvider>);
    key('k', { ctrlKey: true });
    fireEvent.click(container.querySelector('[data-cmd-id="dino-trex"]') as HTMLElement);
    expect(location.hash).toBe('#skin');
    expect(container.querySelector('#global-toast')?.textContent).toBe('Đã chọn loài T-Rex trong Skin Studio');
    key('k', { ctrlKey: true });
    fireEvent.click(container.querySelector('[data-cmd-id="loc-dam"]') as HTMLElement);
    expect(location.hash).toBe('#map');
  });
});

function Host() {
  const t = useTour();
  return <><button type="button" id="start" onClick={t.start} /><Tour step={t.step} setStep={t.setStep} /></>;
}
describe('tour', () => {
  it('opens by itself a second after a first visit; steps go to their page; done marks it seen', () => {
    localStorage.removeItem(TOUR_KEY);
    vi.useFakeTimers();
    const { container } = render(<ToastProvider><Host /></ToastProvider>);
    const back = container.querySelector('#tour-backdrop') as HTMLElement;
    expect(back.hidden).toBe(true);
    act(() => { vi.advanceTimersByTime(1100); });
    expect(back.hidden).toBe(false);
    expect(container.querySelector('#tour-step-badge')?.textContent).toBe(TOUR_STEPS[0]?.badge);
    expect((container.querySelector('#tour-btn-prev') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(container.querySelector('#tour-btn-next') as HTMLElement);
    expect(location.hash).toBe('#gara');
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    expect(location.hash).toBe('#map');
    // A page opened during a step stays (the step's page is opened when the step is shown).
    act(() => { location.hash = '#ranking'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(location.hash).toBe('#ranking');
    fireEvent.click(container.querySelectorAll('.tour-dot')[4] as HTMLElement);
    expect(container.querySelector('#tour-btn-next')?.textContent).toBe('✓ Bắt đầu trải nghiệm');
    fireEvent.click(container.querySelector('#tour-btn-next') as HTMLElement);
    expect(back.hidden).toBe(true);
    expect(localStorage.getItem(TOUR_KEY)).toBe('1');
    expect(container.querySelector('#global-toast')?.textContent).toBe('✓ Bạn đã hoàn thành tour hướng dẫn! Có thể mở lại bất cứ lúc nào ở nút 💡 Hướng dẫn.');
  });
  it('seen already: not opened; Hướng dẫn opens it, Esc skips it', () => {
    localStorage.setItem(TOUR_KEY, '1');
    vi.useFakeTimers();
    const { container } = render(<ToastProvider><Host /></ToastProvider>);
    act(() => { vi.advanceTimersByTime(2000); });
    const back = container.querySelector('#tour-backdrop') as HTMLElement;
    expect(back.hidden).toBe(true);
    fireEvent.click(container.querySelector('#start') as HTMLElement);
    expect(back.hidden).toBe(false);
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(back.hidden).toBe(true);
  });
});
