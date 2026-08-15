// photos.js — async, time-bounded recursive photo scan.
// Runs on the libuv threadpool (fs.promises) so a slow/offline network share
// can NEVER block the main process. Keeps the last good list per folder so a
// transient share outage keeps showing the previous photos.
const fs = require('fs');
const path = require('path');
const fsp = fs.promises;

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);
const MAX_PHOTOS = 5000;
const MAX_DEPTH = 8;
const SCAN_BUDGET_MS = 6000;

let _cache = { folder: null, list: [], lastScan: 0 };
let _scanning = false;

async function listPhotos(folder) {
  if (!folder) return [];
  if (_scanning) return _cache.list;
  _scanning = true;
  const out = [];
  const deadline = Date.now() + SCAN_BUDGET_MS;
  async function walk(dir, depth) {
    if (depth > MAX_DEPTH || out.length >= MAX_PHOTOS || Date.now() > deadline) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (out.length >= MAX_PHOTOS || Date.now() > deadline) break;
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
  _scanning = false;
  if (out.length) { _cache = { folder, list: out, lastScan: Date.now() }; return out; }
  return (_cache.folder === folder) ? _cache.list : [];
}

function getHealth() {
  return { count: _cache.list.length, lastScan: _cache.lastScan || null, scanning: _scanning };
}

module.exports = { listPhotos, getHealth };
