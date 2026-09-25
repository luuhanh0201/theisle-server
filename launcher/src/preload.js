'use strict';
/**
 * The launcher API for OUR pages only (portal/public/app.js, voice.js,
 * overlay-settings.js): window.isleLauncher. No Node, no files, no arbitrary IPC.
 */
const { contextBridge, ipcRenderer } = require('electron');

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const ORIGIN = arg('xomgay-origin');
const KEYS = ['ptt', 'range', 'overlay', 'edit'];

if (ORIGIN !== '' && location.origin === ORIGIN) {
  const keyLabel = (name) => (KEYS.includes(name) ? ipcRenderer.sendSync('key:label', name) : '');
  const captureKey = (name) => (KEYS.includes(name) ? ipcRenderer.invoke('key:capture', name) : Promise.resolve(null));
  contextBridge.exposeInMainWorld('isleLauncher', {
    version: arg('xomgay-version'),
    platform: process.platform,
    /** Start The Isle through Steam. */
    playGame: () => ipcRenderer.send('play'),

    /** Global keys ('ptt' talk, 'range' cycle the range, 'overlay' on / off, 'edit' overlay edit mode): name, and rebind. */
    keyLabel,
    captureKey,
    pttLabel: () => keyLabel('ptt'),
    capturePttKey: () => captureKey('ptt'),
    rangeLabel: () => keyLabel('range'),
    captureRangeKey: () => captureKey('range'),
    /** Called with true / false as the push-to-talk key is held / released, in game too. */
    onPushToTalk: (cb) => { if (typeof cb === 'function') ipcRenderer.on('ptt', (_e, held) => cb(held === true)); },
    /** Called each time the range key is pressed, in game too. */
    onRangeKey: (cb) => { if (typeof cb === 'function') ipcRenderer.on('range-key', () => cb()); },

    /** Game mode: { on, keep: { voice, map, dino, quests } } — the launcher out of the way while playing. */
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
    overlayState: (state) => ipcRenderer.send('overlay:state', state),
    /** Your dino, its position and quests, and the AI near (app.js), for the map / dino / quest widgets. */
    overlayGame: (game) => ipcRenderer.send('overlay:game', game),
    onOverlayChanged: (cb) => { if (typeof cb === 'function') ipcRenderer.on('overlay:changed', (_e, s) => cb(s)); },
  });
}
