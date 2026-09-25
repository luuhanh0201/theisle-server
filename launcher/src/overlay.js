'use strict';
/**
 * The in-game overlay: small transparent, always-on-top, click-through
 * windows over The Isle — one per widget:
 *
 *   voice   who is talking near you, your mic, your range (voice.js)
 *   map     a mini map around your dino (position, heading, trail, AI, places)
 *   dino    your dino's numbers (growth, health, stamina, food, water…)
 *   quests  the prime elder conditions and the growth deadline
 *
 * Only windows: nothing is injected into the game, so no anti-cheat concern —
 * which also means they show over the game in Borderless / Windowed mode, not
 * in exclusive fullscreen. Placed with the mouse: on the launcher's layout
 * editor (a small picture of your screens) or on the screen itself in edit
 * mode — drag to move, drag an edge or corner to resize, drop anywhere.
 */

const WIDGETS = ['voice', 'map', 'dino', 'quests'];
/** Which widgets game mode keeps, out of the box: voice and the dino's numbers. */
const GAME_MODE_KEEP = { voice: true, map: false, dino: true, quests: false };
/** The kept widgets as saved, never trusted as they come. */
function normaliseKeep(raw) {
  const out = { ...GAME_MODE_KEEP };
  if (raw && typeof raw === 'object') for (const id of WIDGETS) if (typeof raw[id] === 'boolean') out[id] = raw[id];
  return out;
}
const POSITIONS = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right', 'custom'];

/** Size of each widget's window at 100 %; content hugs the corner it sits in. */
const BASE = { voice: [340, 420], map: [260, 260], dino: [270, 250], quests: [320, 340] };

const COMMON = { enabled: false, position: 'top-left', offsetX: 24, offsetY: 24, custom: null, display: 'primary', scale: 100, opacity: 100, bg: 55 };

const DEFAULTS = {
  voice: {
    ...COMMON, enabled: true, position: 'middle-left', autoHide: 'idle', style: 'full', maxSpeakers: 5,
    show: { self: true, range: true, speakers: true, direction: true, toasts: true, warnings: true },
  },
  map: {
    ...COMMON, position: 'top-right', autoHide: 'never', radius: 500, shape: 'circle', rotate: 'north',
    show: { target: true, ai: true, trail: true, zones: true, water: true, landmarks: true, labels: false, coords: false },
  },
  dino: {
    ...COMMON, position: 'bottom-left', autoHide: 'never', layout: 'bars',
    show: {
      species: true, growth: true, health: true, hpValue: true, damage: true,
      stamina: true, hunger: true, thirst: true, blood: false, oxygen: false, prime: true,
    },
  },
  quests: {
    ...COMMON, position: 'top-left', offsetY: 120, autoHide: 'never', hideDone: false,
    show: { deadline: true, passive: true },
  },
};

const CHOICES = {
  autoHide: ['idle', 'never'],
  style: ['full', 'compact', 'minimal'],
  shape: ['circle', 'square'],
  rotate: ['north', 'heading'],
  layout: ['bars', 'numbers'],
  radius: [150, 300, 500, 1000, 2000],
};

const int = (v, min, max, fallback) => (Number.isInteger(v) && v >= min && v <= max ? v : fallback);

