const $ = (id) => document.getElementById(id);
let config = null;

/* ============================================================
   Shared helpers
   ============================================================ */
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
const CIRC = 327; // 2*pi*52
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

/* ============================================================
   Widget factories  — each returns { node, destroy }
   ============================================================ */

function makeClock() {
  const node = el('div', 'clockcard', `
    <div class="clock">--:--</div>
    <div class="seconds">00</div>
    <div class="date">—</div>
    <div class="weather">
      <div class="w-icon">…</div>
      <div class="w-main">
        <div class="w-temp">—</div>
        <div class="w-desc">Loading weather…</div>
        <div class="w-city"></div>
      </div>
    </div>
    <div class="w-extra"></div>
    <div class="w-extra w-extra2"></div>`);
  const q = (s) => node.querySelector(s);

  function tick() {
    const now = new Date();
    q('.clock').textContent = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    q('.seconds').textContent = String(now.getSeconds()).padStart(2, '0');
    q('.date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  async function weather() {
    const w = await window.dock.getWeather();
    if (!w || w.error || !w.current) { q('.w-desc').textContent = 'Weather unavailable'; q('.w-icon').textContent = '❓'; return; }
    const c = w.current;
    const [desc, icon] = WMO[c.weather_code] || ['—', '🌡️'];
    const tu = w.unit === 'imperial' ? '°F' : '°C';
    const wu = w.unit === 'imperial' ? 'mph' : 'km/h';
    q('.w-icon').textContent = (c.is_day === 0 && c.weather_code <= 2) ? '🌙' : icon;
    q('.w-temp').textContent = Math.round(c.temperature_2m) + tu;
    q('.w-desc').textContent = desc;
    q('.w-city').textContent = w.city || '';
    q('.w-extra').innerHTML =
      `<span>Feels ${Math.round(c.apparent_temperature)}${tu}</span>` +
      `<span>💧 ${c.relative_humidity_2m}%</span>` +
      `<span>💨 ${Math.round(c.wind_speed_10m)} ${wu}</span>`;
    const d = w.daily;
    if (d) {
      const fmtT = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
      q('.w-extra2').innerHTML =
        ((d.tMax != null && d.tMin != null) ? `<span>↑ ${Math.round(d.tMax)}${tu}&nbsp;&nbsp;↓ ${Math.round(d.tMin)}${tu}</span>` : '') +
        `<span>🌅 ${fmtT(d.sunrise)}</span>` +
        `<span>🌇 ${fmtT(d.sunset)}</span>`;
    }
  }
  tick(); weather();
  const t1 = setInterval(tick, 1000);
  const t2 = setInterval(weather, 10 * 60 * 1000);
  return { node, destroy() { clearInterval(t1); clearInterval(t2); } };
}

function makePhotos() {
  const node = el('div', 'photo-stage', `
    <div class="photo-empty">
      <div class="big-icon">🖼️</div>
      <p>No photo folder set</p>
      <button class="btn pick">Choose folder…</button>
    </div>`);
  const imgA = el('img'), imgB = el('img');
  node.insertBefore(imgA, node.firstChild);
  node.insertBefore(imgB, node.firstChild);
  const empty = node.querySelector('.photo-empty');
  node.querySelector('.pick').onclick = async () => {
    const f = await window.dock.pickPhotoFolder();
    if (f) { config.photoFolder = f; load(); }
  };

  let photos = [], idx = 0, showingA = true, timer = null;
  function shuffle(a) {                       // Fisher–Yates
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }
  function order() {
    if (config && config.shuffle) shuffle(photos);
    else photos.sort();
  }
  function next() {
    if (!photos.length) return;
    if (idx >= photos.length) { idx = 0; if (config && config.shuffle) shuffle(photos); }  // reshuffle each loop
    const src = photos[idx]; idx++;
    const nx = showingA ? imgB : imgA, cur = showingA ? imgA : imgB;
    nx.onload = () => { nx.classList.add('show'); cur.classList.remove('show'); showingA = !showingA; };
    nx.src = src;
  }
  function restart() { if (timer) clearInterval(timer); timer = setInterval(next, (config && config.slideMs) || 8000); }
  async function load() {
    photos = await window.dock.listPhotos();
    if (photos.length) { empty.style.display = 'none'; order(); idx = 0; next(); restart(); }
    else { empty.style.display = 'flex'; }
  }
  // tap the photo to skip to the next one (and reset the timer)
  node.addEventListener('click', (e) => {
    if (e.target.closest('.photo-empty')) return;   // don't hijack the "Choose folder" button
    if (!photos.length) return;
    next(); restart();
  });
  load();
  const rescan = setInterval(load, 5 * 60 * 1000);
  return { node, destroy() { if (timer) clearInterval(timer); clearInterval(rescan); } };
}

function makeSystem() {
  const node = el('div', 'monitor', `
    <div class="mon-head">
      <h2 class="card-title">System</h2>
      <div class="fps" title="Game FPS (PresentMon)">
        <div class="fps-line"><span class="fps-num">—</span><span class="fps-unit">FPS</span></div>
        <div class="fps-app"></div>
      </div>
    </div>
    <div class="gauge-row">
      <div class="gauge cpu"><svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="52"/><circle class="bar" cx="60" cy="60" r="52"/></svg><div class="gauge-val"><span class="num pct">–</span><span class="unit">%</span></div><div class="gauge-label">CPU</div></div>
      <div class="gauge gpu"><svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="52"/><circle class="bar" cx="60" cy="60" r="52"/></svg><div class="gauge-val"><span class="num pct">–</span><span class="unit">%</span></div><div class="gauge-label">GPU</div></div>
      <div class="gauge mem"><svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="52"/><circle class="bar" cx="60" cy="60" r="52"/></svg><div class="gauge-val"><span class="num pct">–</span><span class="unit">%</span></div><div class="gauge-label">RAM</div></div>
      <div class="gauge batt"><svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="52"/><circle class="bar" cx="60" cy="60" r="52"/></svg><div class="gauge-val"><span class="num pct">–</span><span class="unit">%</span></div><div class="gauge-label batt-label">BATT</div></div>
    </div>
    <div class="media">
      <div class="media-info">
        <div class="media-title">Nothing playing</div>
        <div class="media-artist"></div>
      </div>
      <div class="media-ctrl">
        <button class="m-prev" title="Previous">⏮</button>
        <button class="m-play" title="Play / Pause">⏯</button>
        <button class="m-next" title="Next">⏭</button>
        <button class="cm-mute" title="Mute">🔊</button>
        <input class="cm-vol" type="range" min="0" max="100" value="50" />
      </div>
    </div>
    <div class="net">
      <div class="net-item">↓ <span class="rx">0</span></div>
      <div class="net-item">↑ <span class="tx">0</span></div>
      <div class="net-item dim memtext"></div>
    </div>`);
  const q = (s) => node.querySelector(s);
  function gauge(sel, pct) {
    const bar = node.querySelector(sel + ' .bar');
    const p = Math.max(0, Math.min(100, pct || 0));
    bar.style.strokeDashoffset = CIRC * (1 - p / 100);
    bar.style.stroke = p < 60 ? 'var(--good)' : p < 85 ? 'var(--warn)' : 'var(--bad)';
  }
  async function update() {
    const s = await window.dock.getStats();
    if (!s) return;
    if (s.cpu) { gauge('.cpu', s.cpu.pct); q('.cpu .pct').textContent = Math.round(s.cpu.pct); }
    if (s.mem) { gauge('.mem', s.mem.pct); q('.mem .pct').textContent = Math.round(s.mem.pct); q('.memtext').textContent = `${fmtBytes(s.mem.used)} / ${fmtBytes(s.mem.total)}`; }
    if (s.gpu) {
      q('.gpu').style.display = '';
      if (s.gpu.util != null) { gauge('.gpu', s.gpu.util); q('.gpu .pct').textContent = Math.round(s.gpu.util); }
      else { q('.gpu .pct').textContent = '–'; }
    } else {
      q('.gpu').style.display = 'none';
    }
    if (s.battery) {
      if (s.battery.hasBattery) { q('.batt').style.display = ''; gauge('.batt', s.battery.pct); q('.batt .pct').textContent = Math.round(s.battery.pct); q('.batt-label').textContent = s.battery.charging ? 'CHRG ⚡' : 'BATT'; }
      else { q('.batt').style.display = 'none'; }
    }
    if (s.net) { q('.rx').textContent = fmtBytes(s.net.rx) + '/s'; q('.tx').textContent = fmtBytes(s.net.tx) + '/s'; }
    // FPS
    const fnum = q('.fps-num'), fapp = q('.fps-app'), fpsBox = q('.fps');
    const f = s.fps || {};
    if (f.fps != null && f.fps > 0) {
      fnum.textContent = f.fps;
      fnum.style.color = f.fps >= 60 ? 'var(--good)' : f.fps >= 30 ? 'var(--warn)' : 'var(--bad)';
      fapp.textContent = f.app ? f.app.replace(/\.exe$/i, '') : '';
      fpsBox.style.opacity = '1';
    } else {
      fnum.textContent = (f.fps === 0) ? '0' : '—';
      fnum.style.color = 'var(--dim)';
      fapp.textContent = (f.status && f.status !== 'ok') ?
        ({ 'not-running': 'monitor off', 'stale': 'monitor off', 'needs-admin': 'needs admin', 'presentmon-exited': 'monitor off' }[f.status] || '') : 'idle';
      fpsBox.style.opacity = '0.6';
    }
  }
  update();
  const t = setInterval(update, 2000);

  // --- now-playing media strip ---
  async function updateMedia() {
    const m = await window.dock.getMedia();
    const title = q('.media-title'), artist = q('.media-artist'), playBtn = q('.m-play');
    if (m && m.title) {
      title.textContent = m.title;
      artist.textContent = m.artist || '';
      playBtn.textContent = (m.status === 4) ? '⏸' : '▶';   // 4 = Playing
      q('.media').classList.add('active');
    } else {
      title.textContent = 'Nothing playing';
      artist.textContent = '';
      playBtn.textContent = '⏯';
      q('.media').classList.remove('active');
    }
  }
  q('.m-prev').onclick = () => { window.dock.mediaKey('prev'); setTimeout(updateMedia, 600); };
  q('.m-next').onclick = () => { window.dock.mediaKey('next'); setTimeout(updateMedia, 600); };
  q('.m-play').onclick = () => { window.dock.mediaKey('playpause'); setTimeout(updateMedia, 400); };
  updateMedia();
  const tm = setInterval(updateMedia, 4000);

  // --- system volume (moved here from the Clock tile) ---
  const mute = q('.cm-mute'), vol = q('.cm-vol');
  function paintVol() {
    const p = vol.value;
    vol.style.background = `linear-gradient(to right, var(--accent) ${p}%, rgba(255,255,255,0.15) ${p}%)`;
  }
  mute.onclick = async () => { const muted = await window.dock.toggleMute(); mute.textContent = muted ? '🔇' : '🔊'; };
  vol.addEventListener('input', paintVol);
  vol.addEventListener('change', async () => { const v = await window.dock.setVolume(vol.value); if (v != null) { vol.value = v; paintVol(); } });
  (async () => { const v = await window.dock.getVolume(); if (v != null) vol.value = v; paintVol(); })();

  return { node, destroy() { clearInterval(t); clearInterval(tm); } };
}

function makeBrowser(slotIndex) {
  const node = el('div', 'browser', `
    <div class="url-bar">
      <button class="back" title="Back">‹</button>
      <button class="fwd" title="Forward">›</button>
      <button class="reload" title="Reload">⟳</button>
      <input class="url" type="text" placeholder="Enter URL or search…" />
      <button class="go" title="Go">→</button>
      <div class="quicklinks">
        <button data-url="https://www.google.com" title="Google">🔍</button>
        <button data-url="https://www.youtube.com" title="YouTube">▶</button>
        <button data-url="https://web.whatsapp.com" title="WhatsApp">💬</button>
      </div>
    </div>`);
  const wv = document.createElement('webview');
  const startUrl = (config.browserUrls && config.browserUrls[slotIndex]) || 'https://www.google.com';
  wv.setAttribute('src', startUrl);
  wv.setAttribute('allowpopups', 'true');
  node.appendChild(wv);

  const input = node.querySelector('.url');
  input.value = startUrl;

  function normalize(v) {
    v = v.trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    if (/^[\w-]+(\.[\w-]+)+/.test(v)) return 'https://' + v;       // looks like a domain
    return 'https://www.google.com/search?q=' + encodeURIComponent(v);
  }
  function navigate(v) { const u = normalize(v); if (u) wv.loadURL(u); }

  node.querySelector('.go').onclick = () => navigate(input.value);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(input.value); });
  node.querySelector('.back').onclick = () => { if (wv.canGoBack()) wv.goBack(); };
  node.querySelector('.fwd').onclick = () => { if (wv.canGoForward()) wv.goForward(); };
  node.querySelector('.reload').onclick = () => wv.reload();
  node.querySelectorAll('.quicklinks button').forEach(b => b.onclick = () => navigate(b.dataset.url));

  wv.addEventListener('did-navigate', (e) => {
    input.value = e.url;
    config.browserUrls[slotIndex] = e.url;
    window.dock.setConfig({ browserUrls: config.browserUrls });
  });
  wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) input.value = e.url; });

  return { node, destroy() { /* webview removed with node */ } };
}

