use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, serde::Serialize)]
pub struct BinaryStatus {
    pub ytdlp_present: bool,
    pub ffmpeg_present: bool,
    pub ytdlp_version: Option<String>,
    pub ffmpeg_version: Option<String>,
    pub ok: bool,
}

/// Managed directory: `<app_data>/pilpod/bin/`
pub fn bin_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("pilpod")
        .join("bin")
}

pub fn ytdlp_path(app: &AppHandle) -> PathBuf {
    bin_dir(app).join("yt-dlp.exe")
}

pub fn ffmpeg_path(app: &AppHandle) -> PathBuf {
    bin_dir(app).join("ffmpeg.exe")
}

/// Attempt to copy bundled binaries from the resource directory to the
/// managed bin dir.  Silently skips if already present or not bundled.
pub fn ensure_binaries_sync(app: &AppHandle) {
    let dir = bin_dir(app);
    let _ = std::fs::create_dir_all(&dir);

    let targets = [
        ("yt-dlp.exe", dir.join("yt-dlp.exe")),
        ("ffmpeg.exe", dir.join("ffmpeg.exe")),
    ];

    let res_dir = app.path().resource_dir().ok();

    for (name, dst) in &targets {
        if dst.exists() {
            continue;
        }
        if let Some(ref rd) = res_dir {
            let candidates = [rd.join(name), rd.join("binaries").join(name)];
            for src in &candidates {
                if src.exists() {
                    let _ = std::fs::copy(src, dst);
                    break;
                }
            }
        }
    }
}

async fn binary_version(path: &PathBuf) -> Option<String> {
    let out = tokio::process::Command::new(path)
        .arg("--version")
        .output()
        .await
        .ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        None
    }
}

/// Full status check including version strings (async due to subprocess calls).
pub async fn check_binaries(app: &AppHandle) -> BinaryStatus {
    let ytdlp = ytdlp_path(app);
    let ffmpeg = ffmpeg_path(app);

    let ytdlp_present = ytdlp.exists();
    let ffmpeg_present = ffmpeg.exists();

    let ytdlp_version = if ytdlp_present {
        binary_version(&ytdlp).await
    } else {
        None
    };
    let ffmpeg_version = if ffmpeg_present {
        binary_version(&ffmpeg).await
    } else {
        None
    };

    let ok = ytdlp_present && ffmpeg_present;

    BinaryStatus {
        ytdlp_present,
        ffmpeg_present,
        ytdlp_version,
        ffmpeg_version,
        ok,
    }
}
