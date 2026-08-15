// widgets/system.js — CPU/GPU/RAM/battery gauges, FPS, network, media strip.
// All telemetry arrives via the shared store: three System tiles side by side
// still cause exactly ONE stats poll cycle. Store handles hide/show pausing.
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
      <div class="gauge cpu"><svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="52"/><circle class="bar" cx="60" cy="60" r="52"/></svg><div class="gauge-val"><span class="num pct">–</span><span class="unit">%</span></div><div class="gauge-name"></div><div class="gauge-label">CPU</div></div>
      <div class="gauge gpu"><svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="52"/><circle class="bar" cx="60" cy="60" r="52"/></svg><div class="gauge-val"><span class="num pct">–</span><span class="unit">%</span></div><div class="gauge-name"></div><div class="gauge-label">GPU</div></div>
      <div class="gauge mem"><svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="52"/><circle class="bar" cx="60" cy="60" r="52"/></svg><div class="gauge-val"><span class="num pct">–</span><span class="unit">%</span></div><div class="gauge-name"></div><div class="gauge-label">RAM</div></div>
      <div class="gauge batt"><svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="52"/><circle class="bar" cx="60" cy="60" r="52"/></svg><div class="gauge-val"><span class="num pct">–</span><span class="unit">%</span></div><div class="gauge-label batt-label">BATT</div></div>
    </div>
    <div class="media">
      <div class="media-info">
        <div class="media-title">Nothing playing</div>
        <div class="media-artist"></div>
      </div>
      <div class="media-ctrl">
        <button class="m-play" title="Play / Pause">⏯</button>
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

  // Rolling average over the last 3 samples (~6s) so gauges read steady.
  const hist = {};
  function smooth(key, v) {
    if (v == null || isNaN(v)) return v;
    const a = hist[key] || (hist[key] = []);
    a.push(v);
    if (a.length > 3) a.shift();
    return a.reduce((s, x) => s + x, 0) / a.length;
  }

  function renderStats(s) {
    if (!s) return;
    if (s.cpu) {
      const cp = smooth('cpu', s.cpu.pct);
      gauge('.cpu', cp); q('.cpu .pct').textContent = Math.round(cp);
      if (s.cpu.name) q('.cpu .gauge-name').textContent = shortChip(s.cpu.name);
    }
    if (s.mem) {
      gauge('.mem', s.mem.pct); q('.mem .pct').textContent = Math.round(s.mem.pct);
      const capGB = Math.round((s.mem.total / 1073741824) / 2) * 2;
      q('.mem .gauge-name').textContent = capGB + ' GB';
      q('.memtext').textContent = `${fmtBytes(s.mem.used)} / ${capGB} GB`;
    }
    if (s.gpu) {
      q('.gpu').style.display = '';
      if (s.gpu.util != null) { const gp = smooth('gpu', s.gpu.util); gauge('.gpu', gp); q('.gpu .pct').textContent = Math.round(gp); }
      else { q('.gpu .pct').textContent = '–'; }
      if (s.gpu.name) q('.gpu .gauge-name').textContent = shortChip(s.gpu.name);
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

  function renderMedia(m) {
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

  const unsubStats = DockStore.subscribe('stats', renderStats);
  const unsubMedia = DockStore.subscribe('media', renderMedia);

  q('.m-play').onclick = () => { window.dock.mediaKey('playpause'); setTimeout(() => DockStore.refresh('media'), 400); };

  // volume controls (user-triggered one-shots)
  const mute = q('.cm-mute'), vol = q('.cm-vol');
  function paintVol() {
    const p = vol.value;
    vol.style.background = `linear-gradient(to right, var(--accent) ${p}%, rgba(255,255,255,0.15) ${p}%)`;
  }
  mute.onclick = async () => { const muted = await window.dock.toggleMute(); mute.textContent = muted ? '🔇' : '🔊'; };
  vol.addEventListener('input', paintVol);
  vol.addEventListener('change', async () => { const v = await window.dock.setVolume(vol.value); if (v != null) { vol.value = v; paintVol(); } });
  (async () => { const v = await window.dock.getVolume(); if (v != null) vol.value = v; paintVol(); })();

  return {
    node,
    destroy() { unsubStats(); unsubMedia(); }
    // no pause/resume needed: the store stops polling while hidden
  };
}
