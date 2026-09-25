'use strict';
// overlay.html: settings and data in; "resize" and "done dragging" out. Nothing else.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('overlay', {
  onSettings: (cb) => ipcRenderer.on('overlay:settings', (_e, s) => cb(s)),
  onState: (cb) => ipcRenderer.on('overlay:state', (_e, s) => cb(s)),
  onGame: (cb) => ipcRenderer.on('overlay:game', (_e, g) => cb(g)),
  onMap: (cb) => ipcRenderer.on('overlay:map', (_e, m) => cb(m)),
  onPreview: (cb) => ipcRenderer.on('overlay:preview', (_e, ms) => cb(Number(ms) || 6000)),
  /** Edit mode, dragging an edge / corner ('n', 'se'…): 'start' | 'move' | 'end'. */
  resize: (widget, phase, dir) => ipcRenderer.send('overlay:resize', String(widget), String(phase), String(dir || '')),
  doneEditing: () => ipcRenderer.send('overlay:edit-done'),
  /** Edit mode, moving the widget: 'start' | 'move' | 'end' (the launcher reads the pointer itself). */
  drag: (widget, phase) => ipcRenderer.send('overlay:drag', String(widget), String(phase)),
  /** Edit mode: switch this widget off / on right there. */
  toggleWidget: (widget) => ipcRenderer.send('overlay:toggle-widget', String(widget)),
});
