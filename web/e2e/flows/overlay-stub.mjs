// The launcher's overlay calls (launcher/src/preload.js), over the LAUNCHER stub, for the Overlay flows: the settings
// kept here as the launcher would (overlaySet merges, reset, enabled), two screens and a box per widget (overlayLayout),
// key labels and captures (the edit key refused as taken), game mode's kept widgets, the big map's screen, the black-edge
// fix. Every call is recorded in window.__ov.calls; overlayGame / overlayMiniFrame count what the page hands over
// (__ov.games, __ov.lastGame, __ov.frames); the callbacks the launcher would call are in __ov.changed and __ov.bigMap.
import { LAUNCHER } from './launcher-stub.mjs';

export const OVERLAY = `${LAUNCHER} if (location.protocol === 'http:') {
  const show = (keys, off = []) => Object.fromEntries(keys.map((k) => [k, !off.includes(k)]));
  const W = (x) => ({ enabled: true, scale: 100, bg: 60, opacity: 100, ...x });
  const fresh = () => ({ enabled: true, widgets: {
    voice: W({ style: 'full', autoHide: 'idle', maxSpeakers: 3, show: show(['speakers', 'direction', 'self', 'range', 'toasts', 'warnings']) }),
    map: W({ radius: 500, shape: 'circle', rotate: 'north', show: show(['target', 'ai', 'trail', 'zones', 'water', 'landmarks', 'labels', 'coords'], ['coords']) }),
    dino: W({ layout: 'bars', show: show(['species', 'growth', 'health', 'hpValue', 'damage', 'stamina', 'hunger', 'thirst', 'blood', 'oxygen', 'prime', 'tierFx'], ['blood']) }),
    quests: W({ enabled: false, hideDone: false, show: show(['deadline', 'passive'], ['passive']) }),
  } });
  let s = fresh();
  const pos = { voice: [20, 20], map: [1600, 40], dino: [20, 800], quests: [1960, 40] };
  const ov = window.__ov = { calls: [], games: 0, frames: 0, lastGame: null, editing: false, keep: { voice: true, map: true, dino: false, quests: false },
    labels: { overlay: 'F8', edit: 'F9', bigmap: 'M' }, display: 'auto' };
  const rec = (k, v) => ov.calls.push(k + (v === undefined ? '' : ' ' + JSON.stringify(v)));
  const copy = () => JSON.parse(JSON.stringify(s));
  const L = window.isleLauncher;
  L.keyLabel = (k) => ov.labels[k] ?? '?';
  L.captureKey = async (k) => { rec('captureKey', k); await new Promise((r) => setTimeout(r, 300)); if (k === 'edit') return { error: 'Phím này đã dùng cho việc khác' }; ov.labels[k] = 'F7'; return null; };
  L.overlayGet = () => ({ settings: copy(), editing: ov.editing, sizes: { map: [260, 260] } });
  L.overlaySet = async (p) => {
    rec('overlaySet', p);
    if (p.widget) {
      const id = p.widget;
      if (p.reset) s.widgets[id] = fresh().widgets[id];
      else { const { widget, show: sh, ...rest } = p; s.widgets[id] = { ...s.widgets[id], ...rest, show: { ...s.widgets[id].show, ...(sh || {}) } }; }
    } else if (typeof p.enabled === 'boolean') s.enabled = p.enabled;
    return copy();
  };
  L.overlayLayout = () => ({
    displays: [{ id: 'primary', bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, { id: 'd2', bounds: { x: 1920, y: 0, width: 1280, height: 1024 } }],
    widgets: Object.fromEntries(Object.entries(s.widgets).map(([id, w]) => [id, { enabled: w.enabled, scale: w.scale,
      bounds: { x: pos[id][0], y: pos[id][1], width: Math.round(260 * w.scale / 100), height: Math.round(140 * w.scale / 100) } }])),
  });
  L.overlayPlace = (id, at) => { rec('overlayPlace', [id, at]); pos[id] = [at.x, at.y]; s.widgets[id].scale = at.scale; };
  L.overlayPreview = () => rec('overlayPreview');
  L.overlayEdit = (on) => { rec('overlayEdit', on); ov.editing = on; };
  L.onOverlayChanged = (cb) => { ov.changed = cb; };
  L.gameModeGet = () => ({ on: false, keep: { ...ov.keep } });
  L.gameModeKeep = (k) => { rec('gameModeKeep', k); Object.assign(ov.keep, k); };
  L.bigMapClose = () => rec('bigMapClose');
  L.bigMapDisplayGet = () => ({ value: ov.display, choices: [{ id: 'd1', label: 'Màn hình 1 (1920×1080)' }, { id: 'd2', label: 'Màn hình 2 (1280×1024)' }] });
  L.bigMapDisplaySet = (id) => { rec('bigMapDisplaySet', id); ov.display = id; };
  L.overlayCompatGet = () => ({ saved: false });
  L.overlayCompatSet = (on) => rec('overlayCompatSet', on);
  L.overlayGame = (g) => { ov.games++; ov.lastGame = g; };
  L.overlayMiniFrame = async (f) => { ov.frames++; ov.lastFrame = f.type; };
  L.onBigMap = (cb) => { ov.bigMap = cb; };
}`;
