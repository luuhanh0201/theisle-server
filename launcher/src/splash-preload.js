'use strict';
// splash.html: status in, retry / quit out. Nothing else.
const { contextBridge, ipcRenderer } = require('electron');
const version = (process.argv.find((a) => a.startsWith('--xomgay-version=')) || '').slice('--xomgay-version='.length);
contextBridge.exposeInMainWorld('splash', {
  version,
  onStatus: (cb) => ipcRenderer.on('splash:status', (_e, t) => cb(String(t))),
  onError: (cb) => ipcRenderer.on('splash:error', (_e, t) => cb(String(t))),
  onReady: (cb) => ipcRenderer.on('splash:ready', () => cb()),
  retry: () => ipcRenderer.send('splash:retry'),
  quit: () => ipcRenderer.send('splash:quit'),
});
