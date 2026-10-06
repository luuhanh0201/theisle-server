import { goTo } from './router';

/** "Luật & Dinh Dưỡng": Trang chủ, scrolled to the rules, which light up for 2 s (data-action="open-rules"). */
export function openRules(): void {
  goTo('home');
  requestAnimationFrame(() => {
    const sec = document.getElementById('server-rules-section');
    if (!sec) return;
    sec.scrollIntoView({ behavior: 'smooth' });
    sec.classList.add('highlight-section');
    window.setTimeout(() => sec.classList.remove('highlight-section'), 2000);
  });
}