function makeLauncher() {
  const node = el('div', 'launcher', `<div class="launch-grid"></div>`);
  const grid = node.querySelector('.launch-grid');
  async function load() {
    const apps = await window.dock.getLauncher();
    grid.innerHTML = '';
    if (!apps || !apps.length) {
      grid.innerHTML = '<div class="launch-empty">No apps configured.<br><span>Run resolve-apps.ps1 to populate.</span></div>';
      return;
    }
    apps.forEach(a => {
      const tile = el('button', 'launch-tile');
      tile.innerHTML =
        (a.icon ? `<img src="${a.icon}" alt="">` : `<div class="launch-fallback">${(a.name || '?')[0]}</div>`) +
        `<span>${a.name || ''}</span>`;
      tile.onclick = () => window.dock.launchApp(a.target);
      grid.appendChild(tile);
    });
  }
  load();
  return { node, destroy() {} };
}

/* ============================================================
   Slot registry + manager
   ============================================================ */
const WIDGETS = {
  browser:  { icon: '🌐', label: 'Browser',  make: (i) => makeBrowser(i) },
  apps:     { icon: '▦',  label: 'Apps',     make: () => makeLauncher() },
  photos:   { icon: '🖼️', label: 'Photos',   make: () => makePhotos() },
  clock:    { icon: '🕐', label: 'Clock',    make: () => makeClock() },
  system:   { icon: '📊', label: 'System',   make: () => makeSystem() }
};
const ORDER = ['browser', 'apps', 'photos', 'clock', 'system'];

