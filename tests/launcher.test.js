// tests/launcher.test.js — the launcher must accept its own generated IDs and
// nothing else. Runs under plain `node --test`: electron's shell is absent, so
// launchApp resolves (returns true/false) without opening anything.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Point the launcher at a fixture apps.json BEFORE requiring the module.
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipad-dock-launcher-'));
const fixture = path.join(fixtureDir, 'apps.json');
fs.writeFileSync(fixture, JSON.stringify([
  { name: 'Steam', target: 'C:\\FakeMenu\\Steam.lnk', icon: 'icons/Steam.png' },
  { name: 'Chrome', target: 'C:\\FakeMenu\\Chrome.lnk', icon: null },
  { name: 'BrokenEntry' },                                   // no target: must be skipped
  { target: 'C:\\FakeMenu\\NoName.lnk' }                     // no name: gets a fallback name
]));
process.env.IPAD_DOCK_APPS_JSON = fixture;

const launcher = require('../src/main/launcher.js');

test('getLauncher exposes only {id, name, icon} — never filesystem targets', () => {
  const apps = launcher.getLauncher();
  assert.equal(apps.length, 3);                              // broken entry skipped
  for (const a of apps) {
    assert.ok(/^app-\d+$/.test(a.id));
    assert.equal('target' in a, false);
    assert.equal(JSON.stringify(a).includes('FakeMenu'), false);
  }
  assert.equal(apps[0].name, 'Steam');
});

test('known generated IDs resolve', () => {
  launcher.getLauncher();
  assert.equal(launcher.launchApp('app-0'), true);
  assert.equal(launcher.launchApp('app-1'), true);
});

test('arbitrary filesystem paths are rejected', () => {
  launcher.getLauncher();
  assert.equal(launcher.launchApp('C:\\Windows\\System32\\calc.exe'), false);
  assert.equal(launcher.launchApp('C:/Windows/System32/cmd.exe'), false);
  assert.equal(launcher.launchApp('..\\..\\evil.exe'), false);
  assert.equal(launcher.launchApp('\\\\attacker\\share\\payload.exe'), false);
});

test('unknown IDs and junk input are rejected', () => {
  launcher.getLauncher();
  assert.equal(launcher.launchApp('app-999'), false);
  assert.equal(launcher.launchApp(''), false);
  assert.equal(launcher.launchApp(null), false);
  assert.equal(launcher.launchApp(42), false);
  assert.equal(launcher.launchApp({ id: 'app-0' }), false);
});
