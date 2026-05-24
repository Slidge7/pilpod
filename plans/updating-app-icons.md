# Updating PilPod app icons

When you replace the artwork (taskbar, installer, in-app header, etc.), follow this checklist.

## 1. Update source files

- Put your new master image in `graphics/pilpod.png` (square artwork; high resolution helps downscaling).
- If you hand-tune platform exports, keep `graphics/pilpod.ico` (Windows) and `graphics/pilpod.icns` (macOS).

## 2. Regenerate Tauri icon set (recommended)

From the repository root:

```powershell
npm run tauri -- icon graphics/pilpod.png
```

That refreshes assets under `src-tauri/icons/` (PNG sizes, Windows Store/Appx tiles, iOS/Android mipmaps, plus a generated `icon.ico`).

## 3. Apply custom `.ico` / `.icns` (if you maintain them)

If your tuned Windows and macOS icons are **`graphics/pilpod.ico`** and **`graphics/pilpod.icns`**, copy them over the bundle files Tauri uses:

- `src-tauri/icons/icon.ico`
- `src-tauri/icons/icon.icns`

## 4. Web UI header icon (optional)

To keep the dashboard header in sync with the new look, copy your chosen PNG to:

- `public/pilpod-icon.png`

## 5. Rebuild (Windows)

1. **Quit PilPod completely** so `pilpod.exe` is not locked (otherwise `cargo clean` or relinks can fail).
2. Build as usual, e.g. one of:
   - `cd src-tauri` then `cargo build`
   - from repo root: `npm run tauri dev` or `npm run tauri build`

`src-tauri/build.rs` emits `cargo:rerun-if-changed` for `icons/icon.ico` and related PNGs, so icon-only edits should trigger a proper resource embed as long as those files change.

## 6. Taskbar still shows the old icon?

Windows caches icons. Restart **Windows Explorer** (Task Manager → Windows Explorer → Restart) or reboot once. Pinned shortcuts may need unpin/repin after installing a new build.

## Config note

You do not need to edit `src-tauri/tauri.conf.json` unless you change paths or filenames; it already references `icons/32x32.png`, `icons/128x128.png`, `icons/128x128@2x.png`, `icons/icon.icns`, and `icons/icon.ico`.
