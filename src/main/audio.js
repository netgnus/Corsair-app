// audio.js — user-triggered one-shot PowerShell actions (volume, media keys).
// These are the ONLY sanctioned per-action spawns: they run when the user
// taps a button, never on a timer.
const { execFile } = require('child_process');
const path = require('path');

const PROJECT_DIR = path.join(__dirname, '..', '..');

function runVolume(args) {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(PROJECT_DIR, 'volume.ps1'), ...args],
      { timeout: 4000, windowsHide: true }, (err, stdout) => resolve((stdout || '').trim()));
  });
}

async function getVolume() {
  const v = parseInt(await runVolume(['get']), 10);
  return isNaN(v) ? null : v;
}

async function setVolume(pct) {
  pct = Math.max(0, Math.min(100, parseInt(pct, 10) || 0));
  const v = parseInt(await runVolume(['set', String(pct)]), 10);
  return isNaN(v) ? pct : v;
}

async function toggleMute() {
  return (await runVolume(['mute'])) === 'muted';
}

const MEDIA_KEYS = new Set(['next', 'prev', 'playpause']);
function mediaKey(key) {
  const k = MEDIA_KEYS.has(key) ? key : 'playpause';
  execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(PROJECT_DIR, 'media-key.ps1'), k],
    { windowsHide: true }, () => {});
}

module.exports = { getVolume, setVolume, toggleMute, mediaKey };
