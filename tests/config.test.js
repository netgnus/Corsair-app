// tests/config.test.js — migration + validation of the security-sensitive
// pure config logic. Runs under plain `node --test` (no Electron needed).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { migrate, sanitize, DEFAULT_CONFIG, CONFIG_VERSION } = require('../src/main/config.js');

// A representative real v1.1.0 config (no configVersion field).
const V1_CONFIG = {
  barHeight: 240,
  displayIndex: 0,
  bounds: { x: 1286, y: 2123, width: 1057, height: 363 },
  photoFolder: 'Y:\\Pictures',
  slideMs: 8000,
  shuffle: true,
  slots: ['clock', 'photos', 'system'],
  browserUrls: ['http://192.168.1.79:8123/aa-mobile/0', 'https://www.google.com', 'https://www.google.com'],
  weather: { auto: true, lat: null, lon: null, city: '', unit: 'metric' }
};

test('v1.1 config migrates to schema v2 keeping legitimate values', () => {
  const out = sanitize(migrate(JSON.parse(JSON.stringify(V1_CONFIG))));
  assert.equal(out.configVersion, CONFIG_VERSION);
  assert.equal(out.barHeight, 240);
  assert.equal(out.displayIndex, 0);
  assert.deepEqual(out.bounds, { x: 1286, y: 2123, width: 1057, height: 363 });
  assert.equal(out.photoFolder, 'Y:\\Pictures');
  assert.equal(out.slideMs, 8000);
  assert.equal(out.shuffle, true);
  assert.deepEqual(out.slots, ['clock', 'photos', 'system']);
  assert.equal(out.browserUrls[0], 'http://192.168.1.79:8123/aa-mobile/0');   // HA survives
  assert.equal(out.weather.unit, 'metric');
});

test('impossible bar heights fall back (out of the supported 240-520 range)', () => {
  assert.equal(sanitize({ barHeight: 99999 }).barHeight, DEFAULT_CONFIG.barHeight);
  assert.equal(sanitize({ barHeight: 10 }).barHeight, DEFAULT_CONFIG.barHeight);
  assert.equal(sanitize({ barHeight: -240 }).barHeight, DEFAULT_CONFIG.barHeight);
  assert.equal(sanitize({ barHeight: 'tall' }).barHeight, DEFAULT_CONFIG.barHeight);
  assert.equal(sanitize({ barHeight: 400 }).barHeight, 400);   // in-range value kept
});

test('invalid slot names are replaced, valid ones kept', () => {
  const out = sanitize({ slots: ['evil', 'system', 'alsoevil'] });
  assert.equal(out.slots.length, 3);
  assert.equal(out.slots[1], 'system');
  assert.notEqual(out.slots[0], 'evil');
  assert.notEqual(out.slots[2], 'alsoevil');
});

test('javascript: and non-http browser URLs are rejected', () => {
  const out = sanitize({ browserUrls: ['javascript:alert(1)', 'ftp://x.example', 'https://ok.example.com'] });
  assert.equal(out.browserUrls[0], DEFAULT_CONFIG.browserUrls[0]);
  assert.equal(out.browserUrls[1], DEFAULT_CONFIG.browserUrls[1]);
  assert.equal(out.browserUrls[2], 'https://ok.example.com');
});

test('invalid latitude/longitude become null', () => {
  const out = sanitize({ weather: { lat: 999, lon: -999, unit: 'metric', auto: false } });
  assert.equal(out.weather.lat, null);
  assert.equal(out.weather.lon, null);
  const ok = sanitize({ weather: { lat: -37.81, lon: 144.96, unit: 'metric', auto: false } });
  assert.equal(ok.weather.lat, -37.81);
  assert.equal(ok.weather.lon, 144.96);
});

test('wrong data types fall back to defaults', () => {
  const out = sanitize({
    barHeight: {}, slideMs: 'fast', shuffle: 'yes',
    slots: 'system', browserUrls: 42, bounds: 'here', weather: []
  });
  assert.equal(out.barHeight, DEFAULT_CONFIG.barHeight);
  assert.equal(out.slideMs, DEFAULT_CONFIG.slideMs);
  assert.equal(out.shuffle, DEFAULT_CONFIG.shuffle);
  assert.deepEqual(out.slots, DEFAULT_CONFIG.slots);
  assert.deepEqual(out.browserUrls, DEFAULT_CONFIG.browserUrls);
  assert.equal(out.bounds, null);
  assert.equal(out.weather.unit, 'metric');
});

test('unknown config keys are dropped, weather unit whitelist enforced', () => {
  const out = sanitize({ injectedNonsense: { a: 1 }, __proto__pollution: true, weather: { unit: 'kelvin' } });
  assert.equal('injectedNonsense' in out, false);
  assert.equal(Object.keys(out).sort().join(','),
    Object.keys(sanitize({})).sort().join(','));   // exactly the whitelisted shape
  assert.equal(out.weather.unit, 'metric');
});

test('broken bounds are nulled, sane bounds kept', () => {
  assert.equal(sanitize({ bounds: { x: 0, y: 0, width: 10, height: 10 } }).bounds, null);
  assert.equal(sanitize({ bounds: { x: NaN, y: 0, width: 800, height: 300 } }).bounds, null);
  assert.deepEqual(sanitize({ bounds: { x: 5, y: 6, width: 800, height: 300 } }).bounds,
    { x: 5, y: 6, width: 800, height: 300 });
});
