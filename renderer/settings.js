// settings.js — settings overlay + Dock Health diagnostics.
// The health readout only polls while the overlay is open.
let _healthUnsub = null;

function fmtAge(ms) {
  if (ms == null) return '—';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  if (ms < 3600000) return Math.round(ms / 60000) + 'm';
  return (ms / 3600000).toFixed(1) + 'h';
}
function fmtUptime(sec) {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${sec % 60}s`;
}

function renderHealth(h) {
  const box = $('healthBody');
  if (!box || !h) return;
  const dot = (ok, warnCond) => ok ? (warnCond ? '<span class="h-dot warn">●</span>' : '<span class="h-dot ok">●</span>')
                                   : '<span class="h-dot bad">●</span>';
  const rows = [];
  rows.push(['Version', `v${h.version || '?'} · up ${fmtUptime(h.uptimeSec)}`, '']);
  rows.push(['Stats helper',
    `${dot(h.stats.running, h.stats.ageMs > 8000)} ${h.stats.running ? 'OK' : 'down'}`,
    fmtAge(h.stats.ageMs)]);
  if (h.gpu.unsupported) rows.push(['NVIDIA', '<span class="h-dot warn">●</span> unsupported', '—']);
  else rows.push(['NVIDIA',
    `${dot(h.gpu.running, h.gpu.ageMs > 12000)} ${h.gpu.running ? 'OK' : 'down'}`,
    fmtAge(h.gpu.ageMs)]);
  const fpsOk = h.fps.status === 'ok';
  rows.push(['PresentMon',
    fpsOk ? '<span class="h-dot ok">●</span> OK' : `<span class="h-dot warn">●</span> ${h.fps.status || 'off'}`,
    fmtAge(h.fps.ageMs)]);
  rows.push(['Weather', h.weather.cacheAgeMs != null ? '<span class="h-dot ok">●</span> OK' : '<span class="h-dot warn">●</span> no cache',
    fmtAge(h.weather.cacheAgeMs)]);
  rows.push(['Photos',
    h.photos.scanning ? '<span class="h-dot warn">●</span> scanning' : `<span class="h-dot ok">●</span> ${h.photos.count.toLocaleString()}`,
    fmtAge(h.photos.lastScan ? Date.now() - h.photos.lastScan : null)]);
  rows.push(['Network', h.net ? `<span class="h-dot ok">●</span> ${h.net.iface}` : '<span class="h-dot warn">●</span> —', '']);
  rows.push(['Restarts', `stats ${h.stats.restarts} · gpu ${h.gpu.restarts}`, '']);
  if (h.stats.lastError || h.gpu.lastError) {
    rows.push(['Last error', `<span class="h-err">${h.stats.lastError || h.gpu.lastError}</span>`, '']);
  }
  box.innerHTML = rows.map(([k, v, age]) =>
    `<div class="h-row"><span class="h-key">${k}</span><span class="h-val">${v}</span><span class="h-age">${age}</span></div>`
  ).join('');
}

function openSettings() {
  $('folderPath').textContent = dockConfig.photoFolder || '—';
  $('shuffleChk').checked = dockConfig.shuffle !== false;
  $('slideSel').value = String(dockConfig.slideMs);
  $('unitSel').value = dockConfig.weather.unit;
  $('autoLoc').checked = dockConfig.weather.auto;
  $('latIn').value = dockConfig.weather.lat ?? '';
  $('lonIn').value = dockConfig.weather.lon ?? '';
  $('settings').classList.remove('hidden');
  if (!_healthUnsub) _healthUnsub = DockStore.subscribe('health', renderHealth);
}

function closeSettings() {
  $('settings').classList.add('hidden');
  if (_healthUnsub) { _healthUnsub(); _healthUnsub = null; }
}

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
  dockConfig = await window.dock.setConfig(patch);
  closeSettings();
  buildSlots();                     // re-mount so widgets pick up new settings
  DockStore.refresh('weather');
}

async function pickFolder() {
  const folder = await window.dock.pickPhotoFolder();
  if (folder) { dockConfig.photoFolder = folder; $('folderPath').textContent = folder; buildSlots(); }
}
