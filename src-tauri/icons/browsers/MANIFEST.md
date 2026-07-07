# Browser icons — drop PNGs here (Salah's task)

The app loads icons from this folder by **exact filename**. Missing files fall back to `_generic.png` (already provided).

**Format:** PNG, square, 128×128 recommended (64×64 minimum), transparent background.

| Filename | Browser | Current display name (edit in `src/browser_catalog.rs`) |
|---|---|---|
| `msedge.png` | Microsoft Edge | Microsoft Edge |
| `chrome.png` | Google Chrome | Google Chrome |
| `brave.png` | Brave | Brave |
| `operagx.png` | Opera GX | Opera GX |
| `opera.png` | Opera | Opera |
| `vivaldi.png` | Vivaldi | Vivaldi |
| `chromium.png` | Chromium | Chromium |
| `arc.png` | Arc | Arc |
| `yandex.png` | Yandex Browser | Yandex Browser |
| `tor.png` | Tor Browser | Tor Browser |
| `firefox.png` | Mozilla Firefox | Mozilla Firefox |
| `librewolf.png` | LibreWolf | LibreWolf |
| `waterfox.png` | Waterfox | Waterfox |
| `_generic.png` | fallback (any browser without its own PNG) | — |

Notes:
- Filenames are the catalog ids — do not rename them.
- Display names live in `src-tauri/src/browser_catalog.rs` (`display_name` fields); change them there if you want different labels.
- After adding/replacing PNGs, restart the app (icons are cached for the process lifetime).
- These files are bundled as Tauri resources (`tauri.conf.json` → `icons/browsers/*`).
