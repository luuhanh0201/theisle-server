// The big map over the game (bigmap.html): the launcher opens it on its key (M) in a see-through
// window. The map is the launcher's own (map.js: drag, zoom, layers, a target, saved points), fed
// with what the player page already sends the overlay each second (your dino, the AI, the fish,
// escaped inmates, the AI zones). Layers, target and trail are kept in this site's storage: the map
// tab and the mini map follow every change made here.
import { createMap, LOOK_DEFAULT } from './map.js';

const L = window.isleLauncher;
const $ = (id) => document.getElementById(id);
// A tap off the island's picture closes the map (owner, 2026-10-05), it no longer drops a target there.
const map = createMap($('map'), { overlay: true, onOutsideTap: () => close() });

// How see-through: the island and the veil over the game, kept in this browser.
const LOOK_KEY = 'isle-bigmap-look.v1';
function loadLook() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOOK_KEY) ?? 'null');
    return { map: Number.isFinite(raw?.map) ? raw.map : LOOK_DEFAULT.map, dim: Number.isFinite(raw?.dim) ? raw.dim : LOOK_DEFAULT.dim };
  } catch {
    return { ...LOOK_DEFAULT };
  }
}
const look = loadLook();
$('bm-map').value = String(Math.round(look.map * 100));
$('bm-dim').value = String(Math.round(look.dim * 100));
map.setLook(look);
for (const [id, field] of [['bm-map', 'map'], ['bm-dim', 'dim']]) {
  $(id).addEventListener('input', (e) => {
    look[field] = Number(e.target.value) / 100;
    map.setLook(look);
    try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* not remembered */ }
  });
}

function feed(g) {
  if (!g || typeof g !== 'object') return;
  map.update(g.dino ?? null);
  map.setAi(g.ai ?? []);
  map.setFish(g.fish ?? []);
  map.setEscapees(g.escapees ?? []);
  map.setFriends(Array.isArray(g.friends) ? g.friends : null);
  if (Array.isArray(g.aiZones)) map.setAiZones(g.aiZones);
  if (g.heat !== undefined) map.setHeat(g.heat);
}

const close = () => { if (L?.bigMapClose) L.bigMapClose(); };
$('bm-close').addEventListener('click', close);
if (L?.keyLabel) $('bm-key').textContent = `· ${L.keyLabel('bigmap')} hoặc Esc để đóng`;

// A text box with the focus (a target's name): the map key types there instead of closing the map.
const typing = () => {
  const el = document.activeElement;
  return Boolean(el && (el.tagName === 'INPUT' && el.type !== 'range' || el.tagName === 'TEXTAREA' || el.isContentEditable));
};
document.addEventListener('focusin', () => L?.bigMapTyping?.(typing()));
document.addEventListener('focusout', () => setTimeout(() => L?.bigMapTyping?.(typing()), 0));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (typing()) { document.activeElement.blur(); return; }
  close();
});

// Each time it opens: the whole island in the middle of the screen again, also once the window has
// gone full screen (it opens smaller first), until you move or zoom the map yourself.
let untouched = true;
L?.onBigMap?.((open) => { if (open) { untouched = true; map.resetView(); } });
window.addEventListener('resize', () => { if (untouched) map.resetView(); });
for (const ev of ['pointerdown', 'wheel']) $('map').addEventListener(ev, () => { untouched = false; }, { passive: true });

if (L?.onOverlayGame) {
  L.onOverlayGame(feed);
  feed(L.overlayGameGet?.());
} else {
  // Opened in a browser: the map, nothing live (that comes from the launcher).
  map.update(null);
}
