// security.js — v1.2.0 hardening for every webContents in the app.
//
// The dock deliberately embeds remote websites in a <webview> (Browser widget).
// The rules here make that safe:
//   * webview guests can never gain Node, a preload, or unexpected privileges
//   * popups never create uncontrolled BrowserWindows — http(s) popups are
//     navigated in the SAME webview instead; everything else is dropped
//   * remote pages get NO device permissions unless whitelisted here
//   * the local UI window can never be navigated away from its file:// page
const { app, session, shell } = require('electron');

// Permissions remote content may use. Everything else (camera, microphone,
// geolocation, notifications, MIDI, clipboard read, HID, USB, ...) is denied.
const ALLOWED_PERMISSIONS = new Set([
  'fullscreen'   // videos in the Browser widget may go fullscreen
]);

function isHttpUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

function install(getMainWindow) {
  // --- deny-by-default permission handling (applies to webviews too: they
  //     share the default session) ---
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    return ALLOWED_PERMISSIONS.has(permission);
  });

  app.on('web-contents-created', (_event, contents) => {
    // --- lock down every <webview> before it attaches ---
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      // Strip anything privileged a compromised renderer could try to inject.
      delete webPreferences.preload;
      delete webPreferences.preloadURL;
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      webPreferences.allowRunningInsecureContent = false;
      webPreferences.experimentalFeatures = false;
      webPreferences.enableBlinkFeatures = '';

      // No custom session partitions, and guests may only load http(s).
      if (params.partition) { event.preventDefault(); return; }
      if (params.src && !isHttpUrl(params.src) && params.src !== 'about:blank') {
        event.preventDefault();
      }
    });

    if (contents.getType() === 'webview') {
      // Popups: never a new Electron window. http(s) popups (logins, target=_blank
      // links) navigate the same webview; anything else is dropped.
      contents.setWindowOpenHandler(({ url }) => {
        if (isHttpUrl(url)) contents.loadURL(url);
        return { action: 'deny' };
      });
      // Guests stay on http(s) — block file://, custom schemes, etc.
      contents.on('will-navigate', (event, url) => {
        if (!isHttpUrl(url)) event.preventDefault();
      });
    } else {
      // The local UI (and anything else): no window.open, no navigating away.
      contents.setWindowOpenHandler(({ url }) => {
        // External links from the local UI (e.g. future About page) go to the
        // system browser rather than an Electron window.
        if (isHttpUrl(url)) shell.openExternal(url);
        return { action: 'deny' };
      });
      contents.on('will-navigate', (event, url) => {
        // The dock UI is a local file: any navigation attempt is hostile.
        if (!url.startsWith('file://')) event.preventDefault();
        else {
          const main = getMainWindow && getMainWindow();
          if (main && contents === main.webContents && url !== contents.getURL()) {
            event.preventDefault();
          }
        }
      });
    }
  });
}

module.exports = { install, isHttpUrl };
