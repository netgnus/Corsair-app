// util.js — tiny shared helpers for all renderer scripts (loaded first).
const $ = (id) => document.getElementById(id);

const WMO = {
  0: ['Clear sky', '☀️'], 1: ['Mainly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Rime fog', '🌫️'],
  51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Dense drizzle', '🌧️'],
  56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'],
  61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
  66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
  71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'],
  80: ['Showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Violent showers', '⛈️'],
  85: ['Snow showers', '🌨️'], 86: ['Snow showers', '❄️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm + hail', '⛈️'], 99: ['Thunderstorm + hail', '⛈️']
};

const CIRC = 327; // 2*pi*52 — gauge circumference

function fmtBytes(n) {
  if (n == null) return '0';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

// Trim a CPU/GPU model string down to the recognizable bit, e.g.
// "NVIDIA GeForce RTX 5070 Ti" -> "RTX 5070 Ti"
function shortChip(n) {
  if (!n) return '';
  return n
    .replace(/\bNVIDIA\b|\bGeForce\b|\bAMD\b|\bRadeon\b|\bIntel\b|\bCorporation\b/gi, '')
    .replace(/\(R\)|\(TM\)|®|™/gi, '')
    .replace(/\bCPU\b|\bProcessor\b|\bGraphics\b|\d+-Core|w\/.*$|@.*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