const slotControllers = [null, null, null];

function setSlot(index, key) {
  const slotEl = document.querySelectorAll('.slot')[index];
  const body = slotEl.querySelector('.slot-body');
  // teardown old
  if (slotControllers[index]) { try { slotControllers[index].destroy(); } catch (e) {} }
  body.innerHTML = '';
  // mount new
  const ctrl = WIDGETS[key].make(index);
  body.appendChild(ctrl.node);
  slotControllers[index] = ctrl;
  // update switcher active state
  slotEl.querySelectorAll('.swbtn').forEach(b => b.classList.toggle('active', b.dataset.key === key));
  // persist
  config.slots[index] = key;
  window.dock.setConfig({ slots: config.slots });
}

function buildSlots() {
  const dock = $('dock');
  dock.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const slot = el('div', 'slot');
    const switcher = el('div', 'slot-switcher');
    ORDER.forEach(key => {
      const b = el('button', 'swbtn');
      b.innerHTML = `<span class="swicon">${WIDGETS[key].icon}</span><span class="swlabel">${WIDGETS[key].label}</span>`;
      b.title = WIDGETS[key].label;
      b.dataset.key = key;
      b.onclick = () => setSlot(i, key);
      switcher.appendChild(b);
    });
    const body = el('div', 'slot-body');
    slot.appendChild(switcher);
    slot.appendChild(body);
    dock.appendChild(slot);
  }
  // mount initial widgets
  for (let i = 0; i < 3; i++) {
    const key = (config.slots && config.slots[i]) || ORDER[i] || 'clock';
    setSlot(i, key);
  }
}

