// Old page vs React page, part by part, for the player site's flows: a flow on the site before React
// saves what each part shows (`save`), the same flow on /next/ checks it shows the same (`same`).
// A part is a CSS selector: its shown text (innerText, white space folded; '' when not drawn), or with
// `@attr` an attribute of the first match (e.g. '#tele-go@disabled', '#game-hero-card@class'; null when not drawn).
export const PARTS = (parts) => `const __parts = ${JSON.stringify(parts)};
  const __read = (sel) => {
    const [css, attr] = sel.split('@');
    if (attr) {
      const e = document.querySelector(css);
      // Not drawn (a hidden card): nothing to compare but its class.
      if (!e || (attr !== 'class' && !e.getClientRects().length)) return null;
      if (attr === 'disabled' || attr === 'hidden') return e[attr] === true || e.closest('[hidden]') !== null && attr === 'hidden';
      if (attr === 'width') return e.style.width;
      return e.getAttribute(attr);
    }
    return [...document.querySelectorAll(css)].map((e) => (e.getClientRects().length ? e.innerText : '').replace(/\\s+/g, ' ').trim()).filter(Boolean).join(' | ');
  };
  const snap = Object.fromEntries(__parts.map((p) => [p, __read(p)]));`;
/** Save what the old page shows under `key` (localStorage, shared with the next flows). */
export const save = (key, parts) => `${PARTS(parts)} localStorage.setItem('${key}', JSON.stringify(snap)); check('old page read', Object.values(snap).some((v) => v), snap);`;
/** Check the React page shows the same as saved under `key`. */
export const same = (key, parts) => `${PARTS(parts)}
  const old = JSON.parse(localStorage.getItem('${key}') ?? 'null');
  check('the old page was read', old !== null);
  for (const k of Object.keys(snap)) check('same as before React: ' + k, JSON.stringify(snap[k]) === JSON.stringify(old?.[k]), { new: snap[k], old: old?.[k] });`;
