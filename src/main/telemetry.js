// telemetry.js — all OS telemetry, collected ONCE in the main process.
//
// Core v1.1 rule, preserved: NEVER spawn an external process per poll.
//   * ONE persistent stats-loop.ps1 streams {net totals, media} every 2s
//   * ONE persistent `nvidia-smi -l 5` streams GPU readings
//   * CPU via systeminformation currentLoad (native os.cpus deltas)
//   * RAM via native os.totalmem/freemem
//   * battery checked once (desktop => cached hasBattery:false forever)
//   * FPS read from fps.json written by the PresentMon helper
//
// v1.2.0 adds watchdogs: a helper that is alive but silent for >12s is
// killed and respawned (with the existing backoff), and health/restart
// counters are tracked for the Dock Health diagnostics panel.
const { spawn, execFile } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const os = require('os');

let si = null;
try { si = require('systeminformation'); } catch (e) {
  console.warn('telemetry: systeminformation missing — CPU load will be limited.');
}

const PROJECT_DIR = path.join(__dirname, '..', '..');
const STATS_PS1 = path.join(PROJECT_DIR, 'stats-loop.ps1');
const FPS_JSON = path.join(PROJECT_DIR, 'fps-data.json');   // renamed from fps.json: BD ATD blocklisted the old path

const STATS_STALE_MS = 12000;   // helper alive but silent this long => restart
const GPU_STALE_MS = 20000;     // nvidia-smi emits every 5s; 20s silent => restart
const RESPAWN_BACKOFF_MS = 10000;
const WATCHDOG_TICK_MS = 5000;

// ---------- health (surfaced in Dock Health diagnostics) ----------
const health = {
  stats: { running: false, lastUpdate: 0, restarts: 0, lastError: null },
  gpu:   { running: false, lastUpdate: 0, restarts: 0, lastError: null, unsupported: false }
};

// ---------- stats-loop.ps1: net + media stream ----------
let _helper = null, _helperLastSpawn = 0;
let _mediaCache = null;
let _netCache = null;    // {rx, tx, iface} as bytes/sec rates
let _netPrev = null;     // previous cumulative totals

function startStatsHelper() {
  if (_helper) return;
  const now = Date.now();
  if (now - _helperLastSpawn < RESPAWN_BACKOFF_MS) return;
  _helperLastSpawn = now;
  try {
    _helper = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', STATS_PS1],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    _helper = null;
    health.stats.lastError = 'spawn: ' + e.message;
    return;
  }
  health.stats.running = true;
  const rl = readline.createInterface({ input: _helper.stdout });
  const thisProc = _helper;
  rl.on('line', (line) => {
    let j; try { j = JSON.parse(line); } catch (e) { return; }
    health.stats.lastUpdate = Date.now();
    _mediaCache = (j.media && j.media.title) ? j.media : null;
    if (j.net) {
      if (_netPrev && j.ts > _netPrev.ts && j.net.rx >= _netPrev.rx && j.net.tx >= _netPrev.tx) {
        const dt = (j.ts - _netPrev.ts) / 1000;
        _netCache = { rx: (j.net.rx - _netPrev.rx) / dt, tx: (j.net.tx - _netPrev.tx) / dt, iface: j.net.name };
      }
      _netPrev = { rx: j.net.rx, tx: j.net.tx, ts: j.ts };
    }
  });
  const gone = (err) => {
    if (_helper === thisProc) { _helper = null; health.stats.running = false; }
    if (err && err.message) health.stats.lastError = err.message;
  };
  _helper.on('exit', () => gone());
  _helper.on('error', gone);
}

// ---------- GPU: persistent nvidia-smi loop ----------
let _gpuCache = { ts: 0, data: null };
let _gpuProc = null, _gpuLastSpawn = 0, _nvidiaFailed = false;

