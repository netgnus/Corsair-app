// ipc.js — every IPC surface, in one place, with sender validation.
//
// v1.2.0 rules:
//   * only the dock's own window may call these handlers (webview guests have
//     no preload and are sandboxed, but we verify the sender anyway)
//   * set-config accepts only whitelisted, validated fields (config.js)
//   * launch-app accepts an opaque ID, never a filesystem path
const { ipcMain, dialog } = require('electron');
const { app } = require('electron');
const os = require('os');

const configMod = require('./config');
const windowMod = require('./window');
const trayMod = require('./tray');
const telemetry = require('./telemetry');
const weather = require('./weather');
const photos = require('./photos');
const launcher = require('./launcher');
const audio = require('./audio');

// Accept IPC only from the dock's own (top-level) renderer frame.
function trusted(event) {
  const w = windowMod.getWin();
  return !!(w && event.sender === w.webContents);
}
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) return null;
    return fn(event, ...args);
  });
}
function on(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    if (!trusted(event)) return;
    fn(event, ...args);
  });
}

function register() {
  // ----- config -----
  handle('get-config', () => configMod.get());

  handle('set-config', (_e, patch) => {
    const { config, changedKeys } = configMod.applyPatch(patch);
    // Re-snap only when height/display explicitly change — never on slot
    // switches, browser navigation or weather edits.
    if (changedKeys.includes('barHeight') || changedKeys.includes('displayIndex')) {
      windowMod.placeWindow();
    }
    if (changedKeys.includes('weather')) weather.invalidate();
    trayMod.onConfigChanged(changedKeys);
    return config;
  });

  // ----- photos -----
  handle('pick-photo-folder', async () => {
    const r = await dialog.showOpenDialog(windowMod.getWin(), { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths.length) return null;
    configMod.applyPatch({ photoFolder: r.filePaths[0] });
    return configMod.get().photoFolder;
  });
  handle('list-photos', () => photos.listPhotos(configMod.get().photoFolder));

  // ----- telemetry -----
  handle('get-stats', () => telemetry.getStats());
  handle('get-media', () => telemetry.getMedia());
  handle('get-weather', () => weather.getWeather());

  // ----- Dock Health diagnostics -----
  handle('get-health', () => ({
    version: app.getVersion(),
    uptimeSec: Math.round(process.uptime()),
    ...telemetry.getHealthSnapshot(),
    weather: { cacheAgeMs: weather.cacheAgeMs() },
    photos: photos.getHealth()
  }));

  // ----- window -----
  on('window-minimize', () => { const w = windowMod.getWin(); if (w) w.minimize(); });

  // ----- audio / media transport (user-triggered one-shots) -----
  on('media-key', (_e, key) => audio.mediaKey(key));
  handle('get-volume', () => audio.getVolume());
  handle('set-volume', (_e, pct) => audio.setVolume(pct));
  handle('toggle-mute', () => audio.toggleMute());

  // ----- app launcher (ID-based) -----
  handle('get-launcher', () => launcher.getLauncher());
  on('launch-app', (_e, id) => launcher.launchApp(id));
}

module.exports = { register };
