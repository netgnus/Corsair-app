const { app, BrowserWindow, ipcMain, screen, Tray, Menu, dialog, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const readline = require('readline');

let si = null;
try {
  si = require('systeminformation');
} catch (e) {
  console.warn('systeminformation not installed yet — system monitor will be limited.');
}

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_CONFIG = {
  barHeight: 320,        // height of the dock in DIP
  displayIndex: -1,      // -1 = auto (prefer non-primary / iPad)
  bounds: null,          // remembered window position/size {x,y,width,height}
  photoFolder: '',       // folder to pull slideshow photos from
  slideMs: 8000,         // ms between photos
  shuffle: true,         // randomize photo order
  slots: ['browser', 'photos', 'clock'],  // which widget shows in each of the 3 slots
  browserUrls: ['https://www.google.com', 'https://www.google.com', 'https://www.google.com'],
  weather: {
    auto: true,          // detect location via IP
    lat: null,
    lon: null,
    city: '',
    unit: 'metric'       // 'metric' | 'imperial'
  }
};

let config = { ...DEFAULT_CONFIG };
let win = null;
let tray = null;

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      config = { ...DEFAULT_CONFIG, ...raw, weather: { ...DEFAULT_CONFIG.weather, ...(raw.weather || {}) } };
    }
  } catch (e) {
    console.error('Failed to read config, using defaults:', e.message);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save config:', e.message);
  }
}

// Pick the display to dock onto. Auto = prefer the largest non-primary display (the iPad).
function pickDisplay() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  if (config.displayIndex >= 0 && displays[config.displayIndex]) {
    return displays[config.displayIndex];
  }
  const externals = displays.filter(d => d.id !== primary.id);
  if (externals.length) {
    // largest external by area
    externals.sort((a, b) => (b.bounds.width * b.bounds.height) - (a.bounds.width * a.bounds.height));
    return externals[0];
  }
  return primary;
}

// Auto-snap: full width along the bottom of the chosen display, using barHeight.
function placeWindow() {
  if (!win) return;
  const d = pickDisplay();
  const b = d.bounds;
  const h = Math.min(config.barHeight, b.height);
  win.setBounds({ x: b.x, y: b.y + b.height - h, width: b.width, height: h });
}

// True if a saved bounds rect still lands (mostly) on a connected display.
function boundsValid(bn) {
  if (!bn || !bn.width || !bn.height) return false;
  if (bn.width < 400 || bn.height < 160) return false;   // ignore a broken/tiny saved size

  return screen.getAllDisplays().some(d => {
    const a = d.bounds;
    const ix = Math.max(0, Math.min(bn.x + bn.width, a.x + a.width) - Math.max(bn.x, a.x));
    const iy = Math.max(0, Math.min(bn.y + bn.height, a.y + a.height) - Math.max(bn.y, a.y));
    return (ix * iy) > (bn.width * bn.height * 0.5);   // >50% of the window is on this display
  });
}

// Restore the user's remembered position/size if it's still valid; otherwise auto-snap.
// Suppress saving during the programmatic move so it can't overwrite the saved bounds
// (e.g. while the iPad display is connecting/disconnecting).
function restoreOrPlace() {
  if (!win) return;
  _suppressSave = true;
  if (boundsValid(config.bounds)) win.setBounds(config.bounds);
  else placeWindow();
  setTimeout(() => { _suppressSave = false; }, 700);
}

// Persist wherever the USER drags/resizes the dock. OS/automatic moves are suppressed.
let _boundsTimer = null;
let _suppressSave = false;
function saveBounds() {
  if (!win || _suppressSave) return;
  const b = win.getBounds();
  if (!boundsValid(b)) return;          // never save an off-screen/transient position
  config.bounds = b;
  clearTimeout(_boundsTimer);
  _boundsTimer = setTimeout(saveConfig, 300);
}
function flushBounds() { if (_boundsTimer) { clearTimeout(_boundsTimer); saveConfig(); } }

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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  restoreOrPlace();   // use remembered position/size if still valid

  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.on('closed', () => { win = null; });

  // Windows re-adds a taskbar button on restore/show — keep it hidden.
  win.on('restore', () => win.setSkipTaskbar(true));
  win.on('show', () => win.setSkipTaskbar(true));

  // Remember the user's manual position / size
  win.on('moved', saveBounds);
  win.on('resized', saveBounds);

  // When the iPad display (re)connects, snap back to the remembered spot.
  // When it disconnects, only relocate if the window is now stranded off-screen.
  screen.on('display-added', restoreOrPlace);
  screen.on('display-removed', () => { if (win && !boundsValid(win.getBounds())) restoreOrPlace(); });
}