/** One widget's settings, from disk or from the page, never trusted as they come. */
function normaliseWidget(id, raw) {
  const d = DEFAULTS[id];
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = { ...d, show: { ...d.show } };
  if (r.show && typeof r.show === 'object') {
    for (const k of Object.keys(d.show)) if (typeof r.show[k] === 'boolean') out.show[k] = r.show[k];
  }
  if (typeof r.enabled === 'boolean') out.enabled = r.enabled;
  out.custom = r.custom && Number.isInteger(r.custom.x) && Number.isInteger(r.custom.y) ? { x: r.custom.x, y: r.custom.y } : null;
  out.position = POSITIONS.includes(r.position) ? r.position : d.position;
  if (out.position === 'custom' && out.custom === null) out.position = d.position;
  out.offsetX = int(r.offsetX, 0, 800, d.offsetX);
  out.offsetY = int(r.offsetY, 0, 800, d.offsetY);
  out.display = r.display === 'primary' || Number.isInteger(r.display) ? r.display : d.display;
  out.scale = int(r.scale, 50, 250, d.scale);
  out.opacity = int(r.opacity, 30, 100, d.opacity);
  out.bg = int(r.bg, 0, 100, d.bg);
  for (const [k, allowed] of Object.entries(CHOICES)) {
    if (k in d) out[k] = allowed.includes(r[k]) ? r[k] : d[k];
  }
  if ('maxSpeakers' in d) out.maxSpeakers = int(r.maxSpeakers, 1, 10, d.maxSpeakers);
  if ('hideDone' in d) out.hideDone = typeof r.hideDone === 'boolean' ? r.hideDone : d.hideDone;
  return out;
}

/**
 * All overlay settings. Before there were several widgets the voice
 * widget's settings were the whole object: those become `voice`.
 */
function normaliseOverlay(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const legacy = !r.widgets && ('position' in r || 'style' in r);
  const widgets = {};
  for (const id of WIDGETS) widgets[id] = normaliseWidget(id, legacy && id === 'voice' ? r : r.widgets?.[id]);
  return { enabled: typeof r.enabled === 'boolean' ? r.enabled : true, widgets };
}

/** Window bounds on a display (its full bounds: a borderless game covers the taskbar too). */
function widgetBounds(id, w, display) {
  const width = Math.round(BASE[id][0] * w.scale / 100);
  const height = Math.round(BASE[id][1] * w.scale / 100);
  const b = display.bounds;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fit = (x, y) => ({ x: clamp(x, b.x, b.x + b.width - width), y: clamp(y, b.y, b.y + b.height - height), width, height });
  if (w.position === 'custom' && w.custom) return fit(w.custom.x, w.custom.y);
  const [v, hz] = w.position.split('-');
  const x = hz === 'left' ? b.x + w.offsetX : hz === 'right' ? b.x + b.width - width - w.offsetX : b.x + Math.round((b.width - width) / 2);
  const y = v === 'top' ? b.y + w.offsetY : v === 'bottom' ? b.y + b.height - height - w.offsetY : b.y + Math.round((b.height - height) / 2);
  return fit(x, y);
}

/**
 * New scale when an edge / corner of a `width`×`height` box at `scale` % is
 * dragged by (dx, dy): proportions kept, a corner follows the bigger move.
 */
function resizedScale({ dir, width, height, scale }, dx, dy) {
  const kx = dir.includes('e') ? (width + dx) / width : dir.includes('w') ? (width - dx) / width : null;
  const ky = dir.includes('s') ? (height + dy) / height : dir.includes('n') ? (height - dy) / height : null;
  let k = kx ?? ky;
  if (kx !== null && ky !== null) k = Math.abs(kx - 1) > Math.abs(ky - 1) ? kx : ky;
  return Math.max(50, Math.min(250, Math.round(scale * k)));
}

/** Dropped within `px` of a screen edge: stick to it. */
function snap(r, b, px = 16) {
  let x = Math.round(r.x); let y = Math.round(r.y);
  if (Math.abs(x - b.x) < px) x = b.x;
  if (Math.abs(x + r.width - (b.x + b.width)) < px) x = Math.round(b.x + b.width - r.width);
  if (Math.abs(y - b.y) < px) y = b.y;
  if (Math.abs(y + r.height - (b.y + b.height)) < px) y = Math.round(b.y + b.height - r.height);
  return [x, y];
}

/** Which way the content hugs inside its window. */
const anchorOf = (w) => (w.position === 'custom' ? 'top-left' : w.position);

