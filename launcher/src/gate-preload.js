'use strict';
// gate.html: server status and login state in; login / Discord / quit out. Nothing else.
const { contextBridge, ipcRenderer } = require('electron');
const version = (process.argv.find((a) => a.startsWith('--xomgay-version=')) || '').slice('--xomgay-version='.length);
contextBridge.exposeInMainWorld('gate', {
  version,
  onServer: (cb) => ipcRenderer.on('gate:server', (_e, s) => cb(s)),
  onLogin: (cb) => ipcRenderer.on('gate:login', (_e, state) => cb(String(state))),
  login: () => ipcRenderer.send('gate:login'),
  reopen: () => ipcRenderer.send('gate:reopen'),
  cancel: () => ipcRenderer.send('gate:cancel'),
  open: (url) => ipcRenderer.send('gate:open', String(url)),
  quit: () => ipcRenderer.send('gate:quit'),
});
