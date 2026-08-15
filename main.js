// main.js — entry point.
//
// Two modes:
//   (default)      the dock UI — src/main/app.js
//   --fps-helper   headless PresentMon FPS monitor (fps-monitor.js) running
//                  under the app's own runtime. This lets the packaged app's
//                  scheduled task run FPS monitoring WITHOUT a globally
//                  installed Node: `iPadDock.exe --fps-helper`.
//                  (In development, `node fps-monitor.js` still works too.)
if (process.argv.includes('--fps-helper')) {
  // Headless: no windows, no tray, no single-instance lock (must not steal
  // the dock's). Just run the monitor loop until killed.
  require('./fps-monitor.js');
} else {
  require('./src/main/app.js').run();
}
