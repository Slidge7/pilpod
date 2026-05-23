# PilPod — Download Feature Implementation Plan

> **For the AI reading this in Cursor:** This is a self-contained implementation plan.
> PilPod is an existing Tauri 2 + React 19 + TypeScript Windows desktop app (`com.t14.pilpod`).
> It already has a working Rust backend, IPC layer (invoke/events), WASAPI audio, GSMTC media
> sessions, and a browser companion extension. Your job is to add a **video/audio download panel**
> to this existing codebase without breaking any existing functionality.
> Read every section before writing any code.

---

## 1. Goal

Add a **Download** tab to the existing `MediaDashboard` UI. Users can paste a URL (or send one
from the browser companion), choose format/quality, and download videos or audio from YouTube,
TikTok, Instagram, and 1000+ sites — entirely locally, using yt-dlp + FFmpeg as child processes
managed by the Rust backend. No cloud, no server, no account required.

---

## 2. Constraints and rules

- **Do not touch** `gsmtc/`, `audio_mixer/`, `platform/stub_commands.rs`, or the HTTP bridge
  (`tiny_http` server on port 17399) unless strictly necessary. Those subsystems are stable.
- **Do not change** the existing window dimensions (350×600) in `tauri.conf.json` for normal
  mode. The download panel must fit within this width.
- All new Rust code goes in a new module `src-tauri/src/downloader/`. Register it in `main.rs`
  or `lib.rs` like the other modules — do not scatter logic across existing files.
- All new React code goes in `src/features/downloader/`. Follow the existing folder convention
  (`media-dashboard/`, `windows-media/`).
- Match the existing CSS design token system in `index.css`. Do not introduce a new CSS
  framework or component library.
- The stub commands file (`platform/stub_commands.rs`) must get stub versions of every new
  `#[tauri::command]` so non-Windows builds still compile.
- Keep `app/setup.rs` changes minimal — only add the downloader initialization call alongside
  the four existing service starts.

---

## 3. Binary dependency strategy

Use **Strategy A (bundled binaries)** from the analysis in this session:

- Ship `yt-dlp.exe` and `ffmpeg.exe` inside the Tauri installer via the `resources` config.
- On first launch, the Rust downloader module copies them from the resource path to
  `app_data_dir()/pilpod/bin/` if not already present.
- On subsequent launches, check the cached version tag against the yt-dlp GitHub releases API
  and offer a silent background update.
- Never call binaries from the system PATH — use the managed copies only. This guarantees the
  app works offline after first setup and is not broken by the user's environment.

**Tauri config addition** (`tauri.conf.json`):
```json
"bundle": {
  "resources": [
    "binaries/yt-dlp.exe",
    "binaries/ffmpeg.exe"
  ]
}
```

Place the binaries in `src-tauri/binaries/` and add that directory to `.gitignore`.
Add a `scripts/fetch-binaries.ps1` PowerShell script that downloads the latest release builds
of both tools so any contributor can bootstrap the dev environment with one command.

---

## 4. New Rust module: `src-tauri/src/downloader/`

### 4.1 File structure

```
src-tauri/src/downloader/
  mod.rs          — public re-exports, module init function
  binary.rs       — binary lifecycle: locate, extract, version-check, update
  commands.rs     — all #[tauri::command] functions
  state.rs        — DownloadManager struct and DownloadTask
  worker.rs       — async download execution, stdout parsing, event emission
  formats.rs      — yt-dlp JSON parsing, Format structs
```

### 4.2 State (`state.rs`)

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::process::Child;

