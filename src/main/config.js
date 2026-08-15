// config.js — schema-versioned, validated, atomically persisted configuration.
//
// v1.2.0: configVersion 2. Older (v1.1.0, unversioned) configs are migrated in
// place. Every field is validated on load AND on every set-config patch from
// the renderer; bad values fall back to safe defaults instead of crashing.
// Writes are debounced and atomic (temp file + rename) so a crash mid-write
// can never leave a truncated config.json.
const path = require('path');
const fs = require('fs');
const os = require('os');

// Under Electron this is the real app; under plain `node --test` the electron
// package resolves to a path string, so `.app` is undefined — the pure logic
// (migrate/sanitize/validators) stays fully testable without a UI.
let app = null;
try { app = require('electron').app || null; } catch (e) {}

const CONFIG_VERSION = 2;
const CONFIG_DIR = process.env.IPAD_DOCK_CONFIG_DIR ||
  (app ? app.getPath('userData') : path.join(os.tmpdir(), 'ipad-dock-test'));
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const WIDGET_KEYS = ['browser', 'apps', 'photos', 'clock', 'system'];
// barHeight is the AUTO-SNAP height, set only from the tray presets
// (240/280/320/360/400/460/520 in tray.js). The vh-scaled layout is designed
// for this range; values outside it fall back rather than produce a cramped
// or overflowing bar. (Free-form window RESIZING is a different field —
// `bounds` — which window.js validates separately, minimum 160px tall.)
const BAR_HEIGHT_MIN = 240, BAR_HEIGHT_MAX = 520;
const SLIDE_MS_MIN = 2000, SLIDE_MS_MAX = 600000;

const DEFAULT_CONFIG = Object.freeze({
  configVersion: CONFIG_VERSION,
  barHeight: 320,
  displayIndex: -1,          // -1 = auto (prefer non-primary / iPad)
  bounds: null,              // remembered window rect {x,y,width,height}
  photoFolder: '',
  slideMs: 8000,
  shuffle: true,
  slots: ['browser', 'photos', 'clock'],
  browserUrls: ['https://www.google.com', 'https://www.google.com', 'https://www.google.com'],
  weather: { auto: true, lat: null, lon: null, city: '', unit: 'metric' }
});

// ---------- validators (each returns a safe value, never throws) ----------

function vInt(v, min, max, dflt) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
}
function vBool(v, dflt) { return typeof v === 'boolean' ? v : dflt; }
function vString(v, dflt, maxLen = 4096) {
  return (typeof v === 'string' && v.length <= maxLen) ? v : dflt;
}
function vHttpUrl(v, dflt) {
  if (typeof v !== 'string' || v.length > 2048) return dflt;
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? v : dflt;
  } catch (e) { return dflt; }
}
function vBounds(v) {
  if (!v || typeof v !== 'object') return null;
  const { x, y, width, height } = v;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width < 400 || height < 160 || width > 20000 || height > 20000) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
function vSlots(v, current) {
  const fallback = (Array.isArray(current) && current.length === 3) ? current : DEFAULT_CONFIG.slots;
  if (!Array.isArray(v) || v.length !== 3) return [...fallback];
  return v.map((k, i) => WIDGET_KEYS.includes(k) ? k : fallback[i]);
}
function vBrowserUrls(v) {
  const dflt = DEFAULT_CONFIG.browserUrls;
  if (!Array.isArray(v)) return [...dflt];
  return [0, 1, 2].map(i => vHttpUrl(v[i], dflt[i]));
}
function vLat(v) { const n = Number(v); return (Number.isFinite(n) && n >= -90 && n <= 90) ? n : null; }
function vLon(v) { const n = Number(v); return (Number.isFinite(n) && n >= -180 && n <= 180) ? n : null; }
function vWeather(v) {
  const w = (v && typeof v === 'object') ? v : {};
  return {
    auto: vBool(w.auto, true),
    lat: vLat(w.lat),
    lon: vLon(w.lon),
    city: vString(w.city, '', 128),
    unit: (w.unit === 'imperial') ? 'imperial' : 'metric'
  };
}

// Whitelist: the ONLY fields the renderer (or a config file) can set, with
// their validators. Anything else in a patch is silently dropped.
const FIELD_VALIDATORS = {
  barHeight: (v, cur) => vInt(v, BAR_HEIGHT_MIN, BAR_HEIGHT_MAX, cur.barHeight),
  displayIndex: (v, cur) => vInt(v, -1, 15, cur.displayIndex),
  bounds: (v) => vBounds(v),
  photoFolder: (v, cur) => vString(v, cur.photoFolder),
  slideMs: (v, cur) => vInt(v, SLIDE_MS_MIN, SLIDE_MS_MAX, cur.slideMs),
  shuffle: (v, cur) => vBool(v, cur.shuffle),
  slots: (v, cur) => vSlots(v, cur.slots),
  browserUrls: (v) => vBrowserUrls(v),
  weather: (v) => vWeather(v)
};

// ---------- migration ----------

function migrate(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG };
  const ver = Number(raw.configVersion) || 1;   // v1.1.0 configs carried no version
  if (ver < 2) {
    // v1 -> v2: same field set; validation below normalizes everything.
    raw.configVersion = 2;
  }
  return raw;
}

function sanitize(raw) {
  const cfg = { ...DEFAULT_CONFIG, weather: { ...DEFAULT_CONFIG.weather } };
  for (const [key, validate] of Object.entries(FIELD_VALIDATORS)) {
    if (raw[key] !== undefined) cfg[key] = validate(raw[key], cfg);
  }
  cfg.configVersion = CONFIG_VERSION;
  return cfg;
}

// ---------- state + persistence ----------

let config = { ...DEFAULT_CONFIG };
let _saveTimer = null;
let _dirty = false;

function load() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      const wasVersion = Number(raw && raw.configVersion) || 1;
      config = sanitize(migrate(raw));
      if (wasVersion !== CONFIG_VERSION) scheduleSave();   // persist the migration once
    }
  } catch (e) {
    console.error('config: failed to read, using defaults:', e.message);
    config = { ...DEFAULT_CONFIG, weather: { ...DEFAULT_CONFIG.weather } };
  }
  return config;
}

// Atomic write: full JSON to a temp file in the same directory, then rename
// over config.json (rename replaces atomically on the same volume).
function writeNow() {
  _dirty = false;
  const tmp = CONFIG_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_PATH);
  } catch (e) {
    console.error('config: save failed:', e.message);
    try { fs.rmSync(tmp, { force: true }); } catch (e2) {}
  }
}

function scheduleSave() {
  _dirty = true;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(writeNow, 500);
}

function flush() {
  clearTimeout(_saveTimer);
  if (_dirty) writeNow();
}

// Apply a whitelisted, validated patch. Returns { config, changedKeys }.
function applyPatch(patch) {
  const changedKeys = [];
  if (patch && typeof patch === 'object') {
    for (const [key, validate] of Object.entries(FIELD_VALIDATORS)) {
      if (patch[key] === undefined) continue;
      const next = validate(patch[key], config);
      if (JSON.stringify(next) !== JSON.stringify(config[key])) {
        config[key] = next;
        changedKeys.push(key);
      }
    }
  }
  if (changedKeys.length) scheduleSave();
  return { config, changedKeys };
}

function get() { return config; }

module.exports = {
  CONFIG_VERSION, DEFAULT_CONFIG, WIDGET_KEYS,
  load, get, applyPatch, scheduleSave, flush, writeNow, sanitize, migrate
};