class Overlay {
  /**
   * @param deps.electron  Electron's BrowserWindow and screen
   * @param deps.load / deps.save  the "overlay" part of settings.json
   */
  constructor({ electron, preload, file, load, save }) {
    Object.assign(this, { electron, preload, file, load, save });
    this.settings = normaliseOverlay(load());
    this.wins = {};
    this.last = {};              // per window: the bounds / opacity / visibility last set
    this.hiddenByKey = false;
    this.editing = false;
    // Game mode (main.js): only the widgets the player keeps for it stay on.
    this.gameMode = false;
    this.keep = { ...GAME_MODE_KEEP };
    this.previewUntil = 0;
    this.voice = null;           // latest voice state
    this.game = null;            // latest { dino, ai } from the player page
    this.mapData = null;         // { json, image: ArrayBuffer } once fetched
  }

  /** Windows come and go with apply(): only widgets that are on (or all, while editing) have one. */
  create() {
    this.apply();
  }

  #createWidget(id) {
    const { BrowserWindow } = this.electron;
    const win = new BrowserWindow({
      ...this.#bounds(id), frame: false, transparent: true, resizable: false, movable: true, focusable: false,
      skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, fullscreenable: false,
      title: `Xóm Gáy overlay — ${id}`, backgroundColor: '#00000000',
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Only to look at, unless editing: clicks go through to the game.
    win.setIgnoreMouseEvents(!this.editing);
    win.setFocusable(this.editing);
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('moved', () => {
      if (!this.editing) return;
      const [x, y] = win.getPosition();
      this.#patch(id, { position: 'custom', custom: { x, y }, display: this.#displayAt(x, y) });
      if (this.onMoved) this.onMoved();
    });
    win.webContents.on('did-finish-load', () => {
      this.#sendSettings(id);
      if (id === 'voice' && this.voice) win.webContents.send('overlay:state', this.voice);
      if (id !== 'voice' && this.game) win.webContents.send('overlay:game', this.game);
      if (id === 'map' && this.mapData) win.webContents.send('overlay:map', this.mapData);
      this.apply();
    });
    win.on('closed', () => { if (this.wins[id] === win) { delete this.wins[id]; delete this.last[id]; } });
    win.loadFile(this.file, { query: { w: id } });
    this.wins[id] = win;
    this.last[id] = {};
  }

  #display(w) {
    const { screen } = this.electron;
    if (w.display !== 'primary') {
      const d = screen.getAllDisplays().find((x) => x.id === w.display);
      if (d) return d;
    }
    return screen.getPrimaryDisplay();
  }

