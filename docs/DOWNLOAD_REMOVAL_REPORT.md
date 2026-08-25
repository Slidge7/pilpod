# PilPod — Download Feature Removal Report

## Overview
This document records all changes made to completely purge and remove the download features, downloader modules, background workers, sidecars, commands, UI components, tests, and documentation from the PilPod project.

---

## 1. Backend Removal (Rust & Tauri)

### 1.1 Deleted Modules & Directories
- **`src-tauri/src/downloader/`** (Entire directory deleted)
  - `binary.rs` — binary resolution, version checks, yt-dlp update mechanism
  - `commands.rs` — all `dl_*` command handlers (`dl_fetch_info`, `dl_start`, `dl_cancel`, `dl_get_queue`, `dl_clear_done`, `dl_get_settings`, `dl_set_settings`, `dl_open_output_dir`, `dl_check_binaries`, `dl_update_ytdlp`, `dl_retry`)
  - `filename.rs` — filename sanitization and templating
  - `formats.rs` — format parsing and resolution
  - `mod.rs` — downloader subsystem entry and initialization
  - `persistence.rs` — task state and queue persistence (`download_state.json`)
  - `settings.rs` — downloader configuration settings (`download_settings.json`)
  - `state.rs` — `DownloadManager` runtime state and task management
  - `worker.rs` — background download process runner and process tree cleanup
  - `testdata/` — sample test fixtures (`audio_site_dump.json`, `youtube_dump.json`)

### 1.2 Sidecar Binaries & Scripts
- **`src-tauri/binaries/`**
  - Deleted `yt-dlp.exe`
  - Deleted `yt-dlp-x86_64-pc-windows-msvc.exe`
  - Deleted `ffmpeg.exe`
  - Deleted `ffmpeg-x86_64-pc-windows-msvc.exe`
- **`scripts/`**
  - Deleted `fetch-binaries.ps1`
  - Updated `issue-dev-license.mjs` fallback feature from `"downloader"` to `"premium"`

### 1.3 Tauri Configuration & Manifests
- **`src-tauri/tauri.conf.json`**
  - Removed `externalBin` array (`"binaries/yt-dlp"`, `"binaries/ffmpeg"`).

### 1.4 Command Registrations & Invocations
- **`src-tauri/src/lib.rs`**
  - Removed `#[cfg(windows)] mod downloader;`
- **`src-tauri/src/app/handlers.rs`**
  - Removed Windows `invoke_handler` registrations for all 11 `dl_*` commands.
  - Removed non-Windows `invoke_handler` registrations for all 11 `dl_*` stub commands.
- **`src-tauri/src/app/mod.rs`**
  - Removed `crate::downloader::init(app)?;` from the setup hook.
- **`src-tauri/src/platform/stub_commands.rs`**
  - Removed all 11 `dl_*` stub command implementations and the `DL_WIN_ONLY` constant.

### 1.5 Subsystem Isolation & Comments Cleanup
- **`src-tauri/src/premium/mod.rs` & `license.rs`**
  - Replaced test feature name `"downloader"` with `"test_feature"`.
  - Updated comments referencing download-specific command gating.
- **`src-tauri/src/bin/license_tool.rs`**
  - Replaced default feature `"downloader"` with `"premium"` and updated usage messages.
- **`src-tauri/src/extension_setup/mod.rs`**, **`src-tauri/src/vault/mod.rs`**, **`src-tauri/src/vault/commands.rs`**, **`src-tauri/src/vault/store.rs`**, **`src-tauri/src/background/flyout.rs`**, **`src-tauri/src/background/mod.rs`**
  - Removed references and comparisons to the downloader module from module docstrings and comments.

---

## 2. Frontend Removal (React & TypeScript)

