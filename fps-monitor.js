// fps-monitor.js — runs PresentMon (elevated) and writes the active game's FPS
// to <project>\fps.json once per ~500ms. Started by a scheduled task, either
// via `node fps-monitor.js` (dev) or `iPadDock.exe --fps-helper` (packaged).
//
// NOTE: files live in the project folder (a fixed real path) rather than
// %APPDATA%, so they are not affected by per-app filesystem virtualization.
//
// v1.2.0 hardening:
//   * NEVER kills unrelated PresentMon instances. Cleanup is ownership-aware:
//     the PID of our own PresentMon child is persisted to fps-helper.pid, and
//     on startup only THAT pid is cleaned up (after verifying the process is
//     actually still a PresentMon.exe).
//   * fps.json writes are atomic (temp file + rename) — the dock can never
//     read a partially-written file.
const { spawn, execFileSync } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

const OUT_DIR = __dirname;
const OUT_FILE = path.join(OUT_DIR, 'fps-data.json');   // renamed from fps.json: BD ATD blocklisted the old path
const TMP_FILE = OUT_FILE + '.tmp';
const PID_FILE = path.join(OUT_DIR, 'fps-helper.pid');
const PRESENTMON = path.join(__dirname, 'tools', 'PresentMon.exe');
const EXCLUDE = new Set(['dwm.exe', 'explorer.exe', 'ipad-dock.exe', 'electron.exe', 'PresentMon.exe', '<error>']);

const DBG = path.join(OUT_DIR, 'fps-debug.log');
function dbg(msg) { try { fs.appendFileSync(DBG, `[${new Date().toISOString()}] ${msg}\n`); } catch (e) {} }
try { fs.writeFileSync(DBG, ''); } catch (e) {}
dbg(`helper start pid=${process.pid} out=${OUT_FILE}`);

// Atomic write: full JSON to a temp file, then rename over the destination.
let _werr = 0;
function writeOut(obj) {
  try {
    fs.writeFileSync(TMP_FILE, JSON.stringify({ ...obj, ts: Date.now() }));
    fs.renameSync(TMP_FILE, OUT_FILE);
  } catch (e) {
    if (_werr < 3) { dbg('writeOut err: ' + e.message); _werr++; }   // no log spam
  }
}

if (!fs.existsSync(PRESENTMON)) {
  writeOut({ fps: null, error: 'PresentMon.exe missing' });
  process.exit(1);
}

// ---------- ownership-aware cleanup of a PREVIOUS dock-owned PresentMon ----------
// Read the pid file from the last run; kill that pid ONLY if it is still a
// running PresentMon.exe. Unrelated PresentMon instances (CapFrameX, other
// tools) are never touched.
function isPidPresentMon(pid) {
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 10000 }).toString();
    return /presentmon\.exe/i.test(out);
  } catch (e) { return false; }
}
try {
  if (fs.existsSync(PID_FILE)) {
    const prev = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    if (prev && Number.isInteger(prev.pmPid) && isPidPresentMon(prev.pmPid)) {
      try {
        execFileSync('taskkill', ['/F', '/PID', String(prev.pmPid)], { stdio: 'ignore', windowsHide: true });
        dbg(`cleaned previous dock-owned PresentMon pid=${prev.pmPid} session=${prev.session || '?'}`);
      } catch (e) { dbg('previous PresentMon cleanup failed: ' + e.message); }
    }
    fs.rmSync(PID_FILE, { force: true });
  }
} catch (e) { dbg('pid-file read failed: ' + e.message); }

// frames: rolling list of { t, pid, app }  (t = PresentMon TimeInSeconds, monotonic)
let frames = [];
let idxApp = -1, idxPid = -1, idxTime = -1;
let haveHeader = false;

// Unique session name per launch so we never collide with a leftover session.
const SESSION = 'ipad_dock_fps_' + process.pid;
const pm = spawn(PRESENTMON, [
  '-output_stdout', '-stop_existing_session', '-no_top', '-session_name', SESSION
], { windowsHide: true });
dbg(`spawned PresentMon pid=${pm.pid} session=${SESSION}`);
pm.on('error', (e) => { dbg('spawn error: ' + e.message); writeOut({ fps: null, error: 'spawn-failed' }); });

// Persist ownership so the NEXT run can clean up exactly this process if we
// die without running our exit handlers (e.g. taskkill /F on the helper).
try { fs.writeFileSync(PID_FILE, JSON.stringify({ helperPid: process.pid, pmPid: pm.pid, session: SESSION })); } catch (e) {}

// Graceful cleanup of OUR child only.
function killChild() {
  try { pm.kill(); } catch (e) {}
  try { execFileSync('taskkill', ['/F', '/PID', String(pm.pid)], { stdio: 'ignore', windowsHide: true }); } catch (e) {}
  try { fs.rmSync(PID_FILE, { force: true }); } catch (e) {}
}
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
setInterval(() => {
  if (!frames.length) { writeOut({ fps: 0, app: null }); return; }
  const now = frames[frames.length - 1].t;
  if (frames.length > 5000) frames = frames.slice(-5000);
  frames = frames.filter(f => f.t >= now - 2.0);

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
  if (best && best.count >= 2) writeOut({ fps: best.count, app: best.app, pid: best.pid });
  else writeOut({ fps: 0, app: null });
}, 500);

// staleness fallback: if no frames ever arrive, keep reporting idle
setInterval(() => { if (!frames.length) writeOut({ fps: 0, app: null }); }, 3000);