function startGpuLoop() {
  if (_gpuProc || _nvidiaFailed) return;
  const now = Date.now();
  if (now - _gpuLastSpawn < RESPAWN_BACKOFF_MS + 5000) return;
  _gpuLastSpawn = now;
  const query = 'utilization.gpu,memory.used,memory.total,temperature.gpu,clocks.current.graphics,power.draw,name';
  try {
    _gpuProc = spawn('nvidia-smi', ['-l', '5', `--query-gpu=${query}`, '--format=csv,noheader,nounits'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    _nvidiaFailed = true;
    health.gpu.unsupported = true;
    health.gpu.lastError = 'spawn: ' + e.message;
    return;
  }
  health.gpu.running = true;
  const rl = readline.createInterface({ input: _gpuProc.stdout });
  const thisProc = _gpuProc;
  rl.on('line', (line) => {
    const p = line.split(',').map(s => s.trim());
    if (p.length < 7) return;
    const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
    health.gpu.lastUpdate = Date.now();
    _gpuCache = {
      ts: Date.now(),
      data: {
        util: num(p[0]),
        memUsed: num(p[1]) != null ? num(p[1]) * 1024 * 1024 : null,
        memTotal: num(p[2]) != null ? num(p[2]) * 1024 * 1024 : null,
        temp: num(p[3]),
        clock: num(p[4]),
        power: num(p[5]),
        name: p[6] || 'GPU',
        source: 'nvidia-smi'
      }
    };
  });
  const gone = () => {
    if (_gpuProc === thisProc) { _gpuProc = null; health.gpu.running = false; }
    // never produced a single reading => machine has no working nvidia-smi
    if (!_gpuCache.data) { _nvidiaFailed = true; health.gpu.unsupported = true; }
  };
  _gpuProc.on('exit', gone);
  _gpuProc.on('error', gone);
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
  if (!_nvidiaFailed) return _gpuCache.data;
  if (Date.now() - _gpuCache.ts < 30000) return _gpuCache.data;
  const data = await getGpuSiFallback();
  _gpuCache = { ts: Date.now(), data };
  return data;
}

// ---------- watchdog: restart helpers that are alive but silent ----------
let _watchdogTimer = null;
function startWatchdog() {
  if (_watchdogTimer) return;
  _watchdogTimer = setInterval(() => {
    const now = Date.now();
    // stats helper: process exists but no valid line for STATS_STALE_MS
    if (_helper && health.stats.lastUpdate && now - health.stats.lastUpdate > STATS_STALE_MS) {
      health.stats.restarts++;
      health.stats.lastError = `silent ${Math.round((now - health.stats.lastUpdate) / 1000)}s — restarted`;
      try { _helper.kill(); } catch (e) {}
      _helper = null;
      health.stats.running = false;
      _netPrev = null;                       // rates must not bridge a restart
    }
    // gpu loop: same, on its slower cadence
    if (_gpuProc && health.gpu.lastUpdate && now - health.gpu.lastUpdate > GPU_STALE_MS) {
      health.gpu.restarts++;
      health.gpu.lastError = `silent ${Math.round((now - health.gpu.lastUpdate) / 1000)}s — restarted`;
      try { _gpuProc.kill(); } catch (e) {}
      _gpuProc = null;
      health.gpu.running = false;
    }
    // (re)start anything that's down — startX() enforces its own backoff
    startStatsHelper();
    startGpuLoop();
  }, WATCHDOG_TICK_MS);
}

// ---------- orphan cleanup (one-shot at startup) ----------
// If a previous dock was force-killed (taskkill /F), before-quit never ran and
// its stats-loop.ps1 kept running forever. Kill ONLY powershell processes
// whose command line points at OUR stats-loop.ps1 — never anything else.
function cleanupOrphanHelpers(done) {
  // PS single-quoted strings are literal — pass the path as-is and let
  // [regex]::Escape handle the backslashes. Only processes running OUR
  // stats-loop.ps1 are touched, and never one this Electron instance spawned
  // (parent-pid exclusion protects against any start-order race).
  const psScript =
    `$target = [regex]::Escape('${STATS_PS1}'); ` +
    `Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | ` +
    `Where-Object { $_.CommandLine -match $target -and $_.ProcessId -ne $PID -and $_.ParentProcessId -ne ${process.pid} } | ` +
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }`;
  execFile('powershell', ['-NoProfile', '-Command', psScript], { windowsHide: true, timeout: 15000 },
    (err, stdout) => {
      const pids = (stdout || '').trim();
      if (pids) console.log('telemetry: cleaned orphan stats helper(s):', pids.replace(/\s+/g, ' '));
      if (done) done();
    });
}

// ---------- battery: check once; desktops never spawn WMI again ----------
let _batt = { ts: 0, data: null };
async function getBattery() {
  if (_batt.data && _batt.data.hasBattery === false) return _batt.data;
  if (_batt.data && Date.now() - _batt.ts < 30000) return _batt.data;
  try {
    const b = si ? await si.battery() : null;
    _batt = {
      ts: Date.now(),
      data: (b && b.hasBattery) ? { pct: b.percent, charging: b.acConnected, hasBattery: true } : { hasBattery: false }
    };
  } catch (e) { _batt = { ts: Date.now(), data: { hasBattery: false } }; }
  return _batt.data;
}

// ---------- CPU model name (cached; doesn't change) ----------
let _cpuName = null;
async function getCpuName() {
  if (_cpuName != null) return _cpuName;
  _cpuName = '';
  if (si) { try { const c = await si.cpu(); _cpuName = (c.brand || `${c.manufacturer || ''} ${c.family || ''}`).trim(); } catch (e) {} }
  return _cpuName;
}

// ---------- FPS from the PresentMon helper's fps.json ----------
function getFps() {
  try {
    if (!fs.existsSync(FPS_JSON)) return { fps: null, status: 'not-running' };
    const j = JSON.parse(fs.readFileSync(FPS_JSON, 'utf8'));
    const age = Date.now() - (j.ts || 0);
    if (age > 4000) return { fps: null, status: 'stale' };
    if (j.error) return { fps: null, status: j.error };
    return { fps: j.fps, app: j.app || null, status: 'ok' };
  } catch (e) { return { fps: null, status: 'error' }; }
}

// ---------- the one snapshot every renderer poll receives ----------
async function getStats() {
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
}

function getMedia() { startStatsHelper(); return _mediaCache; }

function getHealthSnapshot() {
  const now = Date.now();
  const fps = getFps();
  let fpsAge = null;
  try {
    const j = JSON.parse(fs.readFileSync(FPS_JSON, 'utf8'));
    if (j.ts) fpsAge = now - j.ts;
  } catch (e) {}
  return {
    stats: {
      running: health.stats.running,
      ageMs: health.stats.lastUpdate ? now - health.stats.lastUpdate : null,
      restarts: health.stats.restarts,
      lastError: health.stats.lastError
    },
    gpu: {
      running: health.gpu.running,
      unsupported: health.gpu.unsupported,
      ageMs: health.gpu.lastUpdate ? now - health.gpu.lastUpdate : null,
      restarts: health.gpu.restarts,
      lastError: health.gpu.lastError
    },
    fps: { status: fps.status, ageMs: fpsAge },
    net: _netCache ? { iface: _netCache.iface } : null
  };
}

function start() {
  // Clean previous-run orphans FIRST, then start our own stream (the parent-pid
  // exclusion above makes this safe even if the watchdog spawns one earlier).
  cleanupOrphanHelpers(() => startStatsHelper());
  startGpuLoop();
  startWatchdog();
}

function stop() {
  clearInterval(_watchdogTimer); _watchdogTimer = null;
  try { if (_helper) _helper.kill(); } catch (e) {}
  try { if (_gpuProc) _gpuProc.kill(); } catch (e) {}
}

module.exports = { start, stop, getStats, getMedia, getHealthSnapshot };
