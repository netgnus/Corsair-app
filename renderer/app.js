// app.js — renderer bootstrap. (Loaded last; earlier scripts define
// util, DockStore, widgets, slots, settings.)
let dockConfig = null;

async function init() {
  dockConfig = await window.dock.getConfig();
  // Defensive defaults — main validates too, but never trust a null here.
  if (!Array.isArray(dockConfig.slots) || dockConfig.slots.length !== 3) dockConfig.slots = ['browser', 'photos', 'clock'];
  if (!Array.isArray(dockConfig.browserUrls)) dockConfig.browserUrls = ['https://www.google.com', 'https://www.google.com', 'https://www.google.com'];

  buildSlots();

  $('settingsBtn').onclick = openSettings;
  $('minBtn').onclick = () => window.dock.minimize();
  $('closeSettings').onclick = closeSettings;
  $('saveSettings').onclick = saveSettings;
  $('pickFolder2').onclick = pickFolder;
  window.dock.onOpenSettings(openSettings);
}
init();