  #displayAt(x, y) {
    const { screen } = this.electron;
    const d = screen.getDisplayNearestPoint({ x, y });
    return d.id === screen.getPrimaryDisplay().id ? 'primary' : d.id;
  }

  #bounds(id) { const w = this.settings.widgets[id]; return widgetBounds(id, w, this.#display(w)); }

  #send(id, channel, value) {
    const win = this.wins[id];
    if (win && !win.isDestroyed()) win.webContents.send(channel, value);
  }

  #sendSettings(id) {
    const w = this.settings.widgets[id];
    this.#send(id, 'overlay:settings', { ...w, id, anchor: anchorOf(w), editing: this.editing, overlayOn: this.settings.enabled });
  }

  #patch(id, patch) {
    const cur = this.settings.widgets[id];
    // Dropped somewhere: it belongs to the screen under that point.
    if (patch.custom && patch.display === undefined) patch = { ...patch, display: this.#displayAt(patch.custom.x, patch.custom.y) };
    this.settings.widgets[id] = normaliseWidget(id, { ...cur, ...patch, show: { ...cur.show, ...(patch.show || {}) } });
    this.save(this.settings);
    this.#sendSettings(id);
  }

  /** Is there anything for this widget to show? */
  #hasContent(id) {
    if (id === 'voice') return Boolean(this.voice?.connected);
    return Boolean(this.game?.dino);
  }

  /**
   * Place every widget, and show the ones that are on and have something to
   * show. Called every time data comes in (about once a second), so it only
   * touches a window when something about it really changed: moving or
   * re-fading a window makes the desktop redraw it, frames taken from the game.
   * A widget that is off has no window at all (no process, no memory).
   */
  apply() {
    const preview = Date.now() < this.previewUntil;
    for (const id of WIDGETS) {
      const w = this.settings.widgets[id];
      const on = this.settings.enabled && w.enabled && (!this.gameMode || this.keep[id] === true);
      let win = this.wins[id];
      if (!this.editing && !on) {
        if (win && !win.isDestroyed()) win.destroy();
        delete this.wins[id]; delete this.last[id];
        continue;
      }
      if (!win || win.isDestroyed()) { this.#createWidget(id); win = this.wins[id]; }
      const last = this.last[id];
      // Editing shows all four, the ones that are off too (to switch them on right there).
      const wanted = this.editing || (on && (preview || (!this.hiddenByKey && this.#hasContent(id))));
      if (!this.editing || !win.isVisible()) {
        const b = this.#bounds(id);
        const key = `${b.x},${b.y},${b.width},${b.height}`;
        if (last.bounds !== key) { win.setBounds(b); last.bounds = key; }
      }
      if (last.opacity !== w.opacity) { win.setOpacity(w.opacity / 100); last.opacity = w.opacity; }
      if (wanted && !win.isVisible()) win.showInactive();
      if (!wanted && win.isVisible()) win.hide();
    }
  }

  /** From the page: { enabled } for all, or { widget, ...patch } for one. */
  setSettings(raw) {
    if (!raw || typeof raw !== 'object') return this.settings;
    if (typeof raw.enabled === 'boolean' && !raw.widget) this.settings.enabled = raw.enabled;
    if (WIDGETS.includes(raw.widget)) {
      const { widget, reset, ...patch } = raw;
      if (reset === true) this.settings.widgets[widget] = normaliseWidget(widget, { enabled: this.settings.widgets[widget].enabled });
      else this.#patch(widget, patch);
      this.#sendSettings(widget);
    }
    this.save(this.settings);
    this.apply();
    return this.settings;
  }

  /** Voice tab state (voice.js). */
  setVoice(state) {
    this.voice = state;
    this.#send('voice', 'overlay:state', state);
    this.apply();
  }

  /** Player page data: { dino, ai } (app.js), for the map / dino / quests widgets. */
  setGame(game) {
    this.game = game;
    for (const id of ['map', 'dino', 'quests']) this.#send(id, 'overlay:game', game);
    this.apply();
  }

  /** The map image + places, fetched once by the launcher. */
  setMap(data) {
    this.mapData = data;
    this.#send('map', 'overlay:map', data);
  }

  /** From a widget in edit mode: switch it off / on right there (on = the overlay on too). */
  toggleWidget(id) {
    if (!WIDGETS.includes(id)) return;
    const on = !this.settings.widgets[id].enabled;
    if (on) this.settings.enabled = true;
    this.hiddenByKey = false;
    this.#patch(id, { enabled: on });
    for (const w of WIDGETS) this.#sendSettings(w);
    this.apply();
  }

  /** The overlay key: hide / show all widgets for this session. */
  toggle() {
    this.hiddenByKey = !this.hiddenByKey;
    this.apply();
    return !this.hiddenByKey;
  }

  /**
   * Edit mode: the widgets take the mouse (drag, resize, switch off / on).
   * Outside it they are only to look at: clicks go through to the game and
   * they never take the focus.
   */
  edit(on) {
    this.editing = on === true;
    this.apply();   // editing: a window for every widget; done: only the ones that are on
    for (const id of WIDGETS) {
      const win = this.wins[id];
      if (!win || win.isDestroyed()) continue;
      win.setIgnoreMouseEvents(!this.editing);
      win.setFocusable(this.editing);
      this.#sendSettings(id);
    }
    if (!this.editing) {
      for (const win of Object.values(this.wins)) if (!win.isDestroyed()) win.blur();
    }
  }

  /**
   * Put a widget at (x, y) — screen coordinates, any screen — at `scale` %.
   * From the layout editor or from dragging an edge on screen; the window
   * follows at once.
   */
  place(id, { x, y, scale }) {
    if (!WIDGETS.includes(id) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const w = this.settings.widgets[id];
    const sc = Number.isFinite(scale) ? Math.max(50, Math.min(250, Math.round(scale))) : w.scale;
    const [x2, y2] = snap({ x, y, width: BASE[id][0] * sc / 100, height: BASE[id][1] * sc / 100 },
      this.electron.screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).bounds);
    this.#patch(id, { position: 'custom', custom: { x: x2, y: y2 }, scale: sc });
    const win = this.wins[id];
    if (win && !win.isDestroyed()) {
      const b = this.#bounds(id);
      win.setBounds(b);
      if (this.last[id]) this.last[id].bounds = `${b.x},${b.y},${b.width},${b.height}`;
    }
    this.apply();
  }

  /**
   * Dragging a widget on screen: its window follows the real pointer (asked of
   * the OS), keeping the spot where it was grabbed — whatever coordinates the
   * page's events carry while the window moves under them.
   */
  dragStart(id) {
    const win = this.wins[id];
    if (!WIDGETS.includes(id) || !win || win.isDestroyed()) return;
    const c = this.electron.screen.getCursorScreenPoint();
    const [x, y] = win.getPosition();
    this.dragging = { id, dx: c.x - x, dy: c.y - y };
  }

  dragMove(id) {
    const d = this.dragging;
    if (!d || d.id !== id) return;
    const c = this.electron.screen.getCursorScreenPoint();
    this.place(id, { x: c.x - d.dx, y: c.y - d.dy, scale: this.settings.widgets[id].scale });
  }

  dragEnd(id) {
    this.dragMove(id);
    this.dragging = null;
  }

  /** Resizing by an edge / corner on screen: the same, the opposite side stays put, proportions kept. */
  resizeStart(id, dir) {
    const win = this.wins[id];
    if (!WIDGETS.includes(id) || !win || win.isDestroyed() || !/^(n|s|e|w|nw|ne|sw|se)$/.test(dir)) return;
    const c = this.electron.screen.getCursorScreenPoint();
    const b = win.getBounds();
    this.resizing = { id, dir, cx: c.x, cy: c.y, ...b, scale: this.settings.widgets[id].scale };
  }

  resizeMove(id) {
    const r = this.resizing;
    if (!r || r.id !== id) return;
    const c = this.electron.screen.getCursorScreenPoint();
    const scale = resizedScale(r, c.x - r.cx, c.y - r.cy);
    const f = scale / r.scale;
    const w = r.width * f; const h = r.height * f;
    this.place(id, { x: r.dir.includes('w') ? r.x + r.width - w : r.x, y: r.dir.includes('n') ? r.y + r.height - h : r.y, scale });
  }

  resizeEnd(id) {
    this.resizeMove(id);
    this.resizing = null;
  }

  /** For the layout editor: the screens, and where each widget is now. */
  layout() {
    const widgets = {};
    for (const id of WIDGETS) widgets[id] = { enabled: this.settings.widgets[id].enabled, bounds: this.#bounds(id), scale: this.settings.widgets[id].scale };
    return { displays: this.displays(), widgets, base: BASE };
  }

  /** Sample content for a few seconds, to see the settings while tuning them. */
  preview(ms = 6000) {
    this.previewUntil = Date.now() + ms;
    for (const id of WIDGETS) this.#send(id, 'overlay:preview', ms);
    this.apply();
    setTimeout(() => this.apply(), ms + 50);
  }

  displays() {
    const { screen } = this.electron;
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id === primary ? 'primary' : d.id,
      label: `Màn hình ${i + 1}${d.id === primary ? ' (chính)' : ''} — ${d.size.width}×${d.size.height}`,
      bounds: d.bounds,
    }));
  }
}

module.exports = { Overlay, normaliseKeep, GAME_MODE_KEEP, normaliseOverlay, normaliseWidget, widgetBounds, anchorOf, snap, resizedScale, DEFAULTS, WIDGETS, BASE, CHOICES };
