# iPad Dock

A sleek, always-on-top **control deck** for a second display — built for an iPad Pro 12.9" used as an
extended monitor on Windows 11, docked along the bottom strip of the screen.

It's a frameless [Electron](https://www.electronjs.org/) bar split into **three interchangeable slots**.
Tap the switcher at the top of any slot to change what it shows.

---

## ✨ Features

| Tile | What it does |
|------|--------------|
| 🌐 **Browser** | Embedded web view with back/forward/reload, an address bar, and quick links. Remembers its last URL per slot. |
| ▦ **App launcher** | Touch grid of your apps with real icons — one tap to launch (Steam, Chrome, Discord, VS Code, …). |
| 🖼️ **Photo frame** | Cross-fading slideshow from any folder, **recursive** (includes subfolders), shuffle, tap-to-skip. |
| 🕐 **Clock + Weather** | Big clock, date, and live weather via [Open-Meteo](https://open-meteo.com) (no API key). |
| 📊 **System monitor** | CPU / GPU / RAM / Battery ring gauges, live network throughput, and real **game FPS**. |

- **Scales to any height** — text and gauges resize so it looks right whether the bar is short or tall.
- **Remembers its place** — drag/resize once; it restores on every launch and survives slot changes.
- **Auto-starts at login**, lives in the system tray (click the tray icon to show/hide), zero taskbar clutter.

---

## 🖥️ Requirements

- **Windows 10/11**
- **[Node.js](https://nodejs.org)** (built with v24)
- An NVIDIA GPU for full GPU telemetry via `nvidia-smi` (other GPUs fall back to limited stats)

## 🚀 Getting started

```bash
git clone https://github.com/netgnus/Corsair-app.git
cd Corsair-app
npm install
npm start
```

Or on Windows, just double-click **`start.bat`** (installs dependencies on first run).

### Make it launch silently + at login
Run **`make-shortcuts.ps1`** once — it generates the icon and creates Desktop + Startup shortcuts that
launch the dock with no console window.

---

## 🎮 Game FPS (optional)

Real foreground-game FPS is measured with [PresentMon](https://github.com/GameTechDev/PresentMon)
(bundled in `tools/`, MIT-licensed). Because it uses ETW, it needs admin:

```powershell
# run once — self-elevates and registers an at-login scheduled task
powershell -ExecutionPolicy Bypass -File setup-fps.ps1
```

A small helper (`fps-monitor.js`) runs PresentMon and writes the current FPS to `fps.json`, which the
dock reads. FPS shows while a game is presenting; the desktop reads "idle".

## 🎛️ Controls

- **Top drag bar** — move the window. **⚙** settings, **—** minimize.
- **Tray icon** (Windows system tray) — click to show/hide; right-click for:
  - **Dock on display** — Auto (external/iPad) or a specific screen
  - **Bar height** — 240–520 px
  - **Re-snap to bottom**, **Show / Restore dock**, **Open settings**, **Reload**, **Quit**
- **Settings (⚙)** — photo folder, shuffle, slideshow interval, weather units (°C/°F), manual lat/lon.

## ⚙️ Configuration

Settings persist to `%APPDATA%\ipad-dock\config.json` (slot choices, per-slot browser URLs, photo
folder, weather, bar height, chosen display, window position). Delete it to reset to defaults.

The app-launcher list is built by **`resolve-apps.ps1`** — edit its `$wanted` list and re-run it to
change which apps appear (it re-extracts icons into `icons/` and rewrites `apps.json`).

## 📁 Project structure

```
ipad-dock/
├── main.js              # Electron main process (window, tray, IPC, GPU/FPS/weather)
├── preload.js           # secure context bridge
├── renderer/            # UI — index.html, styles.css, renderer.js (widgets + slot manager)
├── fps-monitor.js       # PresentMon → fps.json helper
├── resolve-apps.ps1     # builds the launcher's app list + icons
├── setup-fps.ps1        # registers the FPS scheduled task
├── make-shortcuts.ps1   # icon + Desktop/Startup shortcuts
├── tools/PresentMon.exe # bundled FPS capture (MIT)
└── start.bat            # one-click launcher
```

## 🙏 Credits

- [Electron](https://www.electronjs.org/) · [systeminformation](https://systeminformation.io/)
- [PresentMon](https://github.com/GameTechDev/PresentMon) (Intel/GameTechDev, MIT)
- [Open-Meteo](https://open-meteo.com) weather API

## 📄 License

MIT — see [LICENSE](LICENSE).