### 2.1 Deleted Features & Directories
- **`src/features/downloader/`** (Entire directory deleted)
  - `DownloadPanel.tsx` — full downloader panel view
  - `Downloader.css` — downloader panel styles
  - `types.ts` — TypeScript type definitions for download tasks, formats, and settings
  - `lib.ts` & `lib.test.ts` — downloader helper utilities and unit tests
  - `index.ts` — downloader feature exports and `DOWNLOADER_UI_ENABLED` flag
  - `hooks/useDownloader.ts` — downloader state, events, and Tauri invoke wrapper hook
  - `components/DownloadCard.tsx` — queue card component
  - `components/DownloadDockCard.tsx` & `DownloadDockCard.css` — floating dock download progress card
  - `components/FormatPicker.tsx` — format/codec/quality picker
  - `components/SaveOptions.tsx` — output path and naming options
  - `components/TabDownloadButton.tsx` — in-tab download action button
  - `components/UrlInput.tsx` — URL paste and probe input
  - `components/BinaryStatusBanner.tsx` — binary status banner

### 2.2 Dashboard & Navigation Integration
- **`src/features/media-dashboard/MediaDashboard.tsx`**
  - Removed all imports from `../downloader`.
  - Removed `useDownloader` hook call and `downloadSeed` state.
  - Removed `download` accessory from `renderTabAccessories`.
  - Removed `DownloadPanel` and `DownloadDockCard` renderings.
  - Removed `downloaderEnabled` prop passed to `BrowserDockBar`.
- **`src/features/media-dashboard/components/BrowserDockBar.tsx`**
  - Removed `"download"` from the `ViewType` union type (`"media" | "vault" | "playlist" | "setup"`).
  - Removed `downloaderEnabled` prop and related conditional checks.
  - Removed the Download Tray view toggle button and `IconDownloadTray` import.
- **`src/features/media-dashboard/components/BrowserSessionsPanel.tsx`**
  - Removed `download?: ReactNode` from `TabAccessories` type definition.
  - Removed `downloadButton` props passed to `MediaItemCard`.
- **`src/features/media-dashboard/components/ActiveMediaStrip.tsx`**
  - Removed `download?: ReactNode` from `renderTabAccessories` type signature.
  - Removed `downloadButton` prop passed to `MediaItemCard`.
- **`src/features/media-dashboard/components/MediaItemCard.tsx`**
  - Removed `downloadButton?: ReactNode` from `Props`.
  - Removed `downloadButton` render slot from the transport actions row.
- **`src/features/playlist-player/components/PlaylistPlayerCard.tsx`**
  - Removed `downloadButton` usage and cleaned up unused `renderTabAccessories` accessory logic.
- **`src/shared/ui/icons.tsx`**
  - Removed `IconDownloadTray` component.
- **`src/features/premium/entitlement.test.ts`**
  - Updated entitlement tests to use generic `"test_feature"` instead of `"downloader"`.
- **Comments Cleanup**
  - Cleaned up comments in `useStaticGlassWallpaper.ts`, `vault/constants.ts`, `vault/hooks/useVault.ts`, `extension-setup/ExtensionSetup.css`, and `vite.config.ts`.

---

## 3. Documentation & Planning Artifacts Removed
- Deleted `DOWNLOADER_PLAN.md` (root directory)
- Deleted `docs/downloader.md`
- Deleted `plans/PILPOD_DOWNLOAD_FEATURE_PLAN.md`
- Deleted `plans/DOCK_INTAB_DOWNLOADCARD_PLAN.md`

---

## 4. Verification & Validation

| Check | Command | Result |
| :--- | :--- | :--- |
| **TypeScript Type Checking** | `npx tsc --noEmit` | **Passed (0 errors)** |
| **Frontend Unit Tests** | `npm run test` (vitest) | **Passed (12/12 files, 151/151 tests)** |
| **Rust Compilation** | `cargo check` (in `src-tauri`) | **Passed (0 errors)** |
| **Rust Unit Tests** | `cargo test` (in `src-tauri`) | **Passed (301/301 tests)** |
| **Download Code References** | `grep_search` / `ripgrep` | **Zero active download references in source code** |
