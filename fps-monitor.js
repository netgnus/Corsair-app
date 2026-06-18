// fps-monitor.js — runs PresentMon (elevated) and writes the active game's FPS
// to <project>\fps.json once per ~500ms. Started by a scheduled task.
// NOTE: the file lives in the project folder (a fixed real path) rather than %APPDATA%,
// so it is not affected by per-app filesystem virtualization / known-folder redirection.
const { spawn, execFileSync } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

const OUT_DIR = __dirname;
const OUT_FILE = path.join(OUT_DIR, 'fps.json');
const PRESENTMON = path.join(__dirname, 'tools', 'PresentMon.exe');
const EXCLUDE = new Set(['dwm.exe', 'explorer.exe', 'ipad-dock.exe', 'electron.exe', 'PresentMon.exe', '<error>']);

const DBG = path.join(OUT_DIR, 'fps-debug.log');
function dbg(msg) { try { fs.appendFileSync(DBG, `[${new Date().toISOString()}] ${msg}\n`); } catch (e) {} }
try { fs.writeFileSync(DBG, ''); } catch (e) {}
dbg(`helper start pid=${process.pid} cwd=${process.cwd()} dirname=${__dirname} out=${OUT_FILE}`);
dbg(`presentmon=${PRESENTMON} exists=${fs.existsSync(PRESENTMON)}`);

let _w = 0;
function writeOut(obj) {
  try {
    fs.writeFileSync(OUT_FILE, JSON.stringify({ ...obj, ts: Date.now() }));
    if (_w < 2) { dbg('writeOut ok -> ' + OUT_FILE); _w++; }
  } catch (e) { dbg('writeOut err: ' + e.message + ' path=' + OUT_FILE); }
}

if (!fs.existsSync(PRESENTMON)) {
  writeOut({ fps: null, error: 'PresentMon.exe missing' });
  process.exit(1);
}

// frames: rolling list of { t, pid, app }  (t = PresentMon TimeInSeconds, monotonic)
let frames = [];
let idxApp = -1, idxPid = -1, idxTime = -1;
let haveHeader = false;

// Kill any leftover/orphaned PresentMon instances (releases stale ETW sessions)
try { execFileSync('taskkill', ['/F', '/IM', 'PresentMon.exe'], { stdio: 'ignore' }); dbg('killed leftover PresentMon'); }
catch (e) { dbg('no leftover PresentMon to kill'); }

// Unique session name per launch so we never collide with a leftover session
const SESSION = 'ipad_dock_fps_' + process.pid;
const pm = spawn(PRESENTMON, [
  '-output_stdout', '-no_top', '-session_name', SESSION
], { windowsHide: true });
dbg('spawned PresentMon session=' + SESSION);
pm.on('error', (e) => { dbg('spawn error: ' + e.message); writeOut({ fps: null, error: 'spawn-failed' }); });

function killChild() { try { pm.kill(); } catch (e) {} try { execFileSync('taskkill', ['/F', '/PID', String(pm.pid)], { stdio: 'ignore' }); } catch (e) {} }
process.on('SIGTERM', () => { dbg('SIGTERM'); killChild(); process.exit(0); });
process.on('SIGINT', () => { killChild(); process.exit(0); });
process.on('exit', killChild);

let lineCount = 0;
const rl = readline.createInterface({ input: pm.stdout });

rl.on('line', (line) => {
  if (!line) return;
  if (lineCount < 3) dbg('stdout line: ' + line.slice(0, 120));
  lineCount++;
  if (!haveHeader) {
    if (line.startsWith('Application,') || line.includes('ProcessID')) {
      const cols = line.split(',');
      idxApp = cols.indexOf('Application');
      idxPid = cols.indexOf('ProcessID');
      idxTime = cols.indexOf('TimeInSeconds');
      dbg(`header parsed app=${idxApp} pid=${idxPid} time=${idxTime}`);
      if (idxApp >= 0 && idxPid >= 0 && idxTime >= 0) { haveHeader = true; }
    }
    return;
  }
  const c = line.split(',');
  const app = c[idxApp];
  const pid = c[idxPid];
  const t = parseFloat(c[idxTime]);
  if (!app || isNaN(t)) return;
  frames.push({ t, pid, app });
});

pm.stderr.on('data', (d) => {
  const s = d.toString().trim();
  dbg('stderr: ' + s.slice(0, 200));
  if (/Failed|denied|elevat|administrat|session/i.test(s) && /fail|denied|unable|require/i.test(s)) {
    writeOut({ fps: null, error: 'needs-admin' });
  }
});

pm.on('exit', (code) => {
  dbg('PresentMon exit code=' + code + ' linesSeen=' + lineCount);
  writeOut({ fps: null, error: 'presentmon-exited', code });
  process.exit(code || 0);
});

// compute + write every 500ms
let _tick = 0;
setInterval(() => {
  if (_tick < 3) dbg('interval tick ' + _tick + ' frames=' + frames.length);
  _tick++;
  if (!frames.length) { writeOut({ fps: 0, app: null }); return; }
  const now = frames[frames.length - 1].t;
  // prune anything older than 2s
  const cutoff = now - 2.0;
  if (frames.length > 5000) frames = frames.slice(-5000);
  frames = frames.filter(f => f.t >= cutoff);

  // count presents in the last 1.0s per process
  const winStart = now - 1.0;
  const byPid = new Map();
  for (const f of frames) {
    if (f.t < winStart) continue;
    if (EXCLUDE.has(f.app)) continue;
    const e = byPid.get(f.pid) || { count: 0, app: f.app };
    e.count++; byPid.set(f.pid, e);
  }
  let best = null;
  for (const [pid, e] of byPid) {
    if (!best || e.count > best.count) best = { pid, app: e.app, count: e.count };
  }
  if (best && best.count >= 2) {
    writeOut({ fps: best.count, app: best.app, pid: best.pid });
  } else {
    writeOut({ fps: 0, app: null });   // nothing actively presenting (idle desktop)
  }
}, 500);

// staleness watchdog: if no new frames arrive for 3s, report idle
setInterval(() => {
  if (!frames.length) writeOut({ fps: 0, app: null });
}, 3000);
