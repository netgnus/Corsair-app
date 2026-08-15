// app.js — application lifecycle: single instance, startup order, shutdown.
const { app, BrowserWindow } = require('electron');

const configMod = require('./config');
const windowMod = require('./window');
const trayMod = require('./tray');
const security = require('./security');
const telemetry = require('./telemetry');
const ipc = require('./ipc');

function run() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) { app.quit(); return; }

  app.on('second-instance', () => { windowMod.showDock(); });   // reveal, don't reposition
  app.on('before-quit', () => configMod.flush());                // persist pending config
  app.on('before-quit', () => telemetry.stop());                 // kill persistent helpers

  app.whenReady().then(() => {
    configMod.load();
    security.install(windowMod.getWin);
    ipc.register();
    windowMod.createWindow();
    trayMod.build();
    telemetry.start();                                           // streams + watchdog
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) windowMod.createWindow(); });
  });

  // Keep running in tray even if the window closes.
  app.on('window-all-closed', () => { /* stay alive in tray */ });
}

module.exports = { run };
