/**
 * Images that failed to load are fetched again, hidden meanwhile (owner, 2026-10-08: the server's logo in the
 * launcher stayed a broken-image icon). The site sits behind a proxy (OneShield) and players' networks drop
 * now and then: one failed request left the browser's broken icon there until the page was reloaded.
 *
 * Every <img> of the page, also those drawn later: on an error it is hidden (visibility, so the layout stays)
 * and asked again after 1, 2, 4, 8, 15, 30 s, at once when the network comes back; shown as soon as it loads.
 * After the last try it stays hidden (no broken icon) until the network comes back. data: / blob: images are
 * not fetched, so not retried.
 */
export const IMG_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];
/** The query parameter that makes each try a new request (a failed answer may be kept by the browser). */
const PARAM = 'imgRetry';

const base = (src: string): string | null => {
  if (!/^https?:/i.test(src)) return null;
  try { const u = new URL(src); u.searchParams.delete(PARAM); return u.href; } catch { return null; }
};

/** Start watching `doc`; returns the function that stops it. */
export function retryImages(doc: Document = document): () => void {
  const win = doc.defaultView;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let seq = 0;

  const ask = (img: HTMLImageElement): void => {
    const orig = img.dataset.imgSrc;
    if (!orig || !img.isConnected) return;
    const u = new URL(orig);
    u.searchParams.set(PARAM, String(++seq));
    img.src = u.href;
  };

  const onError = (e: Event): void => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    const orig = base(img.currentSrc || img.src);
    if (orig === null) return;
    // A new address (the page changed src): its own tries.
    if (img.dataset.imgSrc !== orig) { img.dataset.imgSrc = orig; img.dataset.imgTry = '0'; }
    img.style.visibility = 'hidden';
    const n = Number(img.dataset.imgTry);
    if (n >= IMG_RETRY_DELAYS_MS.length) return;
    img.dataset.imgTry = String(n + 1);
    const t = setTimeout(() => { timers.delete(t); if (img.dataset.imgSrc === orig) ask(img); }, IMG_RETRY_DELAYS_MS[n]);
    timers.add(t);
  };

  const onLoad = (e: Event): void => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.imgSrc === undefined) return;
    img.style.visibility = '';
    delete img.dataset.imgSrc;
    delete img.dataset.imgTry;
  };

  // The network back: every image still missing, now (also those past their last try).
  const onOnline = (): void => {
    doc.querySelectorAll<HTMLImageElement>('img[data-img-src]').forEach((img) => { img.dataset.imgTry = '0'; ask(img); });
  };

  // load / error do not bubble: caught on the way down.
  doc.addEventListener('error', onError, true);
  doc.addEventListener('load', onLoad, true);
  win?.addEventListener('online', onOnline);
  return () => {
    doc.removeEventListener('error', onError, true);
    doc.removeEventListener('load', onLoad, true);
    win?.removeEventListener('online', onOnline);
    timers.forEach(clearTimeout);
    timers.clear();
  };
}
