import { goTo } from './router';

/**
 * "Luật & Dinh Dưỡng" (the web's menu): Trang chủ, scrolled to the rules, which light up for 2 s (data-action="open-rules").
 * The launcher's look has no such entry (owner, 2026-10-07).
 */
export function openRules(): void {
  goTo('home');
  // Trang chủ may not be drawn yet (a page is drawn the first time it is opened): wait a few frames for it.
  let tries = 30;
  const go = (): void => {
    const sec = document.getElementById('server-rules-section');
    if (!sec || sec.closest('[hidden]')) { if (--tries > 0) requestAnimationFrame(go); return; }
    sec.scrollIntoView({ behavior: 'smooth' });
    sec.classList.add('highlight-section');
    window.setTimeout(() => sec.classList.remove('highlight-section'), 2000);
  };
  requestAnimationFrame(go);
}
