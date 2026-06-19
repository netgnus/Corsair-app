const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dock', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
  pickPhotoFolder: () => ipcRenderer.invoke('pick-photo-folder'),
  listPhotos: () => ipcRenderer.invoke('list-photos'),
  getStats: () => ipcRenderer.invoke('get-stats'),
  getWeather: () => ipcRenderer.invoke('get-weather'),
  minimize: () => ipcRenderer.send('window-minimize'),
  getMedia: () => ipcRenderer.invoke('get-media'),
  mediaKey: (key) => ipcRenderer.send('media-key', key),
  getLauncher: () => ipcRenderer.invoke('get-launcher'),
  launchApp: (target) => ipcRenderer.send('launch-app', target),
  getVolume: () => ipcRenderer.invoke('get-volume'),
  setVolume: (pct) => ipcRenderer.invoke('set-volume', pct),
  toggleMute: () => ipcRenderer.invoke('toggle-mute'),
  onOpenSettings: (cb) => ipcRenderer.on('open-settings', cb)
});
