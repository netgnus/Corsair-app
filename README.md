# iPad Dock

An always-on-top, frameless widget bar designed to sit on the **bottom strip of a second display**
(built for an iPad Pro 12.9" used as an extended monitor on Windows 11).

> **Note:** keep this project on a **local, non-synced** path (e.g. `C:\Users\<you>\ipad-dock`).
> Running it from inside iCloud Drive / OneDrive can cause the cloud client to evict (delete the
> local copy of) source files, which breaks the app.

## What it does

Three **interchangeable slots**, side by side. Each slot has a switcher row at the top — tap an icon
to change what that slot shows:

| Icon | Widget | Notes |
|------|--------|-------|
| 🌐 | **Browser** | Embedded web view with back/forward/reload, address bar, quick links. Remembers its last URL per slot. |
| 🖼️ | **Photo frame** | Cross-fading slideshow from a chosen folder. |
| 🕐 | **Clock + Weather** | Clock, date, and live weather (Open-Meteo — no API key needed). |
| 📊 | **System** | CPU / GPU / RAM / Battery ring gauges, live network throughput, GPU VRAM·temp·clock·power, and real **game FPS**. |

All text and gauges scale with the bar height and stay centered.

### System box: GPU + FPS

- **GPU** uses `nvidia-smi` (NVIDIA) with a `systeminformation` fallback — utilization, VRAM, temperature, clock, power.
- **FPS** is the real frame rate of the foreground game, measured by **PresentMon** (bundled in `tools/`).
  PresentMon needs admin/ETW, so a small helper (`fps-monitor.js`) runs it and writes the current FPS to
  `fps.json` in this folder, which the dock reads. The helper runs as an elevated logon **scheduled task**.

  **One-time setup:** run `setup-fps.ps1` (right-click → Run with PowerShell; it self-elevates). It registers
  and starts the task `iPad Dock FPS Monitor`. FPS shows while a game is presenting; the desktop reads "idle".
  To remove: `Unregister-ScheduledTask -TaskName 'iPad Dock FPS Monitor' -Confirm:$false`.

## Run it

**Easiest:** double-click the **iPad Dock** desktop shortcut (or **`launch-hidden.vbs`**) — it starts
the dock with no console window. It also auto-starts at login (a shortcut lives in the Windows
Startup folder).

**`start.bat`** does the same but keeps a small console window open; on the first run it installs
dependencies automatically.

### Re-creating the shortcut / auto-start on another PC

Run `make-shortcuts.ps1` once (right-click → Run with PowerShell, or
`powershell -ExecutionPolicy Bypass -File make-shortcuts.ps1`). It regenerates the icon and creates
the Desktop + Startup shortcuts. To remove auto-start, delete `iPad Dock.lnk` from the Startup folder
(`shell:startup`).

Or from a terminal:

```powershell
cd ipad-dock
npm install      # first time only — pulls Electron + systeminformation
npm start
```

## Controls

- **Top drag bar** — move the window. **⚙** = settings, **—** = minimize.
- **Tray icon (right-click)** in the Windows system tray:
  - **Dock on display** — Auto (external/iPad) or pick a specific screen.
  - **Bar height** — 240 / 280 / 320 / 360 / 400 / 460 / 520 px.
  - **Open settings**, **Reload**, **Quit**.
- **Settings (⚙)** — photo folder, slideshow interval, weather units (°C/°F), manual weather lat/lon.

## Where settings are stored

`%APPDATA%\ipad-dock\config.json` (slot choices, per-slot browser URLs, photo folder, weather, bar
height, chosen display). Delete this file to reset to defaults.

## Project files

```
ipad-dock/
├── package.json        # dependencies + scripts
├── main.js             # Electron main process (window, tray, IPC, weather/stats)
├── preload.js          # secure bridge to the renderer
├── start.bat           # launcher (installs deps on first run)
├── launch-hidden.vbs   # silent launcher (no console window)
├── make-shortcuts.ps1  # regenerates icon + Desktop/Startup shortcuts
├── icon.ico            # app icon (generated)
├── README.md
└── renderer/
    ├── index.html
    ├── styles.css
    └── renderer.js     # widget registry + slot manager
```

## Requirements

- Node.js (built with v24) and npm.
- Windows (tray + display logic tuned for it; the rest is cross-platform).
