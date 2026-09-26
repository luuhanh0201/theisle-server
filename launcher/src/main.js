'use strict';
/**
 * Xóm Gáy Launcher: the live player portal in one window (home, game,
 * garage, map, ranking, skin, voice — voice is a tab, so it keeps running
 * while you switch tabs, minimise, or play), plus what a web page cannot do:
 *
 *   - push-to-talk, the voice-range key and the overlay key on global keys /
 *     mouse buttons (ptt.js), in game too;
 *   - an in-game overlay (overlay.js): a click-through window over the game;
 *   - Steam login in the default browser (login.js);
 *   - tray icon, "play The Isle" (Steam), auto-update from /tai/.
 *
 * Only the portal's own origin is loaded; anything else opens in the browser.
 * The page gets a tiny API (preload.js), nothing of Node.
 */

const { app, BrowserWindow, Tray, Menu, shell, ipcMain, session, nativeImage, net, Notification, powerMonitor, screen } = require('electron');
const { readFileSync, writeFileSync, mkdirSync, appendFileSync, statSync, renameSync } = require('node:fs');
const { join } = require('node:path');
const { clashOf, distinctBindings, label, PushToTalk, DEFAULT_PTT, DEFAULT_RANGE } = require('./ptt.js');
const { Overlay, normaliseKeep } = require('./overlay.js');
const { LoginFlow } = require('./login.js');

const BASE = (process.env.XOMGAY_URL || 'https://xomgay.online').replace(/\/+$/, '');
const ORIGIN = new URL(BASE).origin;
const STEAM_APP_ID = '376210';   // The Isle
const ICON = join(__dirname, 'icon-256.png');

// The global key hook talks to X11: on a Wayland desktop run through XWayland,
// where The Isle (Proton) runs too. The platform is picked before this file
// runs (app.commandLine.appendSwitch here is too late: the GPU process then
// crashes and no window ever shows), so start again with the flag.
const needsX11 = process.platform === 'linux' && Boolean(process.env.WAYLAND_DISPLAY)
  && !process.argv.some((a) => a.startsWith('--ozone-platform'));
if (needsX11) {
  const args = [...process.argv.slice(1), '--ozone-platform=x11', `--xomgay-relaunched=${process.pid}`];
  if (process.env.APPIMAGE) {
    // Not app.relaunch(): its helper runs from the AppImage's mount, which is
    // gone the moment this process exits, so it dies before starting anything.
    // Start the AppImage itself as a separate program instead.
    require('node:child_process').spawn(process.env.APPIMAGE, args, { detached: true, stdio: 'ignore' }).unref();
  } else {
    app.relaunch({ execPath: process.execPath, args });
  }
  app.exit(0);
} else {
  // One launcher at a time. Just relaunched (above): our parent may still hold
  // the lock for a moment while it exits — wait for it (≤ 3 s). Any other
  // holder is a launcher already running: it was told (second-instance), quit.
  const parent = Number((process.argv.find((a) => a.startsWith('--xomgay-relaunched=')) || '').split('=')[1]);
  const parentAlive = () => {
    if (!Number.isInteger(parent) || parent <= 0) return false;
    try { process.kill(parent, 0); return true; } catch { return false; }
  };
  const takeLock = (triesLeft) => {
    if (app.requestSingleInstanceLock()) {
      // Another start, or the browser's "xomgay-launcher://login-done" after a Steam login.
      app.on('second-instance', () => showMain(true));
      app.whenReady().then(start);
    } else if (triesLeft > 0 && parentAlive()) {
      setTimeout(() => takeLock(triesLeft - 1), 250);
    } else {
      app.quit();
    }
  };
  takeLock(12);
}

// --- log (userData/launcher.log) ------------------------------------------------------------
// After the Wayland relaunch nobody watches stdout: keep errors in a file a
// player can send when something goes wrong. One old file kept, 1 MB each.
function startLog() {
  const file = join(app.getPath('userData'), 'launcher.log');
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    if (statSync(file, { throwIfNoEntry: false })?.size > 1_000_000) renameSync(file, `${file}.1`);
  } catch { /* no log then */ }
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      orig(...args);
      try {
        const text = args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        appendFileSync(file, `${new Date().toISOString()} ${level.toUpperCase()} ${text}\n`);
      } catch { /* disk full / read-only: never break the app for a log line */ }
    };
  }
  console.info(`[launcher] v${app.getVersion()} ${process.platform} ${process.arch} — ${BASE}`);
}

