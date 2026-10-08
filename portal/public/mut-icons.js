/*
 * mut-icons.js, the mutation icons, on every page that shows them (the
 * portal's Túi đồ, the admin panel, the bridge serves this file and the
 * icons from the portal). One request for all of them (img/mutations/icons.json,
 * scripts/build-mutation-icons.mjs), kept in memory: one <img> a mutation, one
 * request each, again at every redraw (the icons were not cached) tripped the
 * proxy in front of the site, 503 on about half of them (2026-10-02).
 *
 * Write <img data-mut-icon="Mutation name or slug" alt="">: this fills its src
 * (a data: URI) once the icons are here, also for images drawn later. A name
 * with no icon keeps no src (hidden by the page's own CSS if it wants).
 * Load as a classic script: <script src="/mut-icons.js"></script>.
 */
(() => {
  if (window.MutIcons) return;
  const slug = (name) => String(name ?? '').replace(/^MUT_/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let uris = null;   // slug → data: URI
  const fill = (img) => {
    if (uris === null || img.dataset.mutFilled === '1') return;
    const uri = uris[slug(img.dataset.mutIcon)];
    if (!uri) return;
    img.src = uri;
    img.dataset.mutFilled = '1';
  };
  const scan = (root) => {
    if (root.matches?.('img[data-mut-icon]')) fill(root);
    root.querySelectorAll?.('img[data-mut-icon]').forEach(fill);
  };
  // A failed fetch (the proxy, the player's network) is tried again after 1, 2, 4… up to 30 s, at once when the
  // network comes back (owner, 2026-10-08: icons must show once they can load); the icons fill in when it comes.
  const RETRY_MS = [1000, 2000, 4000, 8000, 15000, 30000];
  const get = (n) => fetch('/img/mutations/icons.json', { credentials: 'same-origin' })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .catch(() => new Promise((resolve) => {
      let timer = null;
      const again = () => { clearTimeout(timer); window.removeEventListener('online', again); resolve(get(n + 1)); };
      timer = setTimeout(again, RETRY_MS[Math.min(n, RETRY_MS.length - 1)]);
      window.addEventListener('online', again);
    }));
  const ready = get(0)
    .then((svgs) => {
      uris = {};
      for (const [k, svg] of Object.entries(svgs)) uris[k] = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      if (document.body) scan(document.body);
    });
  const start = () => {
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') { m.target.dataset.mutFilled = ''; fill(m.target); continue; }
        for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-mut-icon'] });
    scan(document.body);
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  window.MutIcons = { slug, ready, has: (name) => uris !== null && Boolean(uris[slug(name)]) };
})();