#[derive(Debug, Clone, serde::Serialize)]
pub enum DownloadStatus {
    Queued,
    FetchingInfo,
    Downloading,
    Muxing,
    Done,
    Cancelled,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadTask {
    pub id: String,           // UUID
    pub url: String,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub status: DownloadStatus,
    pub percent: f32,
    pub speed: Option<String>, // "8.3MiB/s"
    pub eta: Option<String>,
    pub output_path: Option<String>,
    pub format_id: Option<String>,
    pub created_at: u64,      // unix timestamp
}

pub struct DownloadManager {
    pub tasks: HashMap<String, DownloadTask>,
    pub children: HashMap<String, Arc<Mutex<Option<Child>>>>,
}

// Register as managed state:
// Arc<Mutex<DownloadManager>>
```

### 4.3 Commands (`commands.rs`)

Every command must also have a stub in `platform/stub_commands.rs` returning
`Err("Windows only".to_string())`.

| Command | Arguments | Returns | Notes |
|---|---|---|---|
| `dl_fetch_info` | `url: String` | `VideoInfo` (title, thumbnail, formats list) | Spawns `yt-dlp --dump-json <url>`, parses stdout |
| `dl_start` | `url, format_id, output_dir, task_id` | `()` | Enqueues and starts download worker |
| `dl_cancel` | `task_id: String` | `()` | Kills child process, sets status Cancelled |
| `dl_get_queue` | — | `Vec<DownloadTask>` | Returns full task list for UI hydration |
| `dl_clear_done` | — | `()` | Removes Done/Cancelled/Error tasks from state |
| `dl_get_output_dir` | — | `String` | Returns current configured output directory |
| `dl_set_output_dir` | `path: String` | `()` | Persists to `app_data_dir()/pilpod/settings.json` |
| `dl_open_output_dir` | — | `()` | Opens folder in Windows Explorer |
| `dl_check_binaries` | — | `BinaryStatus` | Reports whether yt-dlp/FFmpeg are present and their versions |
| `dl_update_ytdlp` | — | `()` | Runs `yt-dlp -U` in the managed bin dir |

### 4.4 Worker (`worker.rs`)

```rust
// Pseudocode — implement fully
pub async fn run_download(
    task_id: String,
    url: String,
    format_id: String,
    output_dir: String,
    ytdlp_path: PathBuf,
    ffmpeg_path: PathBuf,
    state: Arc<Mutex<DownloadManager>>,
    app_handle: AppHandle,
) {
    // 1. Update task status → Downloading, emit dl://update event
    // 2. Spawn yt-dlp with args:
    //      --format <format_id>
    //      --ffmpeg-location <ffmpeg_path>
    //      --merge-output-format mp4
    //      --output "<output_dir>/%(title)s.%(ext)s"
    //      --newline                 ← forces one progress line per line
    //      --progress-template "%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s"
    //      <url>
    // 3. Pipe stdout via BufReader, line by line:
    //    - Parse percent|speed|eta → update task, emit dl://progress
    //    - Detect "[Merger]" line → set status Muxing
    //    - Detect "[download] Destination:" → capture output_path
    // 4. Await child exit:
    //    - exit 0 → status Done, emit dl://complete
    //    - exit != 0 → status Error(stderr), emit dl://error
}
```

Events emitted to the frontend (follow the existing `gsmtc://` / `browsers://` naming pattern):

| Event | Payload |
|---|---|
| `dl://update` | `DownloadTask` (full snapshot) |
| `dl://progress` | `{ id, percent, speed, eta }` |
| `dl://complete` | `{ id, output_path }` |
| `dl://error` | `{ id, message }` |
| `dl://binary-status` | `BinaryStatus` |

### 4.5 Format parsing (`formats.rs`)

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VideoInfo {
    pub title: String,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub webpage_url: String,
    pub formats: Vec<Format>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Format {
    pub format_id: String,
    pub ext: String,
    pub resolution: Option<String>,  // "1920x1080"
    pub fps: Option<f64>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub filesize: Option<u64>,
    pub tbr: Option<f64>,            // total bitrate
}
```

After parsing, generate **preset options** to show the user instead of the raw format list:
- Best video + audio (auto-mux) → format_id `"bestvideo+bestaudio/best"`
- 1080p MP4, 720p MP4, 480p MP4 (filter formats by height)
- Audio only MP3 (format_id `"bestaudio/best"`, add `--extract-audio --audio-format mp3`)

### 4.6 `mod.rs` init function

```rust
pub fn init(app_handle: &AppHandle, state: Arc<Mutex<DownloadManager>>) {
    // 1. Resolve binary paths via binary::ensure_binaries(app_handle)
    // 2. Emit dl://binary-status event with result
    // 3. No background threads needed at startup — workers are spawned on demand
}
```

Register in `app/setup.rs` alongside the four existing service starts.

---

## 5. Frontend: `src/features/downloader/`

### 5.1 File structure

```
src/features/downloader/
  index.ts                  — re-exports
  DownloadPanel.tsx          — top-level panel, mounted as the third tab
  components/
    UrlInput.tsx             — paste input + "Fetch info" button
    FormatPicker.tsx         — preset quality dropdown + custom format_id
    OutputDirPicker.tsx      — shows current dir, open-folder button, change button
    DownloadQueue.tsx        — list of DownloadTask cards
    DownloadCard.tsx         — single task: thumbnail, title, progress bar, actions
    BinaryStatusBanner.tsx   — shown when yt-dlp/FFmpeg not found, with install CTA
  hooks/
    useDownloader.ts         — all state, invoke calls, event listeners
    useDownloadQueue.ts      — derived queue state and task actions
  types.ts                  — TypeScript mirrors of Rust structs
```

### 5.2 `useDownloader.ts` hook

```typescript
// Responsibilities:
// - Listen to dl://update, dl://progress, dl://complete, dl://error events
// - Maintain tasks: Map<string, DownloadTask> in useState
// - On mount: invoke("dl_get_queue") to hydrate from Rust state (survives React re-renders)
// - On mount: invoke("dl_check_binaries") → set binaryStatus state
// - Expose: fetchInfo(url), startDownload(url, formatId), cancelDownload(id),
//           clearDone(), setOutputDir(path), openOutputDir()
```

### 5.3 Tab integration

The existing `MediaMainTab` type is `"browser" | "windows"`. Extend it:

```typescript
// In the existing tab type definition:
type MediaMainTab = "browser" | "windows" | "download";
```

Add the Download tab button to the existing `Header` component alongside the browser/windows
tab switchers. Use the existing tab button style — do not create new CSS classes, reuse the
existing ones.

In `MediaDashboard.tsx`, add:
```tsx
{activeTab === "download" && <DownloadPanel />}
```

### 5.4 `DownloadCard.tsx` design

Match the existing card aesthetic in `BrowserSessionsPanel` / `WindowsSessionsPanel`:

- Thumbnail (if available) as a small 48×27px image on the left (16:9 aspect)
- Title truncated to one line
- Progress bar using existing CSS token colors (reuse `--color-accent` or equivalent)
- Status badge: Queued / Fetching / Downloading (with % and speed) / Muxing / Done / Error
- Action buttons: Cancel (while downloading), Open file (when done), Retry (on error),
  Remove (always) — use the same icon button style as existing tab close/reload buttons
- 8-second pending action spinner timeout — already established in `useMediaDashboard.ts`,
  apply the same pattern here

### 5.5 `BinaryStatusBanner.tsx`

Show this at the top of `DownloadPanel` when `binaryStatus.ytdlpPresent === false`:

```
⚠ yt-dlp not found. PilPod needs to download it once (~10MB).
[Download yt-dlp + FFmpeg]   [Dismiss]
```

On click: invoke `dl_update_ytdlp`, listen for `dl://binary-status` to update the banner.

---

## 6. Browser companion integration

This is the elegant part: the user is already watching a video in a browser tab that PilPod
tracks. Add a **"Download" action** to each tab row in `BrowserSessionsPanel`.

### 6.1 Frontend change

In `DownloadCard`/tab row (inside `BrowserSessionsPanel`), add a download icon button.
On click, call `startDownload(tab.url)` from `useDownloader`. This sends the tab's current
URL straight into the download pipeline — no copy-paste needed.

Only show the button when:
- The tab has a media session (`tab.hasMedia === true`)
- Binary status is OK

### 6.2 No backend change needed

The browser companion already reports tab URLs in its POST payload. The `tab.url` is already
available in the React state. The download feature just consumes it. No changes to the HTTP
bridge, service worker, or content script are required.

---

## 7. Settings persistence

Create `src-tauri/src/downloader/settings.rs`:

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DownloadSettings {
    pub output_dir: String,           // default: user Downloads folder
    pub preferred_format: String,     // default: "bestvideo+bestaudio/best"
    pub concurrent_limit: u8,         // default: 2
    pub auto_open_on_complete: bool,  // default: false
}
```

Persist to `app_data_dir()/pilpod/download_settings.json` (same pattern as the existing
`browser_ext_state.json`). Load on init, save on any `dl_set_*` command.

---

## 8. Concurrency limit

The `DownloadManager` must enforce `concurrent_limit` (default 2). When `dl_start` is called
and active download count ≥ limit, set the task status to `Queued`. A tokio task watches for
worker completion and starts the next queued task. Use a `tokio::sync::Semaphore` with
`concurrent_limit` permits for clean implementation.

---

## 9. Implementation order (do this sequence)

**Phase 1 — Rust foundation (no UI yet)**

1. Create `src-tauri/src/downloader/mod.rs` with the module skeleton
2. Implement `binary.rs` — locate/extract/version-check yt-dlp and FFmpeg
3. Implement `state.rs` — `DownloadManager`, `DownloadTask`, `DownloadStatus`
4. Implement `formats.rs` — `VideoInfo`, `Format`, preset generator
5. Implement `commands.rs` — all commands with real logic
6. Add stubs for every new command to `platform/stub_commands.rs`
7. Register module in `main.rs`/`lib.rs` and add init call in `app/setup.rs`
8. Add binary resources to `tauri.conf.json`
9. Write `scripts/fetch-binaries.ps1`
10. Test via `tauri::test` or by temporarily adding a raw println in setup — confirm
    yt-dlp spawns and stdout is captured correctly

**Phase 2 — React UI**

11. Add `types.ts` (TypeScript mirrors of Rust structs)
12. Implement `useDownloader.ts` hook
13. Implement `UrlInput.tsx`, `FormatPicker.tsx`, `OutputDirPicker.tsx`
14. Implement `DownloadCard.tsx` and `DownloadQueue.tsx`
15. Implement `BinaryStatusBanner.tsx`
16. Assemble `DownloadPanel.tsx`
17. Extend `MediaMainTab` type and wire the new tab into `MediaDashboard.tsx` and `Header`

**Phase 3 — Browser companion integration**

18. Add download icon button to tab rows in `BrowserSessionsPanel`
19. Connect to `useDownloader.startDownload(tab.url)`
20. Gate the button on `tab.hasMedia && binaryStatus.ok`

**Phase 4 — Polish**

21. Implement concurrency queue with `tokio::sync::Semaphore`
22. Implement `dl_update_ytdlp` (runs `yt-dlp -U` in managed bin dir)
23. Implement settings persistence (`download_settings.json`)
24. Test on Windows 10 1809+ and Windows 11
25. Verify non-Windows stub compile: `cargo build --target x86_64-unknown-linux-gnu`

---

## 10. New dependencies to add

### `src-tauri/Cargo.toml`

```toml
[dependencies]
# already present (confirm before adding):
# tokio, serde, serde_json, tauri, uuid

# new:
reqwest = { version = "0.12", features = ["json", "stream"] }  # binary download/update check
semver = "1"                                                    # version comparison for update check
```

Do not add `tiny_http` (already present for the HTTP bridge).
Do not add `tokio` (already present).

### `package.json` (frontend)

No new npm dependencies. All UI is built with existing React + TypeScript + CSS tokens.

---

## 11. Key risks and mitigations

| Risk | Mitigation |
|---|---|
| yt-dlp stdout format changes | Parse loosely — use `contains("[download]")` and split on `%`, not strict regex. Fall back to raw line display if parse fails. |
| FFmpeg not found at mux time | Always pass `--ffmpeg-location` explicitly. Never rely on PATH. |
| Download fills disk | Before starting, check available disk space with `std::fs::metadata` on the output dir's root. Warn if < 500MB. |
| Window too narrow for UI | DownloadPanel uses the same 350px width. DownloadCard is a compact row — thumbnail + title + progress bar + 2 icon buttons. No horizontal overflow. |
| Concurrent downloads spike CPU | `tokio::sync::Semaphore` with limit=2. User can adjust in settings. |
| yt-dlp binary not bundled in dev builds | `dl_check_binaries` returns `BinaryStatus { ok: false }` and the `BinaryStatusBanner` guides the user to run `fetch-binaries.ps1`. |
| App crashes mid-download | On next launch, `dl_get_queue` returns tasks from in-memory state (lost on crash). Consider writing active task IDs to `download_state.json` and marking them as Error on reload. |

---

## 12. File change summary

### New files (create from scratch)

```
src-tauri/src/downloader/mod.rs
src-tauri/src/downloader/binary.rs
src-tauri/src/downloader/commands.rs
src-tauri/src/downloader/state.rs
src-tauri/src/downloader/worker.rs
src-tauri/src/downloader/formats.rs
src-tauri/src/downloader/settings.rs
src/features/downloader/index.ts
src/features/downloader/DownloadPanel.tsx
src/features/downloader/components/UrlInput.tsx
src/features/downloader/components/FormatPicker.tsx
src/features/downloader/components/OutputDirPicker.tsx
src/features/downloader/components/DownloadQueue.tsx
src/features/downloader/components/DownloadCard.tsx
src/features/downloader/components/BinaryStatusBanner.tsx
src/features/downloader/hooks/useDownloader.ts
src/features/downloader/hooks/useDownloadQueue.ts
src/features/downloader/types.ts
scripts/fetch-binaries.ps1
```

### Existing files to modify (minimal, surgical changes only)

```
src-tauri/src/main.rs (or lib.rs)   — add: mod downloader;
src-tauri/src/app/setup.rs          — add: downloader::init(&app_handle, state.clone());
src-tauri/src/platform/stub_commands.rs — add stubs for all 10 new commands
src-tauri/Cargo.toml                — add: reqwest, semver
src-tauri/tauri.conf.json           — add: bundle.resources for two binaries
src/features/media-dashboard/MediaDashboard.tsx — add download tab render branch
src/features/media-dashboard/Header.tsx (or equivalent) — add Download tab button
src/features/browser-media/BrowserSessionsPanel.tsx — add download button per tab row
.gitignore                          — add: src-tauri/binaries/
```

---

## 13. Definition of done

- [ ] `dl_fetch_info` returns title, thumbnail, and format presets for a YouTube URL
- [ ] `dl_start` downloads a video to the output directory with real-time progress events
- [ ] `dl_cancel` kills the child process cleanly (no zombie yt-dlp.exe left running)
- [ ] Progress bar in the UI updates in real time from `dl://progress` events
- [ ] Download tab is accessible via the header tab button without affecting browser/windows tabs
- [ ] Download button on a browser tab row starts a download from that tab's URL
- [ ] `BinaryStatusBanner` appears when yt-dlp is missing; disappears after successful install
- [ ] Non-Windows build compiles cleanly with stubs
- [ ] No existing functionality (GSMTC, audio mixer, browser companion, HTTP bridge) is broken
- [ ] No yt-dlp.exe or ffmpeg.exe is committed to git (`.gitignore` enforces this)