// --- Linux AppImage: a menu entry + the xomgay-launcher:// link ---------------------------------------
// An AppImage installs nothing. So that the browser can hand the player back
// after the Steam login (and the launcher shows in the app menu), write a
// .desktop entry for this AppImage in the user's own applications folder and
// make it the handler of xomgay-launcher://. Redone when the AppImage moved.
function integrateAppImage() {
  const { homedir } = require('node:os');
  const { execFile } = require('node:child_process');
  const appimage = process.env.APPIMAGE;
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  const desktopFile = join(dataHome, 'applications', 'xomgay-launcher.desktop');
  const iconFile = join(dataHome, 'icons', 'hicolor', '256x256', 'apps', 'xomgay-launcher.png');
  const quoted = `"${appimage.replace(/(["\\$`])/g, '\\$1')}"`;
  const entry = [
    '[Desktop Entry]', 'Type=Application', 'Name=Xóm Gáy Launcher', 'Comment=Gara, bản đồ live, voice gần, overlay — The Isle Evrima',
    `Exec=${quoted} %U`, 'Icon=xomgay-launcher', 'Terminal=false', 'Categories=Game;',
    'MimeType=x-scheme-handler/xomgay-launcher;', 'StartupWMClass=xomgay-launcher', '',
  ].join('\n');
  try {
    let current = '';
    try { current = readFileSync(desktopFile, 'utf8'); } catch { /* not there yet */ }
    if (current === entry) return;
    mkdirSync(join(dataHome, 'applications'), { recursive: true });
    mkdirSync(join(dataHome, 'icons', 'hicolor', '256x256', 'apps'), { recursive: true });
    writeFileSync(iconFile, readFileSync(ICON));
    writeFileSync(desktopFile, entry);
    execFile('xdg-mime', ['default', 'xomgay-launcher.desktop', 'x-scheme-handler/xomgay-launcher'], () => {});
    execFile('update-desktop-database', [join(dataHome, 'applications')], () => {});
    console.info(`[launcher] menu entry + xomgay-launcher:// → ${appimage}`);
  } catch (err) {
    console.warn('[launcher] could not add the menu entry:', err.message);
  }
}

// --- settings (userData/settings.json) ----------------------------------------------------

const settingsFile = () => join(app.getPath('userData'), 'settings.json');
function readSettings() {
  try { return JSON.parse(readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}
function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  } catch (err) {
    console.error('[launcher] settings not saved:', err.message);
  }
}

// --- windows ----------------------------------------------------------------------------------

let mainWin = null;
let gateWin = null;
/** Whether the portal says we are logged in (null until the first check). */
let loggedIn = null;
let splashWin = null;
let tray = null;
let quitting = false;
/** Global keys: hold to talk, cycle the voice range, overlay on / off, overlay edit mode. */
const keys = { ptt: null, range: null, overlay: null, edit: null };
const KEY_SETTING = { ptt: 'ptt', range: 'rangeKey', overlay: 'overlayKey', edit: 'overlayEditKey' };
const KEY_TITLE = { ptt: 'Bấm để nói', range: 'Đổi tầm nói', overlay: 'Bật / tắt overlay', edit: 'Chỉnh vị trí overlay' };
const DEFAULT_OVERLAY_KEY = { kind: 'key', code: 66 };   // UiohookKey.F8
const DEFAULT_EDIT_KEY = { kind: 'key', code: 67 };      // UiohookKey.F9
let overlay = null;
let hookRunning = false;

const isOurs = (url) => { try { return new URL(url).origin === ORIGIN; } catch { return false; } };
const pathOf = (url) => { try { return new URL(url).pathname; } catch { return ''; } };

