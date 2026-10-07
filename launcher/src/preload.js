'use strict';
/**
 * The launcher API for OUR pages only (the player site, web/apps/portal): window.isleLauncher. No Node, no files,
 * no arbitrary IPC.
 */
const { contextBridge, ipcRenderer } = require('electron');

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const ORIGIN = arg('xomgay-origin');
const KEYS = ['ptt', 'range', 'mute', 'overlay', 'edit', 'bigmap'];

if (ORIGIN !== '' && location.origin === ORIGIN) {
  const keyLabel = (name) => (KEYS.includes(name) ? ipcRenderer.sendSync('key:label', name) : '');
  const captureKey = (name) => (KEYS.includes(name) ? ipcRenderer.invoke('key:capture', name) : Promise.resolve(null));
  contextBridge.exposeInMainWorld('isleLauncher', {
    version: arg('xomgay-version'),
    platform: process.platform,
    /** Updates: { phase, current, version, percent, error } (phase: dev | idle | checking | latest | downloading | ready | error). */
    updateGet: () => ipcRenderer.sendSync('update:get'),
    updateCheck: () => ipcRenderer.send('update:check'),
    updateInstall: () => ipcRenderer.send('update:install'),
    onUpdate: (cb) => { if (typeof cb === 'function') ipcRenderer.on('update:state', (_e, st) => cb(st)); },
    /** Start The Isle through Steam. */
    playGame: () => ipcRenderer.send('play'),

    /** Global keys ('ptt' talk, 'range' cycle the range, 'overlay' on / off, 'edit' overlay edit mode): name, and rebind. */
    keyLabel,
    captureKey,
    pttLabel: () => keyLabel('ptt'),
    capturePttKey: () => captureKey('ptt'),
    rangeLabel: () => keyLabel('range'),
    captureRangeKey: () => captureKey('range'),
    muteLabel: () => keyLabel('mute'),
    captureMuteKey: () => captureKey('mute'),
    /** Called with true / false as the push-to-talk key is held / released, in game too. */
    onPushToTalk: (cb) => { if (typeof cb === 'function') ipcRenderer.on('ptt', (_e, held) => cb(held === true)); },
    /** Called each time the range key is pressed, in game too. */
    onRangeKey: (cb) => { if (typeof cb === 'function') ipcRenderer.on('range-key', () => cb()); },
    /** Called each time the micro key is pressed (off / on), in game too. */
    onMuteKey: (cb) => { if (typeof cb === 'function') ipcRenderer.on('mute-key', () => cb()); },

    /** Game mode: { on, keep: { voice, map, dino, quests } }, the launcher out of the way while playing. */
    gameModeGet: () => ipcRenderer.sendSync('gamemode:get'),
    gameModeSet: (on) => ipcRenderer.send('gamemode:set', on === true),
    gameModeKeep: (keep) => ipcRenderer.send('gamemode:keep', keep),
    onGameMode: (cb) => { if (typeof cb === 'function') ipcRenderer.on('gamemode:changed', (_e, s) => cb(s)); },

    /** The in-game overlay. */
    overlayGet: () => ipcRenderer.sendSync('overlay:get'),
    overlaySet: (settings) => ipcRenderer.invoke('overlay:set', settings),
    overlayEdit: (on) => ipcRenderer.send('overlay:edit', on === true),
    /** The screens and where each widget is (screen coordinates), for the layout editor. */
    overlayLayout: () => ipcRenderer.sendSync('overlay:layout'),
    /** Put a widget at { x, y } (screen coordinates, any screen) at { scale } %. */
    overlayPlace: (widget, spot) => ipcRenderer.send('overlay:place', String(widget), spot),
    overlayPreview: () => ipcRenderer.send('overlay:preview'),
    /** "Sửa viền đen": { on, saved }, set it and the launcher restarts without GPU acceleration. */
    overlayCompatGet: () => ipcRenderer.sendSync('overlay:compat:get'),
    overlayCompatSet: (on) => ipcRenderer.send('overlay:compat:set', on === true),
    overlayState: (state) => ipcRenderer.send('overlay:state', state),
    /** Your dino, its position and quests, and the AI near (app.js), for the map / dino / quest widgets. */
    overlayGame: (game) => ipcRenderer.send('overlay:game', game),
    onOverlayChanged: (cb) => { if (typeof cb === 'function') ipcRenderer.on('overlay:changed', (_e, s) => cb(s)); },
    /** The mini map the portal draws (map.js) for the overlay's map widget: { image: bytes, type }. */
    overlayMiniFrame: (frame) => ipcRenderer.send('overlay:mini-frame', frame),

    /** The big map (bigmap.html, its key, M): the game data as it comes, the latest at once, closing it. */
    onOverlayGame: (cb) => { if (typeof cb === 'function') ipcRenderer.on('overlay:game', (_e, g) => cb(g)); },
    overlayGameGet: () => ipcRenderer.sendSync('overlay:game:get'),
    bigMapGet: () => ipcRenderer.sendSync('bigmap:get'),
    bigMapClose: () => ipcRenderer.send('bigmap:close'),
    /** Which screen the big map opens on: { value: 'auto' | id, choices: [{ id, label }] }; set one. */
    bigMapDisplayGet: () => ipcRenderer.sendSync('bigmap:display:get'),
    bigMapDisplaySet: (value) => ipcRenderer.send('bigmap:display:set', String(value)),
    /** A text box of the big map has the focus: its key types a letter there, it does not close the map. */
    bigMapTyping: (on) => ipcRenderer.send('bigmap:typing', on === true),
    /** Told when the big map opens / closes (the player page fetches the AI for it meanwhile). */
    onBigMap: (cb) => { if (typeof cb === 'function') ipcRenderer.on('bigmap:state', (_e, open) => cb(open === true)); },
  });
}
