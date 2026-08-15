// widgets/clock.js — clock + weather tile.
// Weather comes from the shared store (one fetch regardless of clock count);
// the 1-second tick pauses while the dock is hidden.
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
    q('.clock').textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    q('.seconds').textContent = String(now.getSeconds()).padStart(2, '0');
    q('.date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function renderWeather(w) {
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

  tick();
  let tickTimer = setInterval(tick, 1000);
  const unsubWeather = DockStore.subscribe('weather', renderWeather);

  return {
    node,
    pause() { clearInterval(tickTimer); tickTimer = null; },
    resume() { if (!tickTimer) { tick(); tickTimer = setInterval(tick, 1000); } },
    destroy() { clearInterval(tickTimer); unsubWeather(); }
  };
}