function webPrefs(extra = {}) {
  return {
    preload: join(__dirname, 'preload.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    spellcheck: false,
    additionalArguments: [`--xomgay-origin=${ORIGIN}`, `--xomgay-version=${app.getVersion()}`],
    ...extra,
  };
}

/** Links out of the portal (Discord, Steam profiles…) go to the default browser. */
function openOutside(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'steam:') shell.openExternal(u.toString());
  } catch { /* not a URL */ }
}

/** Our pages stay in the window (Steam login goes to the browser); anything else opens outside. */
function guard(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOurs(url)) { showMain(); win.loadURL(url); } else openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isOurs(url)) { e.preventDefault(); openOutside(url); return; }
    const p = pathOf(url);
    if (p === '/auth/steam') { e.preventDefault(); startLogin(); return; }
    // Leaving the page would cut voice: the old voice page is a tab now.
    if (p === '/voice.html') { e.preventDefault(); win.webContents.executeJavaScript("location.hash = 'voice'").catch(() => {}); }
  });
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 500,
    title: `Xóm Gáy Launcher v${app.getVersion()}`, icon: ICON, backgroundColor: '#07090e', show: false, autoHideMenuBar: true,
    // Voice runs in this window, also while it is hidden in the tray: no timer throttling.
    webPreferences: webPrefs({ backgroundThrottling: false }),
  });
  mainWin.removeMenu();
  guard(mainWin);
  // Keep our title (with the version) instead of the page's.
  mainWin.on('page-title-updated', (e) => e.preventDefault());
  // After every load of the portal: logged in → the launcher, not → the login gate.
  mainWin.webContents.on('did-finish-load', () => { afterLoad(); });
  mainWin.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) splashError(`Không kết nối được ${new URL(BASE).host} (${desc}).`);
  });
  mainWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    mainWin.hide();
    notifyOnce('tray', 'Xóm Gáy Launcher vẫn đang chạy', 'Voice vẫn hoạt động. Mở lại hoặc thoát từ biểu tượng ở khay hệ thống.');
  });
  mainWin.loadURL(`${BASE}/`);
}


// --- splash: the logo animation while the portal loads -----------------------------------------------

const SPLASH_MIN_MS = 2_400;   // let the animation play even when the page is instant
let splashShownAt = 0;

function createSplash() {
  splashShownAt = Date.now();
  splashWin = new BrowserWindow({
    width: 420, height: 480, frame: false, transparent: true, resizable: false, maximizable: false,
    fullscreenable: false, center: true, show: false, title: 'Xóm Gáy Launcher', icon: ICON,
    webPreferences: {
      preload: join(__dirname, 'splash-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      additionalArguments: [`--xomgay-version=${app.getVersion()}`],
    },
  });
  splashWin.webContents.on('will-navigate', (e) => e.preventDefault());
  splashWin.once('ready-to-show', () => splashWin?.show());
  splashWin.on('closed', () => { splashWin = null; });
  splashWin.loadFile(join(__dirname, 'splash.html'));
}

/** Let the logo animation finish (at least SPLASH_MIN_MS), then `next`. */
function finishSplash(next) {
  if (!splashWin) { next(); return; }
  const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashShownAt));
  setTimeout(() => {
    if (!splashWin) { next(); return; }
    splashWin.webContents.send('splash:ready');
    setTimeout(() => { next(); splashWin?.destroy(); }, 600);
  }, wait);
}

/** /api/me from the portal page (its cookies): 200 logged in, 401 not, anything else = could not tell. */
function sessionStatus() {
  return mainWin.webContents
    .executeJavaScript("fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.status, () => 0)", true)
    .catch((err) => { console.warn('[launcher] session check failed:', err.message); return 0; });
}

/**
 * The portal (re)loaded: are we logged in? Logout reloads it too, and lands
 * on the gate. Only a clear 401 means "not logged in": a network blip or a
 * restarting server is asked again (3 tries) before falling back to the gate,
 * which keeps checking (pushServer) and lets the player in when it can.
 */
