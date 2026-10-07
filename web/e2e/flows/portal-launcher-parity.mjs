// The page flows again, their React half in the launcher's own look (app/launcher/): the same steps, the same results
// as the site before React (each module's old half runs first and saves what it saw, as in its own file). The page
// inside the launcher is drawn every 5 s while its window has no focus (lib/queries.ts), so these are slower.
// Run with LIVE_COOKIE and REX_COOKIE as the page flows.
import { LAUNCHER_UI } from './launcher-stub.mjs';
import bag from './portal-bag.mjs';
import gara from './portal-gara.mjs';
import overlay from './portal-overlay.mjs';
import ranking from './portal-ranking.mjs';
import shop from './portal-shop.mjs';
import skin from './portal-skin.mjs';

// The launcher stub (with its own look) before the flow's own init; a flow already in the launcher: its own look.
const inLook = (f) => (f.old ? f : {
  ...f, name: `${f.name} [launcher look]`,
  init: /isleLauncher/.test(f.init ?? '') ? `if (location.protocol === 'http:') window.__lxUi = true; ${f.init}` : `${LAUNCHER_UI} ${f.init ?? ''}`,
  run: `if (!document.documentElement.classList.contains('lx-ui')) check('(the launcher look is on)', false); ${relax(f.run)}`,
});
// The overlay's layout is narrower in the launcher look (beside the settings): the same drag moves the box further on
// the real screen. The drag is checked for its widget and size; the rest as is.
const relax = (run) => run.replace('"drag",', '').replace(/check\('the mini map got pictures'/, `check('drag: the box placed (its widget, its size)', /^overlayPlace \\["voice",\\{"x":\\d+,"y":\\d+,"scale":100\\}\\]$/.test(out.drag?.[1]?.[0] ?? ''), out.drag); check('the mini map got pictures'`);
// Skin, the overlay, then Gara first: they need the in-game dino as local-portal.sh seeds it (a fresh stack; Gara stores it);
// the bag before the shop (a buy changes what is in the bag).
export default [...skin, ...overlay, ...gara, ...ranking, ...bag, ...shop].map(inLook);