/* ============================================================
   Settings
   ============================================================ */
function openSettings() {
  $('folderPath').textContent = config.photoFolder || '—';
  $('shuffleChk').checked = config.shuffle !== false;
  $('slideSel').value = String(config.slideMs);
  $('unitSel').value = config.weather.unit;
  $('autoLoc').checked = config.weather.auto;
  $('latIn').value = config.weather.lat ?? '';
  $('lonIn').value = config.weather.lon ?? '';
  $('settings').classList.remove('hidden');
}
function closeSettings() { $('settings').classList.add('hidden'); }
async function saveSettings() {
  const patch = {
    shuffle: $('shuffleChk').checked,
    slideMs: Number($('slideSel').value),
    weather: {
      unit: $('unitSel').value,
      auto: $('autoLoc').checked,
      lat: $('latIn').value === '' ? null : Number($('latIn').value),
      lon: $('lonIn').value === '' ? null : Number($('lonIn').value)
    }
  };
  config = await window.dock.setConfig(patch);
  closeSettings();
  buildSlots(); // re-mount so clock/photo widgets pick up new settings
}
async function pickFolder() {
  const folder = await window.dock.pickPhotoFolder();
  if (folder) { config.photoFolder = folder; $('folderPath').textContent = folder; buildSlots(); }
}

/* ============================================================
   Init
   ============================================================ */
async function init() {
  config = await window.dock.getConfig();
  if (!Array.isArray(config.slots) || config.slots.length !== 3) config.slots = ['browser', 'photos', 'clock'];
  if (!Array.isArray(config.browserUrls)) config.browserUrls = ['https://www.google.com', 'https://www.google.com', 'https://www.google.com'];

  buildSlots();

  $('settingsBtn').onclick = openSettings;
  $('minBtn').onclick = () => window.dock.minimize();
  $('closeSettings').onclick = closeSettings;
  $('saveSettings').onclick = saveSettings;
  $('pickFolder2').onclick = pickFolder;
  window.dock.onOpenSettings(openSettings);
}
init();