// Bring the dock back from minimized/hidden and re-assert always-on-top.
function showDock() {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.setSkipTaskbar(true);                 // keep it out of the taskbar after restore
  win.setAlwaysOnTop(true, 'screen-saver');
}

function buildTray() {
  // bar-chart tray icon; fall back to a 1x1 transparent pixel if the file is missing
  let icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  if (icon.isEmpty()) {
    icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVR42mNk+M9Qz0BFwDiqgGGAFTAyMAwAAB9pBgGzqQ3yAAAAAElFTkSuQmCC'
    );
  }
  tray = new Tray(icon);
  rebuildTrayMenu();
  tray.setToolTip('iPad Dock — click to show/hide');
  // Single OR double click on the tray icon brings the dock back
  tray.on('click', showDock);
  tray.on('double-click', showDock);
}

function rebuildTrayMenu() {
  const displays = screen.getAllDisplays();
  const displayItems = displays.map((d, i) => ({
    label: `Display ${i + 1} — ${d.bounds.width}×${d.bounds.height}${d.id === screen.getPrimaryDisplay().id ? ' (primary)' : ''}`,
    type: 'radio',
    checked: config.displayIndex === i,
    click: () => { config.displayIndex = i; saveConfig(); placeWindow(); }
  }));

  const menu = Menu.buildFromTemplate([
    { label: 'iPad Dock', enabled: false },
    { type: 'separator' },
    { label: 'Show / Restore dock', click: showDock },
    { label: 'Re-snap to bottom', click: () => { config.bounds = null; saveConfig(); placeWindow(); } },
    { type: 'separator' },
    {
      label: 'Dock on display',
      submenu: [
        { label: 'Auto (iPad / external)', type: 'radio', checked: config.displayIndex === -1, click: () => { config.displayIndex = -1; saveConfig(); placeWindow(); } },
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
        click: () => { config.barHeight = hh; saveConfig(); placeWindow(); }
      }))
    },
    { label: 'Open settings…', click: () => win && win.webContents.send('open-settings') },
    { type: 'separator' },
    { label: 'Reload', click: () => win && win.reload() },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

// ---------- IPC ----------

ipcMain.handle('get-config', () => config);

ipcMain.handle('set-config', (_e, patch) => {
  // Only re-snap the window when height/display explicitly change — NOT on
  // slot switches, browser navigation, weather, etc. (those must leave the
  // user's chosen position/size alone).
  const needPlace = ('barHeight' in patch) || ('displayIndex' in patch);
  config = { ...config, ...patch, weather: { ...config.weather, ...(patch.weather || {}) } };
  saveConfig();
  if (needPlace) placeWindow();
  rebuildTrayMenu();
  return config;
});

ipcMain.handle('pick-photo-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths.length) return null;
  config.photoFolder = r.filePaths[0];
  saveConfig();
  return config.photoFolder;
});

// Async, time-bounded recursive scan. Uses fs.promises (libuv threadpool) so a
// slow/offline network share NEVER blocks the main process / UI. Caches the last
// good result per folder so a transient outage keeps showing the previous photos.
const fsp = fs.promises;
let _photoCache = { folder: null, list: [] };
let _photoScanning = false;

