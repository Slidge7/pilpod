# PilPod Universal Downloader (Premium)

Local video/audio downloading powered by yt-dlp + FFmpeg, running entirely on
the user's machine. Gated behind the `downloader` premium feature flag.

## Architecture

```
React (src/features/downloader) ── invoke/events ── Rust (src-tauri/src/downloader)
        PremiumGate (cosmetic)                      require_premium() (authoritative)
                                                    worker → yt-dlp ── ffmpeg
```

- **Premium gating**: `src-tauri/src/premium/` verifies an offline Ed25519
  license (`PP1.<payload>.<sig>`); every `dl_*` command calls
  `require_premium(state, "downloader")` first. The UI gate is cosmetic.
- **Isolation**: the downloader touches the rest of the app only via
  `lib.rs` (mod decl), `app/handlers.rs` (commands), `app/mod.rs` (init).
- **No shell plugin**: all processes are spawned from Rust (tokio) with
  `CREATE_NO_WINDOW`; the webview cannot spawn anything.

## Commands (all premium-gated)

`dl_fetch_info`, `dl_start`, `dl_cancel`, `dl_retry`, `dl_get_queue`,
`dl_clear_done`, `dl_get_settings`, `dl_set_settings`, `dl_open_output_dir`,
`dl_check_binaries`, `dl_update_ytdlp`.

Events: `dl://update`, `dl://progress`, `dl://complete`, `dl://error`,
`dl://binary-status`, plus `premium://status`.

## Binaries

- Dev: run `scripts/fetch-binaries.ps1` → `src-tauri/binaries/` (gitignored),
  including target-triple copies for `bundle.externalBin`.
- Production: bundler ships `yt-dlp.exe`/`ffmpeg.exe` next to `PilPod.exe`.
- First run copies them to `%APPDATA%/com.t14.pilpod/bin/` (managed,
  writable) so `dl_update_ytdlp` (`yt-dlp -U`) can self-update.
- Resolution order: managed dir → exe dir → resources → dev checkout.

## Safety & hardening

- Frontend never passes raw process args: URL scheme/length, format-selector
  charset, audio format, container, output dir are allowlist-validated;
  filenames are sanitized (traversal, reserved names, length).
- Concurrency capped by semaphore (settings `concurrentLimit`, default 2,
  applies after restart); queue capped at 20 active.
- Disk preflight: refuses to start with < 500 MB free.
- Cancel kills the whole process tree (`taskkill /F /T`) and removes
  partial files.
- Crash recovery: queue is persisted to `download_state.json`; interrupted
  tasks reappear as failed with a Retry action.

## Licensing (dev)

- Issue keys: `node scripts/issue-dev-license.mjs --email a@b.c [--days N]`
  (requires gitignored `scripts/dev-license-key.json`) or
  `cargo run --bin license_tool -- keygen|issue`.
- Replace `LICENSE_PUBKEY` in `src-tauri/src/premium/license.rs` with the
  production key before release.

## Feature flag

Set `VITE_FEATURE_DOWNLOADER=false` at build time to remove the downloader
UI entirely (runtime premium gating remains regardless).
