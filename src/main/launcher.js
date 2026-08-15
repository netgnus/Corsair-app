// launcher.js — ID-based app launcher.
//
// v1.2.0 security change: the renderer NEVER supplies a filesystem path.
// Main loads apps.json, assigns each entry an opaque ID, and hands the
// renderer only {id, name, icon}. A tap sends the ID back; main resolves it
// against its own trusted table and only then calls shell.openPath().
const path = require('path');
const fs = require('fs');

// shell is unavailable under plain `node --test` — launchApp then only
// resolves (never opens), which is exactly what the security tests need.
let shell = null;
try { shell = require('electron').shell || null; } catch (e) {}

const PROJECT_DIR = path.join(__dirname, '..', '..');
const APPS_JSON = process.env.IPAD_DOCK_APPS_JSON || path.join(PROJECT_DIR, 'apps.json');

let _byId = new Map();       // id -> absolute target path (trusted, main-only)
let _loadedMtime = 0;

function loadApps() {
  try {
    if (!fs.existsSync(APPS_JSON)) { _byId = new Map(); return []; }
    const mtime = fs.statSync(APPS_JSON).mtimeMs;
    const raw = JSON.parse(fs.readFileSync(APPS_JSON, 'utf8').replace(/^﻿/, ''));
    const arr = Array.isArray(raw) ? raw : [];
    _byId = new Map();
    _loadedMtime = mtime;
    return arr.map((a, i) => {
      if (!a || typeof a.target !== 'string' || !a.target) return null;
      const id = 'app-' + i;
      _byId.set(id, a.target);
      return {
        id,
        name: typeof a.name === 'string' ? a.name : `App ${i + 1}`,
        icon: (typeof a.icon === 'string' && a.icon)
          ? 'file:///' + path.join(PROJECT_DIR, a.icon).replace(/\\/g, '/')
          : null
      };
    }).filter(Boolean);
  } catch (e) {
    _byId = new Map();
    return [];
  }
}

function getLauncher() { return loadApps(); }

// Returns true only when the ID resolved against the trusted table.
function launchApp(id) {
  if (typeof id !== 'string') return false;
  // Re-read if apps.json changed since the IDs were handed out.
  try { if (fs.statSync(APPS_JSON).mtimeMs !== _loadedMtime) loadApps(); } catch (e) {}
  const target = _byId.get(id);
  if (!target) return false;                                 // unknown ID: ignore
  if (shell) shell.openPath(target).then(err => { if (err) console.error('launcher: failed:', err); });
  return true;
}

module.exports = { getLauncher, launchApp };
