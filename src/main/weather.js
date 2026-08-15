// weather.js — Open-Meteo current conditions + daily, cached in main.
//
// v1.2.0: one main-side cache (10 min TTL) so any number of Clock widgets —
// even Clock/Clock/Clock — produce at most one upstream fetch per interval.
const configMod = require('./config');

const TTL_MS = 10 * 60 * 1000;
let _cache = { ts: 0, key: '', data: null };
let _inflight = null;

function cacheKey(w) { return [w.auto, w.lat, w.lon, w.unit].join('|'); }

async function fetchWeather() {
  const cfg = configMod.get();
  let { lat, lon, city, auto, unit } = cfg.weather;
  if (auto || lat == null || lon == null) {
    const geo = await fetch('http://ip-api.com/json/?fields=lat,lon,city').then(r => r.json());
    if (geo && geo.lat != null) { lat = geo.lat; lon = geo.lon; city = geo.city || city; }
  }
  if (lat == null || lon == null) return { error: 'no-location' };
  const tempUnit = unit === 'imperial' ? 'fahrenheit' : 'celsius';
  const windUnit = unit === 'imperial' ? 'mph' : 'kmh';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day` +
    `&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min` +
    `&temperature_unit=${tempUnit}&wind_speed_unit=${windUnit}&timezone=auto&forecast_days=1`;
  const w = await fetch(url).then(r => r.json());
  let daily = null;
  if (w.daily) {
    daily = {
      sunrise: w.daily.sunrise && w.daily.sunrise[0],
      sunset: w.daily.sunset && w.daily.sunset[0],
      tMax: w.daily.temperature_2m_max && w.daily.temperature_2m_max[0],
      tMin: w.daily.temperature_2m_min && w.daily.temperature_2m_min[0]
    };
  }
  return { city, unit, current: w.current || null, daily };
}

async function getWeather() {
  const key = cacheKey(configMod.get().weather);
  const fresh = _cache.data && _cache.key === key && (Date.now() - _cache.ts < TTL_MS);
  if (fresh) return _cache.data;
  if (_inflight) return _inflight;             // coalesce concurrent requests
  _inflight = (async () => {
    try {
      const data = await fetchWeather();
      if (!data.error) _cache = { ts: Date.now(), key, data };
      return data;
    } catch (e) {
      return _cache.data || { error: e.message };   // stale-if-error
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

function invalidate() { _cache = { ts: 0, key: '', data: null }; }
function cacheAgeMs() { return _cache.ts ? Date.now() - _cache.ts : null; }

module.exports = { getWeather, invalidate, cacheAgeMs };