ipcMain.handle('list-photos', async () => {
  const folder = config.photoFolder;
  if (!folder) return [];
  if (_photoScanning) return _photoCache.list;          // don't pile up scans
  _photoScanning = true;
  const out = [];
  const MAX = 5000;
  const MAX_DEPTH = 8;
  const deadline = Date.now() + 6000;                   // give up after 6s (e.g. share offline)
  async function walk(dir, depth) {
    if (depth > MAX_DEPTH || out.length >= MAX || Date.now() > deadline) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (out.length >= MAX || Date.now() > deadline) break;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || e.name === '$RECYCLE.BIN' || e.name === 'System Volume Information') continue;
        await walk(full, depth + 1);
      } else if (e.isFile() && IMG_EXT.has(path.extname(e.name).toLowerCase())) {
        out.push('file://' + full.replace(/\\/g, '/'));
      }
    }
  }
  try { await walk(folder, 0); } catch (e) {}
  _photoScanning = false;
  if (out.length) { _photoCache = { folder, list: out }; return out; }
  // nothing found (offline share / empty) — reuse cache if it's the same folder
  return (_photoCache.folder === folder) ? _photoCache.list : [];
});

/* ============================================================
   Persistent data helpers — spawned ONCE, stream forever.
   The old design spawned processes on every poll (nvidia-smi every 2s,
   plus systeminformation's battery/mem/networkStats each spawning
   PowerShell per call = ~150 process creations/minute), which alone
   burned a huge chunk of CPU. Never poll by spawning.
   ============================================================ */

// --- stats-loop.ps1: ONE PowerShell streams {net totals, media} every 2s ---
let _helper = null, _helperLastSpawn = 0;
let _mediaCache = null;
let _netCache = null;    // {rx, tx, iface} as bytes/sec rates
let _netPrev = null;     // previous cumulative totals
function startStatsHelper() {
  if (_helper) return;
  const now = Date.now();
  if (now - _helperLastSpawn < 10000) return;   // respawn backoff
  _helperLastSpawn = now;
  try {
    _helper = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'stats-loop.ps1')],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { _helper = null; return; }
  const rl = readline.createInterface({ input: _helper.stdout });
  rl.on('line', (line) => {
    let j; try { j = JSON.parse(line); } catch (e) { return; }
    _mediaCache = (j.media && j.media.title) ? j.media : null;
    if (j.net) {
      if (_netPrev && j.ts > _netPrev.ts && j.net.rx >= _netPrev.rx && j.net.tx >= _netPrev.tx) {
        const dt = (j.ts - _netPrev.ts) / 1000;
        _netCache = { rx: (j.net.rx - _netPrev.rx) / dt, tx: (j.net.tx - _netPrev.tx) / dt, iface: j.net.name };
      }
      _netPrev = { rx: j.net.rx, tx: j.net.tx, ts: j.ts };
    }
  });
  const gone = () => { _helper = null; };
  _helper.on('exit', gone);
  _helper.on('error', gone);
}

