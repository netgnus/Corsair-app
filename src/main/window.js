// window.js — the dock BrowserWindow: creation, placement, remembered bounds.
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const configMod = require('./config');

let win = null;
let _suppressSave = false;
let _boundsTimer = null;

function getWin() { return win; }

// Pick the display to dock onto. Auto = prefer the largest non-primary display (the iPad).
function pickDisplay() {
  const config = configMod.get();
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  if (config.displayIndex >= 0 && displays[config.displayIndex]) {
    return displays[config.displayIndex];
  }
  const externals = displays.filter(d => d.id !== primary.id);
  if (externals.length) {
    externals.sort((a, b) => (b.bounds.width * b.bounds.height) - (a.bounds.width * a.bounds.height));
    return externals[0];
  }
  return primary;
}

// Auto-snap: full width along the bottom of the chosen display, using barHeight.
function placeWindow() {
  if (!win) return;
  const config = configMod.get();
  const d = pickDisplay();
  const b = d.bounds;
  const h = Math.min(config.barHeight, b.height);
  win.setBounds({ x: b.x, y: b.y + b.height - h, width: b.width, height: h });
}

// True if a bounds rect still lands (mostly) on a connected display.
function boundsValid(bn) {
  if (!bn || !bn.width || !bn.height) return false;
  if (bn.width < 400 || bn.height < 160) return false;
  return screen.getAllDisplays().some(d => {
    const a = d.bounds;
    const ix = Math.max(0, Math.min(bn.x + bn.width, a.x + a.width) - Math.max(bn.x, a.x));
    const iy = Math.max(0, Math.min(bn.y + bn.height, a.y + a.height) - Math.max(bn.y, a.y));
    return (ix * iy) > (bn.width * bn.height * 0.5);
  });
}

// Restore the user's remembered position/size if still valid; otherwise auto-snap.
// Saving is suppressed during the programmatic move so it can't overwrite the
// remembered bounds while the iPad display is connecting/disconnecting.
function restoreOrPlace() {
  if (!win) return;
  _suppressSave = true;
  const saved = configMod.get().bounds;
  if (boundsValid(saved)) win.setBounds(saved);
  else placeWindow();
  setTimeout(() => { _suppressSave = false; }, 700);
}

// Persist only USER drags/resizes; programmatic/OS moves are suppressed.
function saveBounds() {
  if (!win || _suppressSave) return;
  const b = win.getBounds();
  if (!boundsValid(b)) return;              // never save an off-screen/transient rect
  clearTimeout(_boundsTimer);
  _boundsTimer = setTimeout(() => configMod.applyPatch({ bounds: b }), 300);
}

function createWindow() {
  win = new BrowserWindow({
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a0f',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,                 // v1.2.0: renderer fully sandboxed
      webviewTag: true               // required by the Browser widget; guests are
                                     // locked down in security.js will-attach-webview
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  restoreOrPlace();

  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.on('closed', () => { win = null; });

  // Windows re-adds a taskbar button on restore/show — keep it hidden.
  win.on('restore', () => win.setSkipTaskbar(true));
  win.on('show', () => win.setSkipTaskbar(true));

  win.on('moved', saveBounds);
  win.on('resized', saveBounds);

  // iPad (re)connects: snap back to the remembered spot.
  // Disconnects: only relocate if the window is now stranded off-screen.
  screen.on('display-added', restoreOrPlace);
  screen.on('display-removed', () => { if (win && !boundsValid(win.getBounds())) restoreOrPlace(); });
  return win;
}

// Bring the dock back from minimized/hidden and re-assert always-on-top.
function showDock() {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.setSkipTaskbar(true);
  win.setAlwaysOnTop(true, 'screen-saver');
}

module.exports = { createWindow, getWin, showDock, placeWindow, restoreOrPlace, boundsValid };