async function afterLoad() {
  let status = 0;
  for (let i = 0; i < 3; i++) {
    status = await sessionStatus();
    if (status === 200 || status === 401) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.info(`[launcher] session check: ${status}`);
  loggedIn = status === 200;
  finishSplash(() => { if (loggedIn) openLauncher(); else showGate(); });
}

function splashError(text) {
  if (splashWin) splashWin.webContents.send('splash:error', text);
  else if (!loggedIn) showGate();   // the gate shows the server as unreachable
}

/** Bring a window in front of the browser the player just logged in with. */
function toFront(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  // Windows keeps apps from taking the focus from the foreground one; a
  // moment on top gets the launcher in front of the browser anyway.
  win.setAlwaysOnTop(true);
  win.focus();
  app.focus({ steal: true });
  setTimeout(() => { if (!win.isDestroyed()) win.setAlwaysOnTop(false); }, 400);
}

let justLoggedIn = false;

/** Logged in: the launcher itself. */
function openLauncher() {
  if (gateWin) { gateWin.destroy(); gateWin = null; }
  if (justLoggedIn) { justLoggedIn = false; toFront(mainWin); return; }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function showMain(front = false) {
  if (!mainWin) return;
  if (splashWin) { splashWin.focus(); return; }
  if (!loggedIn) { if (front) toFront(gateWin); showGate(); return; }
  if (front) { toFront(mainWin); return; }
  openLauncher();
}

/** A desktop notification, at most once per `key` per run. */
const shown = new Set();
function notifyOnce(key, title, body) {
  if (shown.has(key) || !Notification.isSupported()) return;
  shown.add(key);
  new Notification({ title, body, icon: ICON }).show();
}

// --- the login gate: server status + Steam login, before the launcher opens -----------------------------

let serverTimer = null;
async function pushServer() {
  if (!gateWin || gateWin.isDestroyed()) return;
  let info;
  try {
    const r = await net.fetch(`${BASE}/api/server`, { cache: 'no-store' });
    info = r.ok ? await r.json() : { error: `HTTP ${r.status}` };
  } catch (err) {
    info = { error: err.message };
  }
  if (gateWin && !gateWin.isDestroyed()) gateWin.webContents.send('gate:server', info);
  // On the gate because the session could not be checked (not a clear 401)?
  // Once the server answers again and the session is fine, go in.
  if (!info.error && !login.current && gateWin && !loggedIn && (await sessionStatus()) === 200) {
    loggedIn = true;
    openLauncher();
  }
}

function showGate() {
  if (mainWin?.isVisible()) mainWin.hide();
  if (gateWin && !gateWin.isDestroyed()) {
    if (gateWin.isMinimized()) gateWin.restore();
    gateWin.show();
    gateWin.focus();
    return;
  }
  gateWin = new BrowserWindow({
    width: 980, height: 640, minWidth: 720, minHeight: 560, center: true,
    title: `Xóm Gáy Launcher v${app.getVersion()}`, icon: ICON, backgroundColor: '#07090e', show: false, autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'gate-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      additionalArguments: [`--xomgay-version=${app.getVersion()}`],
    },
  });
  gateWin.removeMenu();
  gateWin.on('page-title-updated', (e) => e.preventDefault());
  gateWin.webContents.on('will-navigate', (e) => e.preventDefault());
  gateWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  gateWin.once('ready-to-show', () => { gateWin?.show(); gateWin?.focus(); });
  gateWin.webContents.on('did-finish-load', () => { pushServer(); gateWin?.webContents.send('gate:login', login.current ? 'waiting' : 'idle'); });
  // Nothing works without logging in: closing the gate quits.
  gateWin.on('close', () => { if (!loggedIn) { quitting = true; app.quit(); } });
  gateWin.on('closed', () => { gateWin = null; clearInterval(serverTimer); serverTimer = null; login.cancel(); });
  clearInterval(serverTimer);
  serverTimer = setInterval(pushServer, 10_000);
  gateWin.loadFile(join(__dirname, 'gate.html'));
}

// --- Steam login in the browser ---------------------------------------------------------------------

const login = new LoginFlow({
  base: BASE,
  fetch: (url, init) => net.fetch(url, init),
  openUrl: (url) => shell.openExternal(url),
  setCookie: (c) => session.defaultSession.cookies.set({
    url: BASE, name: c.name, value: c.value, path: '/', httpOnly: true, secure: BASE.startsWith('https:'),
    sameSite: 'lax', expirationDate: Math.floor(Date.now() / 1000) + (Number(c.maxAge) || 7 * 86400),
  }),
});

/** From the gate's Steam button (or a Steam link in the portal): log in in the browser. */
async function startLogin() {
  showGate();
  const tell = (state) => { if (gateWin && !gateWin.isDestroyed()) gateWin.webContents.send('gate:login', state); };
  tell('waiting');
  const result = await login.run();
  if (result === 'cancelled') { tell('idle'); return; }
  if (result === 'done') {
    // The reload checks the session and opens the launcher (afterLoad), in front of the browser.
    justLoggedIn = true;
    mainWin.reload();
    return;
  }
  tell(result);
}

// --- push-to-talk -------------------------------------------------------------------------------------

function startPtt() {
  let hook;
  try {
    ({ uIOhook: hook } = require('uiohook-napi'));
  } catch (err) {
    console.error('[launcher] global key hook unavailable:', err.message);
    return;
  }
  const toPage = (channel, value) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, value); };
  const saved = readSettings();
  const b = distinctBindings([
    { name: 'ptt', binding: saved.ptt, fallback: DEFAULT_PTT },
    { name: 'range', binding: saved.rangeKey, fallback: DEFAULT_RANGE },
    { name: 'overlay', binding: saved.overlayKey, fallback: DEFAULT_OVERLAY_KEY },
    { name: 'edit', binding: saved.overlayEditKey, fallback: DEFAULT_EDIT_KEY },
  ]);
  keys.ptt = new PushToTalk(hook, b.ptt, (held) => { toPage('ptt', held); updateTray(); });
  keys.range = new PushToTalk(hook, b.range, (down) => { if (down) toPage('range-key', true); }, DEFAULT_RANGE);
  keys.overlay = new PushToTalk(hook, b.overlay, (down) => {
    if (!down || !overlay) return;
    overlay.toggle();
    updateTray();
  }, DEFAULT_OVERLAY_KEY);
  keys.edit = new PushToTalk(hook, b.edit, (down) => {
    if (!down || !overlay) return;
    overlay.edit(!overlay.editing);
    toPage('overlay:changed', overlay.settings);
  }, DEFAULT_EDIT_KEY);
  try {
    hook.start();
    hookRunning = true;
  } catch (err) {
    console.error('[launcher] global key hook failed to start:', err.message);
  }
}

