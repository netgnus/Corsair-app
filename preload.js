// preload.js — the ONLY bridge between the sandboxed renderer and main.
// Thin, explicit, no Node objects cross the boundary.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dock', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
  pickPhotoFolder: () => ipcRenderer.invoke('pick-photo-folder'),
  listPhotos: () => ipcRenderer.invoke('list-photos'),
  getStats: () => ipcRenderer.invoke('get-stats'),
  getWeather: () => ipcRenderer.invoke('get-weather'),
  getHealth: () => ipcRenderer.invoke('get-health'),
  minimize: () => ipcRenderer.send('window-minimize'),
  getMedia: () => ipcRenderer.invoke('get-media'),
  mediaKey: (key) => ipcRenderer.send('media-key', String(key)),
  getLauncher: () => ipcRenderer.invoke('get-launcher'),
  launchApp: (id) => ipcRenderer.send('launch-app', String(id)),   // opaque ID, never a path
  getVolume: () => ipcRenderer.invoke('get-volume'),
  setVolume: (pct) => ipcRenderer.invoke('set-volume', pct),
  toggleMute: () => ipcRenderer.invoke('toggle-mute'),
  onOpenSettings: (cb) => ipcRenderer.on('open-settings', () => cb())
});