// --- GPU: ONE persistent `nvidia-smi -l 5` streams a reading every 5s ---
let _gpuCache = { ts: 0, data: null };
let _gpuProc = null, _gpuLastSpawn = 0, _nvidiaFailed = false;
function startGpuLoop() {
  if (_gpuProc || _nvidiaFailed) return;
  const now = Date.now();
  if (now - _gpuLastSpawn < 15000) return;      // respawn backoff
  _gpuLastSpawn = now;
  const query = 'utilization.gpu,memory.used,memory.total,temperature.gpu,clocks.current.graphics,power.draw,name';
  try {
    _gpuProc = spawn('nvidia-smi', ['-l', '5', `--query-gpu=${query}`, '--format=csv,noheader,nounits'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { _nvidiaFailed = true; return; }
  const rl = readline.createInterface({ input: _gpuProc.stdout });
  rl.on('line', (line) => {
    const p = line.split(',').map(s => s.trim());
    if (p.length < 7) return;
    const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
    _gpuCache = {
      ts: Date.now(),
      data: {
        util: num(p[0]),
        memUsed: num(p[1]) != null ? num(p[1]) * 1024 * 1024 : null,   // MB -> bytes
        memTotal: num(p[2]) != null ? num(p[2]) * 1024 * 1024 : null,
        temp: num(p[3]),
        clock: num(p[4]),
        power: num(p[5]),
        name: p[6] || 'GPU',
        source: 'nvidia-smi'
      }
    };
  });
  _gpuProc.on('exit', (code) => { _gpuProc = null; if (!_gpuCache.data) _nvidiaFailed = true; });
  _gpuProc.on('error', () => { _gpuProc = null; _nvidiaFailed = true; });
}

// Fallback for non-NVIDIA machines only — cached 30s so it can't spawn-storm.
async function getGpuSiFallback() {
  if (!si) return null;
  try {
    const g = await si.graphics();
    const c = (g.controllers || []).filter(c => c.utilizationGpu != null || (c.memoryTotal || c.vram))
      .sort((a, b) => (b.memoryTotal || b.vram || 0) - (a.memoryTotal || a.vram || 0))[0];
    if (!c) return null;
    return {
      util: c.utilizationGpu ?? null,
      memUsed: c.memoryUsed != null ? c.memoryUsed * 1024 * 1024 : null,
      memTotal: (c.memoryTotal || c.vram) ? (c.memoryTotal || c.vram) * 1024 * 1024 : null,
      temp: c.temperatureGpu ?? null,
      clock: c.clockCore ?? null,
      power: null,
      name: c.model || 'GPU',
      source: 'si'
    };
  } catch (e) { return null; }
}

async function getGpu() {
  startGpuLoop();
  if (!_nvidiaFailed) return _gpuCache.data;    // streamed by the loop (may be null briefly at startup)
  if (Date.now() - _gpuCache.ts < 30000) return _gpuCache.data;
  const data = await getGpuSiFallback();
  _gpuCache = { ts: Date.now(), data };
  return data;
}

// --- battery: desktops have none — check once, then never spawn WMI again.
// (si.battery() on Windows spawns THREE PowerShell processes per call.)
let _batt = { ts: 0, data: null };
async function getBattery() {
  if (_batt.data && _batt.data.hasBattery === false) return _batt.data;   // desktop: cached forever
  if (_batt.data && Date.now() - _batt.ts < 30000) return _batt.data;     // laptop: refresh every 30s
  try {
    const b = si ? await si.battery() : null;
    _batt = {
      ts: Date.now(),
      data: (b && b.hasBattery) ? { pct: b.percent, charging: b.acConnected, hasBattery: true } : { hasBattery: false }
    };
  } catch (e) { _batt = { ts: Date.now(), data: { hasBattery: false } }; }
  return _batt.data;
}

function stopHelpers() {
  try { if (_helper) _helper.kill(); } catch (e) {}
  try { if (_gpuProc) _gpuProc.kill(); } catch (e) {}
}

// --- FPS from the elevated PresentMon helper (fps.json) ---
function getFps() {
  try {
    const f = path.join(__dirname, 'fps.json');
    if (!fs.existsSync(f)) return { fps: null, status: 'not-running' };
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const age = Date.now() - (j.ts || 0);
    if (age > 4000) return { fps: null, status: 'stale' };        // helper not updating
    if (j.error) return { fps: null, status: j.error };
    return { fps: j.fps, app: j.app || null, status: 'ok' };
  } catch (e) { return { fps: null, status: 'error' }; }
}

// --- CPU model name (cached; doesn't change) ---
let _cpuName = null;
async function getCpuName() {
  if (_cpuName != null) return _cpuName;
  _cpuName = '';
  if (si) { try { const c = await si.cpu(); _cpuName = (c.brand || `${c.manufacturer || ''} ${c.family || ''}`).trim(); } catch (e) {} }
  return _cpuName;
}

// Everything here reads in-process caches or native os.* — NO process is
// spawned per poll. Network + media stream from the persistent helper.
ipcMain.handle('get-stats', async () => {
  startStatsHelper();
  const stats = {
    cpu: null, mem: null, net: _netCache, battery: null, gpu: null, fps: getFps(),
    host: os.hostname(),
    uptime: os.uptime()
  };
  const total = os.totalmem();
  const free = os.freemem();
  stats.mem = { used: total - free, total, pct: ((total - free) / total) * 100 };
  stats.gpu = await getGpu();
  stats.battery = await getBattery();
  if (si) {
    try {
      const load = await si.currentLoad();   // native os.cpus() deltas — spawn-free
      stats.cpu = { pct: load.currentLoad, cores: load.cpus ? load.cpus.length : os.cpus().length, name: await getCpuName() };
    } catch (e) {}
  }
  return stats;
});

ipcMain.handle('get-weather', async () => {
  try {
    let { lat, lon, city, auto, unit } = config.weather;
    if (auto || lat == null || lon == null) {
      const geo = await fetch('http://ip-api.com/json/?fields=lat,lon,city').then(r => r.json());
      if (geo && geo.lat != null) {
        lat = geo.lat; lon = geo.lon; city = geo.city || city;
      }
    }
    if (lat == null || lon == null) return { error: 'no-location' };
    const tempUnit = unit === 'imperial' ? 'fahrenheit' : 'celsius';
    const windUnit = unit === 'imperial' ? 'mph' : 'kmh';
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day` +
      `&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min` +
      `&temperature_unit=${tempUnit}&wind_speed_unit=${windUnit}&timezone=auto&forecast_days=1`;
    const w = await fetch(url).then(r => r.json());
    let daily = null;
    if (w.daily) {
      daily = {
        sunrise: w.daily.sunrise && w.daily.sunrise[0],
        sunset: w.daily.sunset && w.daily.sunset[0],
        tMax: w.daily.temperature_2m_max && w.daily.temperature_2m_max[0],
        tMin: w.daily.temperature_2m_min && w.daily.temperature_2m_min[0]
      };
    }
    return { city, unit, current: w.current || null, daily };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.on('window-minimize', () => win && win.minimize());

// --- Now-playing media: served from the persistent helper's cache (no spawn) ---
ipcMain.handle('get-media', () => { startStatsHelper(); return _mediaCache; });

// --- Media transport: send a global media key (next | prev | playpause) ---
ipcMain.on('media-key', (_e, key) => {
  const k = ['next', 'prev', 'playpause'].includes(key) ? key : 'playpause';
  execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'media-key.ps1'), k],
    { windowsHide: true }, () => {});
});

// --- System volume (CoreAudio via volume.ps1) ---
function runVolume(args) {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'volume.ps1'), ...args],
      { timeout: 4000, windowsHide: true }, (err, stdout) => resolve((stdout || '').trim()));
  });
}
ipcMain.handle('get-volume', async () => { const v = parseInt(await runVolume(['get']), 10); return isNaN(v) ? null : v; });
ipcMain.handle('set-volume', async (_e, pct) => {
  pct = Math.max(0, Math.min(100, parseInt(pct, 10) || 0));
  const v = parseInt(await runVolume(['set', String(pct)]), 10);
  return isNaN(v) ? pct : v;
});
ipcMain.handle('toggle-mute', async () => (await runVolume(['mute'])) === 'muted');

// --- App launcher: read apps.json (from resolve-apps.ps1) and launch on tap ---
ipcMain.handle('get-launcher', () => {
  try {
    const f = path.join(__dirname, 'apps.json');
    if (!fs.existsSync(f)) return [];
    const arr = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
    return (Array.isArray(arr) ? arr : []).map(a => ({
      name: a.name,
      target: a.target,
      icon: a.icon ? 'file:///' + path.join(__dirname, a.icon).replace(/\\/g, '/') : null
    }));
  } catch (e) { return []; }
});

ipcMain.on('launch-app', (_e, target) => {
  if (!target) return;
  shell.openPath(target).then(err => { if (err) console.error('launch failed:', err); });
});

// ---------- lifecycle ----------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { showDock(); });   // just reveal it — don't reposition
  app.on('before-quit', flushBounds);                  // persist position before exiting
  app.on('before-quit', stopHelpers);                  // kill the persistent data helpers
  app.whenReady().then(() => {
    loadConfig();
    createWindow();
    buildTray();
    startStatsHelper();                                // warm the net/media stream
    startGpuLoop();                                    // warm the GPU stream
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

// Keep running in tray even if window closes
app.on('window-all-closed', () => { /* stay alive in tray */ });
