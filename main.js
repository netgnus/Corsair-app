const { app, BrowserWindow, ipcMain, screen, Tray, Menu, dialog, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

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
function restoreOrPlace() {
  if (!win) return;
  if (boundsValid(config.bounds)) win.setBounds(config.bounds);
  else placeWindow();
}

// Persist wherever the user drags/resizes the dock (debounced).
let _boundsTimer = null;
let _suppressSave = false;
function saveBounds() {
  if (!win || _suppressSave) return;
  config.bounds = win.getBounds();
  clearTimeout(_boundsTimer);
  _boundsTimer = setTimeout(saveConfig, 700);
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

  // Only re-evaluate placement when the set of displays actually changes
  // (and even then, keep the user's spot if it's still on a valid screen).
  screen.on('display-added', restoreOrPlace);
  screen.on('display-removed', restoreOrPlace);
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
  // 1x1 transparent fallback icon so the tray always shows
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVR42mNk+M9Qz0BFwDiqgGGAFTAyMAwAAB9pBgGzqQ3yAAAAAElFTkSuQmCC'
  );
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

ipcMain.handle('list-photos', () => {
  const folder = config.photoFolder;
  if (!folder || !fs.existsSync(folder)) return [];
  const out = [];
  const MAX = 5000;        // safety cap
  const MAX_DEPTH = 8;     // how deep to recurse into subfolders
  function walk(dir, depth) {
    if (depth > MAX_DEPTH || out.length >= MAX) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (out.length >= MAX) break;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || e.name === '$RECYCLE.BIN' || e.name === 'System Volume Information') continue;
        walk(full, depth + 1);
      } else if (e.isFile() && IMG_EXT.has(path.extname(e.name).toLowerCase())) {
        out.push('file://' + full.replace(/\\/g, '/'));
      }
    }
  }
  try { walk(folder, 0); } catch (e) {}
  return out.sort();
});

// --- GPU via nvidia-smi (preferred on NVIDIA), fallback to systeminformation ---
let nvidiaOk = true;
function getGpuNvidia() {
  return new Promise((resolve) => {
    if (!nvidiaOk) return resolve(null);
    const query = 'utilization.gpu,memory.used,memory.total,temperature.gpu,clocks.current.graphics,power.draw,name';
    execFile('nvidia-smi', [`--query-gpu=${query}`, '--format=csv,noheader,nounits'],
      { timeout: 1500, windowsHide: true }, (err, stdout) => {
        if (err || !stdout) { nvidiaOk = false; return resolve(null); }
        const line = stdout.trim().split('\n')[0];
        const p = line.split(',').map(s => s.trim());
        const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
        resolve({
          util: num(p[0]),
          memUsed: num(p[1]) != null ? num(p[1]) * 1024 * 1024 : null,   // MB -> bytes
          memTotal: num(p[2]) != null ? num(p[2]) * 1024 * 1024 : null,
          temp: num(p[3]),
          clock: num(p[4]),
          power: num(p[5]),
          name: p[6] || 'GPU',
          source: 'nvidia-smi'
        });
      });
  });
}
async function getGpu() {
  const nv = await getGpuNvidia();
  if (nv) return nv;
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

// --- pick the real active network interface (prefer Wi-Fi/real NIC, skip VPN/virtual) ---
let _netIface = null, _netIfaceTs = 0;
const NET_BAD = /zerotier|loopback|bluetooth|virtual|vmware|hyper-v|vethernet|\btap\b|\btun\b|spacedesk|parsec|duet|displaylink|wintun/i;
async function pickNetIface() {
  const now = Date.now();
  if (_netIface && (now - _netIfaceTs < 30000)) return _netIface;
  if (!si) return null;
  try {
    const ifs = await si.networkInterfaces();
    const arr = Array.isArray(ifs) ? ifs : [ifs];
    const cand = arr.filter(i => i.operstate === 'up' && i.ip4 && i.ip4 !== '127.0.0.1'
      && !NET_BAD.test((i.iface || '') + ' ' + (i.ifaceName || '')));
    cand.sort((a, b) => (b.type === 'wireless' ? 1 : 0) - (a.type === 'wireless' ? 1 : 0)); // prefer wireless
    _netIface = (cand[0] && cand[0].iface) || null;
    _netIfaceTs = now;
  } catch (e) {}
  return _netIface;
}

ipcMain.handle('get-stats', async () => {
  const stats = {
    cpu: null, mem: null, net: null, battery: null, gpu: null, fps: null,
    host: os.hostname(),
    uptime: os.uptime()
  };
  stats.fps = getFps();
  if (!si) {
    const total = os.totalmem();
    const free = os.freemem();
    stats.mem = { used: total - free, total, pct: ((total - free) / total) * 100 };
    stats.gpu = await getGpu();
    return stats;
  }
  try {
    const iface = await pickNetIface();
    const [load, mem, net, batt, gpu] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.networkStats(iface || '*'),
      si.battery(),
      getGpu()
    ]);
    stats.cpu = { pct: load.currentLoad, cores: load.cpus ? load.cpus.length : os.cpus().length };
    stats.mem = { used: mem.active, total: mem.total, pct: (mem.active / mem.total) * 100 };
    const n = Array.isArray(net) ? net[0] : net;
    if (n) stats.net = { rx: n.rx_sec || 0, tx: n.tx_sec || 0, iface: n.iface };
    if (batt && batt.hasBattery) stats.battery = { pct: batt.percent, charging: batt.acConnected, hasBattery: true };
    else stats.battery = { hasBattery: false };
    stats.gpu = gpu;
  } catch (e) {
    console.error('stats error', e.message);
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
      `&temperature_unit=${tempUnit}&wind_speed_unit=${windUnit}&timezone=auto`;
    const w = await fetch(url).then(r => r.json());
    return { city, unit, current: w.current || null };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.on('window-minimize', () => win && win.minimize());

// --- Now-playing media (Windows SMTC via PowerShell) ---
ipcMain.handle('get-media', () => new Promise((resolve) => {
  execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'media-info.ps1')],
    { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      try {
        const j = JSON.parse(stdout.trim() || '{}');
        resolve(j && j.title ? j : null);
      } catch (e) { resolve(null); }
    });
}));

// --- Media transport: send a global media key (next | prev | playpause) ---
ipcMain.on('media-key', (_e, key) => {
  const k = ['next', 'prev', 'playpause'].includes(key) ? key : 'playpause';
  execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'media-key.ps1'), k],
    { windowsHide: true }, () => {});
});

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
  app.on('second-instance', () => { if (win) { placeWindow(); win.show(); } });
  app.whenReady().then(() => {
    loadConfig();
    createWindow();
    buildTray();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

// Keep running in tray even if window closes
app.on('window-all-closed', () => { /* stay alive in tray */ });
