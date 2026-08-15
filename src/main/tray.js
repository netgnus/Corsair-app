// tray.js — system tray icon + menu.
// v1.2.0: the menu is rebuilt only when tray-relevant config changes
// (display selection, bar height) — not on slot/browser/weather changes.
const { app, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const configMod = require('./config');
const windowMod = require('./window');

let tray = null;

const TRAY_RELEVANT_KEYS = new Set(['displayIndex', 'barHeight']);

function build() {
  let icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'tray.png'));
  if (icon.isEmpty()) {
    icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVR42mNk+M9Qz0BFwDiqgGGAFTAyMAwAAB9pBgGzqQ3yAAAAAElFTkSuQmCC'
    );
  }
  tray = new Tray(icon);
  rebuildMenu();
  tray.setToolTip('iPad Dock — click to show/hide');
  tray.on('click', windowMod.showDock);
  tray.on('double-click', windowMod.showDock);
}

function rebuildMenu() {
  if (!tray) return;
  const config = configMod.get();
  const displays = screen.getAllDisplays();
  const displayItems = displays.map((d, i) => ({
    label: `Display ${i + 1} — ${d.bounds.width}×${d.bounds.height}${d.id === screen.getPrimaryDisplay().id ? ' (primary)' : ''}`,
    type: 'radio',
    checked: config.displayIndex === i,
    click: () => { configMod.applyPatch({ displayIndex: i }); windowMod.placeWindow(); rebuildMenu(); }
  }));

  const menu = Menu.buildFromTemplate([
    { label: 'iPad Dock', enabled: false },
    { type: 'separator' },
    { label: 'Show / Restore dock', click: windowMod.showDock },
    { label: 'Re-snap to bottom', click: () => { configMod.applyPatch({ bounds: null }); windowMod.placeWindow(); } },
    { type: 'separator' },
    {
      label: 'Dock on display',
      submenu: [
        { label: 'Auto (iPad / external)', type: 'radio', checked: config.displayIndex === -1, click: () => { configMod.applyPatch({ displayIndex: -1 }); windowMod.placeWindow(); rebuildMenu(); } },
        { type: 'separator' },
        ...displayItems
      ]
    },
    {
      label: 'Bar height',
      submenu: [240, 280, 320, 360, 400, 460, 520].map(hh => ({
        label: `${hh}px`,
        type: 'radio',
        checked: config.barHeight === hh,
        click: () => { configMod.applyPatch({ barHeight: hh }); windowMod.placeWindow(); rebuildMenu(); }
      }))
    },
    { label: 'Open settings…', click: () => { const w = windowMod.getWin(); if (w) w.webContents.send('open-settings'); } },
    { type: 'separator' },
    { label: 'Reload', click: () => { const w = windowMod.getWin(); if (w) w.reload(); } },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

// Called by IPC after a set-config patch: rebuild only if it matters here.
function onConfigChanged(changedKeys) {
  if (changedKeys.some(k => TRAY_RELEVANT_KEYS.has(k))) rebuildMenu();
}

module.exports = { build, rebuildMenu, onConfigChanged };