// --- IPC from our pages ---------------------------------------------------------------------------------

/** Only our own pages may use the launcher API. */
const fromUs = (e) => isOurs(e.senderFrame?.url ?? '');
const keyLabel = (k) => (k ? label(k.binding, require('uiohook-napi').UiohookKey) : 'không dùng được');

function wireIpc() {
  ipcMain.on('play', (e) => {
    if (!fromUs(e)) return;
    setGameMode(true);
    shell.openExternal(`steam://rungameid/${STEAM_APP_ID}`);
  });
  ipcMain.on('gamemode:get', (e) => { e.returnValue = fromUs(e) ? gameModeState() : null; });
  ipcMain.on('gamemode:set', (e, on) => { if (fromUs(e)) setGameMode(on === true); });
  ipcMain.on('gamemode:keep', (e, keep) => { if (fromUs(e)) setGameModeKeep(keep); });
  // Global keys: their names, and "the next key pressed becomes it".
  ipcMain.on('key:label', (e, name) => { e.returnValue = fromUs(e) && name in keys ? keyLabel(keys[name]) : ''; });
  ipcMain.handle('key:capture', async (e, name) => {
    const k = keys[name];
    if (!fromUs(e) || !(name in keys) || !k || !hookRunning) return null;
    // One capture at a time: two waiting at once both took the same key.
    for (const [other, o] of Object.entries(keys)) if (other !== name && o) o.cancelCapture();
    const before = k.binding;
    const b = await k.captureNext();
    if (!b) return null;
    const others = Object.fromEntries(Object.entries(keys).filter(([, o]) => o).map(([n, o]) => [n, o.binding]));
    const clash = clashOf(others, name, b);
    if (clash !== null) {
      k.set(before);
      return { error: `Phím ${label(b, require('uiohook-napi').UiohookKey)} đang dùng cho "${KEY_TITLE[clash]}" — chọn phím khác.` };
    }
    writeSettings({ [KEY_SETTING[name]]: b });
    updateTray();
    return keyLabel(k);
  });
  // The overlay: voice state in, settings in and out, drag mode, preview.
  ipcMain.on('overlay:state', (e, state) => { if (fromUs(e) && overlay && state && typeof state === 'object') overlay.setVoice(state); });
  ipcMain.on('overlay:game', (e, game) => { if (fromUs(e) && overlay && game && typeof game === 'object') overlay.setGame(game); });
  ipcMain.on('overlay:get', (e) => {
    e.returnValue = fromUs(e) && overlay ? { settings: overlay.settings, displays: overlay.displays(), editing: overlay.editing } : null;
  });
  ipcMain.handle('overlay:set', (e, raw) => (fromUs(e) && overlay ? overlay.setSettings(raw) : null));
  ipcMain.on('overlay:edit', (e, on) => {
    if (!fromUs(e) || !overlay) return;
    overlay.edit(on === true);
    if (on !== true) mainWin?.webContents.send('overlay:changed', overlay.settings);
  });
  ipcMain.on('overlay:preview', (e) => { if (fromUs(e) && overlay) overlay.preview(); });
  const fromOverlay = (e) => overlay !== null && Object.values(overlay.wins).some((w) => !w.isDestroyed() && w.webContents === e.sender);
  // Placing a widget: from the layout editor, or from dragging its edge on screen.
  let changedTimer = null;
  const place = (widget, spot) => {
    if (!spot || typeof spot !== 'object') return;
    overlay.place(String(widget), { x: Number(spot.x), y: Number(spot.y), scale: Number(spot.scale) });
  };
  ipcMain.on('overlay:place', (e, widget, spot) => {
    if (fromUs(e)) { place(widget, spot); return; }
    if (!fromOverlay(e)) return;
    place(widget, spot);
    // The page's layout editor follows what is done on screen.
    clearTimeout(changedTimer);
    changedTimer = setTimeout(() => mainWin?.webContents.send('overlay:changed', overlay.settings), 150);
  });
  ipcMain.on('overlay:layout', (e) => { e.returnValue = fromUs(e) && overlay ? overlay.layout() : null; });
  // Dragging a widget on screen (edit mode): the window follows the real pointer.
  ipcMain.on('overlay:drag', (e, widget, phase) => {
    if (!fromOverlay(e)) return;
    const id = String(widget);
    if (phase === 'start') overlay.dragStart(id);
    else if (phase === 'move') overlay.dragMove(id);
    else if (phase === 'end') {
      overlay.dragEnd(id);
      mainWin?.webContents.send('overlay:changed', overlay.settings);
    }
  });
  ipcMain.on('overlay:resize', (e, widget, phase, dir) => {
    if (!fromOverlay(e)) return;
    const id = String(widget);
    if (phase === 'start') overlay.resizeStart(id, String(dir));
    else if (phase === 'move') overlay.resizeMove(id);
    else if (phase === 'end') {
      overlay.resizeEnd(id);
      mainWin?.webContents.send('overlay:changed', overlay.settings);
    }
  });
  ipcMain.on('overlay:toggle-widget', (e, widget) => {
    if (!fromOverlay(e)) return;
    overlay.toggleWidget(String(widget));
    mainWin?.webContents.send('overlay:changed', overlay.settings);
    updateTray();
  });
  ipcMain.on('overlay:edit-done', (e) => {
    if (!fromOverlay(e)) return;
    overlay.edit(false);
    mainWin?.webContents.send('overlay:changed', overlay.settings);
  });
  // splash.html: retry the portal, or give up.
  const fromSplash = (e) => splashWin !== null && e.sender === splashWin.webContents;
  ipcMain.on('splash:retry', (e) => { if (fromSplash(e)) mainWin.loadURL(`${BASE}/`); });
  ipcMain.on('splash:quit', (e) => { if (fromSplash(e)) { quitting = true; app.quit(); } });
  // gate.html: log in, Discord, quit.
  const fromGate = (e) => gateWin !== null && !gateWin.isDestroyed() && e.sender === gateWin.webContents;
  ipcMain.on('gate:login', (e) => { if (fromGate(e)) startLogin(); });
  ipcMain.on('gate:reopen', (e) => { if (fromGate(e)) login.reopen(); });
  ipcMain.on('gate:cancel', (e) => { if (fromGate(e)) login.cancel(); });
  ipcMain.on('gate:open', (e, url) => { if (fromGate(e) && /^https:\/\/discord(\.gg|\.com\/invite)\//.test(String(url))) shell.openExternal(String(url)); });
  ipcMain.on('gate:quit', (e) => { if (fromGate(e)) { quitting = true; app.quit(); } });
}

/** The map image + places for the mini map, from the portal (public files), once. */
async function loadOverlayMap() {
  try {
    const r = await net.fetch(`${BASE}/map/gateway.json`);
    if (!r.ok) throw new Error(`gateway.json: HTTP ${r.status}`);
    const json = await r.json();
    json.features = (json.features || []).filter((f) => f.layer !== 'animal');
    const img = await net.fetch(`${BASE}/map/${encodeURIComponent(json.image)}?v=${encodeURIComponent(json.updated)}`);
    if (!img.ok) throw new Error(`map image: HTTP ${img.status}`);
    overlay.setMap({ json, image: await img.arrayBuffer(), type: img.headers.get('content-type') || 'image/webp' });
  } catch (err) {
    console.error('[launcher] mini map not loaded:', err.message);
    setTimeout(loadOverlayMap, 60_000);
  }
}

// --- game mode: the launcher out of the way while playing ------------------------------------------------
// On: the launcher window goes to the tray, the overlay keeps only the widgets
// the player chose, and the player page stops drawing. Voice keeps running.
// "Chơi The Isle" turns it on.
function gameModeState() {
  return { on: Boolean(overlay?.gameMode), keep: overlay ? { ...overlay.keep } : normaliseKeep(null) };
}

function setGameMode(on) {
  if (!overlay) return;
  overlay.gameMode = on === true;
  overlay.apply();
  writeSettings({ gameMode: overlay.gameMode });
  if (overlay.gameMode && mainWin && mainWin.isVisible()) mainWin.hide();
  if (overlay.gameMode) notifyOnce('gamemode', 'Chế độ chơi game: bật', 'Launcher ở khay hệ thống, chỉ giữ các khung overlay bạn chọn. Tắt lại từ khay hoặc nút trên launcher.');
  mainWin?.webContents.send('gamemode:changed', gameModeState());
  updateTray();
}

function setGameModeKeep(raw) {
  if (!overlay) return;
  overlay.keep = normaliseKeep({ ...overlay.keep, ...(raw && typeof raw === 'object' ? raw : {}) });
  overlay.apply();
  writeSettings({ gameModeKeep: overlay.keep });
  mainWin?.webContents.send('gamemode:changed', gameModeState());
}

// --- tray -------------------------------------------------------------------------------------------------

function updateTray() {
  if (!tray) return;
  const talking = keys.ptt?.held ? ' — đang nói' : '';
  tray.setToolTip(`Xóm Gáy Launcher v${app.getVersion()}${talking}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mở Xóm Gáy Launcher', click: showMain },
    { label: 'Voice gần', click: () => { showMain(); if (loggedIn) mainWin.webContents.executeJavaScript("location.hash = 'voice'").catch(() => {}); } },
    { label: 'Cài đặt overlay', click: () => { showMain(); if (loggedIn) mainWin.webContents.executeJavaScript("location.hash = 'overlay'").catch(() => {}); } },
    { label: 'Chơi The Isle', click: () => { setGameMode(true); shell.openExternal(`steam://rungameid/${STEAM_APP_ID}`); } },
    { label: 'Chế độ chơi game', type: 'checkbox', checked: Boolean(overlay?.gameMode), click: (item) => setGameMode(item.checked) },
    { type: 'separator' },
    {
      label: 'Hiện overlay trong game', type: 'checkbox', checked: Boolean(overlay?.settings.enabled && !overlay?.hiddenByKey),
      click: (item) => {
        if (!overlay) return;
        overlay.hiddenByKey = false;
        mainWin?.webContents.send('overlay:changed', overlay.setSettings({ enabled: item.checked }));
        updateTray();
      },
    },
    { type: 'separator' },
    { label: `Phím nói: ${keyLabel(keys.ptt)}`, enabled: false },
    { label: `Phím đổi tầm giọng: ${keyLabel(keys.range)}`, enabled: false },
    { label: `Phím bật/tắt overlay: ${keyLabel(keys.overlay)}`, enabled: false },
    { label: `Phím chỉnh overlay trên màn hình: ${keyLabel(keys.edit)}`, enabled: false },
    { label: `Phiên bản ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Thoát', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  const img = nativeImage.createFromPath(join(__dirname, process.platform === 'win32' ? 'tray-32.png' : 'tray-22.png'));
  tray = new Tray(img);
  tray.on('click', showMain);
  updateTray();
}

// --- updates ----------------------------------------------------------------------------------------------

function checkUpdates() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.on('error', (err) => console.error('[launcher] update check failed:', err.message));
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 6 * 3600_000);
}

// --- start ------------------------------------------------------------------------------------------------

function start() {
  startLog();
  // Electron puts the app name in the User-Agent — "XómGáyLauncher/1.0.0".
  // Letters outside ASCII are not valid in an HTTP header, and the anti-DDoS
  // proxy in front of the portal answers such a request with 400. ASCII only.
  app.userAgentFallback = app.userAgentFallback.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '');
  console.info(`[launcher] user agent: ${app.userAgentFallback}`);
  // Why it stopped, in the log a player can send.
  process.on('uncaughtException', (err) => console.error('[launcher] uncaught:', err));
  app.on('before-quit', () => console.info(`[launcher] quitting${quitting ? '' : ' (not from the tray / gate)'}`, new Error('quit from').stack.split('\n').slice(1, 6).join(' | ')));
  process.on('exit', (code) => console.info(`[launcher] exit ${code}`));
  // The login page in the browser hands back to us with xomgay-launcher://login-done.
  if (process.defaultApp) app.setAsDefaultProtocolClient('xomgay-launcher', process.execPath, [require('node:path').resolve(process.argv[1] || '.')]);
  else if (process.env.APPIMAGE) integrateAppImage();
  else app.setAsDefaultProtocolClient('xomgay-launcher');
  // The microphone for our voice page only; nothing else asks for anything.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const ours = isOurs(details.requestingUrl || wc.getURL());
    if (permission === 'media') {
      const types = details.mediaTypes || [];
      callback(ours && types.length > 0 && types.every((t) => t === 'audio'));
      return;
    }
    callback(ours && (permission === 'notifications' || permission === 'clipboard-sanitized-write'));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) =>
    origin === ORIGIN && (permission === 'media' || permission === 'notifications'));
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-attach-webview', (e) => e.preventDefault());
  });

  wireIpc();
  createSplash();
  createMain();
  overlay = new Overlay({
    electron: { BrowserWindow, screen },
    preload: join(__dirname, 'overlay-preload.js'),
    file: join(__dirname, 'overlay.html'),
    load: () => readSettings().overlay,
    save: (o) => writeSettings({ overlay: o }),
  });
  // Dragged on screen: the launcher's layout editor follows.
  let movedTimer = null;
  overlay.onMoved = () => {
    clearTimeout(movedTimer);
    movedTimer = setTimeout(() => mainWin?.webContents.send('overlay:changed', overlay.settings), 150);
  };
  const saved0 = readSettings();
  overlay.gameMode = saved0.gameMode === true;
  overlay.keep = normaliseKeep(saved0.gameModeKeep);
  overlay.create();
  loadOverlayMap();
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, () => overlay.apply());
  createTray();
  startPtt();
  updateTray();
  checkUpdates();

  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => {
    if (hookRunning) { try { require('uiohook-napi').uIOhook.stop(); } catch { /* exiting */ } }
  });
  // Locked screen / sleep mid-press: never stay stuck "talking".
  powerMonitor.on('lock-screen', () => { for (const k of Object.values(keys)) k?.release(); });
  powerMonitor.on('suspend', () => { for (const k of Object.values(keys)) k?.release(); });
  app.on('window-all-closed', () => { /* stay in the tray */ });
}
