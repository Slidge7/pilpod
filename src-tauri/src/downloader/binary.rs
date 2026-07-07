//! Binary lifecycle: locate yt-dlp/ffmpeg, first-run copy to a managed
//! writable directory, version reporting, and yt-dlp self-update.
//!
//! Packaging strategy (Tauri `bundle.externalBin`):
//! - Build time: `src-tauri/binaries/yt-dlp-<target-triple>.exe` (created by
//!   `scripts/fetch-binaries.ps1`); the bundler ships it as `yt-dlp.exe`
//!   NEXT TO the app executable.
//! - First run: bundled copies are cloned to `app_data_dir()/bin/` (the
//!   install dir may be read-only), so `yt-dlp -U` can self-update.
//! - No `tauri-plugin-shell`: all spawning happens in the Rust worker, so
//!   the webview cannot spawn any process at all.
//!
//! Resolution order (first hit wins):
//!   1. `app_data_dir()/bin/`        — managed, self-updatable
//!   2. directory of the app exe     — production externalBin location
//!   3. `resource_dir()/binaries/`   — legacy resources / older bundles
//!   4. `CARGO_MANIFEST_DIR/binaries/` — dev checkout
//! Dev checkouts may hold either plain (`yt-dlp.exe`) or triple-suffixed
//! (`yt-dlp-x86_64-pc-windows-msvc.exe`) names; both are accepted.

use std::path::{Path, PathBuf};
use tauri::Manager;

#[cfg(windows)]
pub const YTDLP_NAMES: &[&str] = &["yt-dlp.exe", "yt-dlp-x86_64-pc-windows-msvc.exe"];
#[cfg(windows)]
pub const FFMPEG_NAMES: &[&str] = &["ffmpeg.exe", "ffmpeg-x86_64-pc-windows-msvc.exe"];
#[cfg(not(windows))]
pub const YTDLP_NAMES: &[&str] = &["yt-dlp"];
#[cfg(not(windows))]
pub const FFMPEG_NAMES: &[&str] = &["ffmpeg"];

fn search_roots(handle: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(dir) = managed_bin_dir(handle) {
        roots.push(dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.to_path_buf());
        }
    }
    if let Ok(res) = handle.path().resource_dir() {
        roots.push(res.join("binaries"));
    }
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"));
    roots
}

pub fn managed_bin_dir(handle: &tauri::AppHandle) -> Option<PathBuf> {
    handle.path().app_data_dir().ok().map(|d| d.join("bin"))
}

fn find_in_roots(roots: &[PathBuf], names: &[&str]) -> Option<PathBuf> {
    for root in roots {
        for name in names {
            let p = root.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// Resolve both binaries or explain which one is missing.
pub fn resolve(handle: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let roots = search_roots(handle);
    let ytdlp = find_in_roots(&roots, YTDLP_NAMES).ok_or_else(|| "ytdlp_missing".to_string())?;
    let ffmpeg = find_in_roots(&roots, FFMPEG_NAMES).ok_or_else(|| "ffmpeg_missing".to_string())?;
    Ok((ytdlp, ffmpeg))
}

/// First-run copy: ensure managed copies exist in `app_data_dir()/bin/`.
/// Never overwrites an existing managed copy (it may be self-updated and
/// newer than the bundled one). Best-effort: failure leaves us running from
/// the bundled/dev location, which still works.
pub fn ensure_managed_copies(handle: &tauri::AppHandle) -> Result<(), String> {
    let managed = managed_bin_dir(handle).ok_or_else(|| "app_data_dir".to_string())?;
    std::fs::create_dir_all(&managed).map_err(|e| format!("create {}: {e}", managed.display()))?;

    // Sources: every root EXCEPT the managed dir itself.
    let roots: Vec<PathBuf> = search_roots(handle)
        .into_iter()
        .filter(|r| r != &managed)
        .collect();

    for (names, canonical) in [(YTDLP_NAMES, YTDLP_NAMES[0]), (FFMPEG_NAMES, FFMPEG_NAMES[0])] {
        let dst = managed.join(canonical);
        if dst.is_file() {
            continue; // keep possibly self-updated copy
        }
        if let Some(src) = find_in_roots(&roots, names) {
            std::fs::copy(&src, &dst)
                .map(|_| ())
                .map_err(|e| format!("copy {} -> {}: {e}", src.display(), dst.display()))?;
            log::info!("[downloader] managed copy created: {}", dst.display());
        }
    }
    Ok(())
}

/// `<binary> --version`-style probe with a timeout. `args` differs per tool.
pub async fn probe_version(bin: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let out = tokio::time::timeout(std::time::Duration::from_secs(10), cmd.output())
        .await
        .ok()?
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let first_line = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if first_line.is_empty() {
        None
    } else {
        Some(first_line)
    }
}

/// Run `yt-dlp -U` against the MANAGED copy. Returns yt-dlp's own summary
/// line (e.g. "Updated yt-dlp to 2026.06.30" / "yt-dlp is up to date").
/// Errors if there is no managed copy (we never self-update a bundled/dev
/// binary in a possibly read-only directory).
pub async fn self_update_ytdlp(handle: &tauri::AppHandle) -> Result<String, String> {
    ensure_managed_copies(handle)?;
    let managed = managed_bin_dir(handle).ok_or_else(|| "app_data_dir".to_string())?;
    let ytdlp = managed.join(YTDLP_NAMES[0]);
    if !ytdlp.is_file() {
        return Err("ytdlp_missing".into());
    }

    let mut cmd = tokio::process::Command::new(&ytdlp);
    cmd.arg("-U")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);

    let out = tokio::time::timeout(std::time::Duration::from_secs(120), cmd.output())
        .await
        .map_err(|_| "update_timeout".to_string())?
        .map_err(|e| format!("spawn_failed: {e}"))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        return Err(format!(
            "update_failed: {}",
            stderr.trim().lines().last().unwrap_or("unknown")
        ));
    }
    let summary = stdout
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("updated")
        .trim()
        .to_string();
    Ok(summary)
}
