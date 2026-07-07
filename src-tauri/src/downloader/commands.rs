//! Downloader Tauri commands. EVERY command's first statement is the
//! `require_premium` gate — the UI hiding things is cosmetic, this is the
//! real enforcement point.
//!
//! Input hardening: the frontend never supplies raw process arguments. URLs,
//! format selectors, audio formats, containers and filenames are validated
//! against allowlists here before anything reaches the worker.

use super::state::{DlState, DownloadStatus, DownloadTask, JobSpec};
use super::{
    binary, filename, formats, persistence, settings, worker, EVT_BINARY_STATUS, EVT_UPDATE,
    FEATURE,
};
use crate::premium::{require_premium, EntitlementState};
use tauri::{Emitter, State};

const AUDIO_FORMATS: &[&str] = &["mp3", "m4a", "opus", "wav", "flac"];
const CONTAINERS: &[&str] = &["mp4", "mkv", "webm"];
/// Refuse to start a download with less than 500 MB free on the target volume.
const MIN_FREE_BYTES: u64 = 500 * 1024 * 1024;

fn check_disk_space(dir: &str) -> Result<(), String> {
    if let Some(free) = settings::free_disk_space(dir) {
        if free < MIN_FREE_BYTES {
            return Err("disk_space_low".into());
        }
    }
    Ok(())
}

fn validate_url(url: &str) -> Result<String, String> {
    let u = url.trim();
    if u.len() > 2048 {
        return Err("url_too_long".into());
    }
    if !(u.starts_with("https://") || u.starts_with("http://")) {
        return Err("url_scheme_not_allowed".into());
    }
    if u.chars().any(|c| c.is_whitespace() || (c as u32) < 0x20) {
        return Err("url_invalid_chars".into());
    }
    Ok(u.to_string())
}

fn validate_format_selector(sel: &str) -> Result<String, String> {
    let s = sel.trim();
    if s.is_empty() || s.len() > 200 {
        return Err("format_selector_invalid".into());
    }
    let ok = s.chars().all(|c| {
        c.is_ascii_alphanumeric()
            || matches!(c, '[' | ']' | '<' | '>' | '=' | '+' | '/' | '.' | '-' | '_' | ',' | '*' | '?' | '!')
    });
    if !ok {
        return Err("format_selector_invalid".into());
    }
    Ok(s.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchInfoResponse {
    pub info: formats::VideoInfo,
    pub presets: Vec<formats::Preset>,
}

#[tauri::command]
pub async fn dl_fetch_info(
    app: tauri::AppHandle,
    premium: State<'_, EntitlementState>,
    url: String,
) -> Result<FetchInfoResponse, String> {
    require_premium(&premium, FEATURE)?;
    let url = validate_url(&url)?;
    let (ytdlp, _ffmpeg) = super::resolve_binaries(&app)?;
    let (info, presets) = worker::fetch_info(ytdlp, url).await?;
    Ok(FetchInfoResponse { info, presets })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDownloadArgs {
    pub url: String,
    pub format_selector: String,
    /// "video" | "audio"
    pub kind: String,
    pub audio_format: Option<String>,
    pub container: Option<String>,
    pub output_dir: String,
    pub filename: Option<String>,
    pub preset_id: Option<String>,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
}

#[tauri::command]
pub async fn dl_start(
    app: tauri::AppHandle,
    premium: State<'_, EntitlementState>,
    dl: State<'_, DlState>,
    args: StartDownloadArgs,
) -> Result<String, String> {
    require_premium(&premium, FEATURE)?;

    // --- validate every field ---
    let url = validate_url(&args.url)?;
    let format_selector = validate_format_selector(&args.format_selector)?;
    let kind = match args.kind.as_str() {
        "video" | "audio" => args.kind.clone(),
        _ => return Err("kind_invalid".into()),
    };
    let audio_format = match &args.audio_format {
        None => None,
        Some(af) if AUDIO_FORMATS.contains(&af.as_str()) => Some(af.clone()),
        Some(_) => return Err("audio_format_invalid".into()),
    };
    let container = match &args.container {
        None => None,
        Some(c) if CONTAINERS.contains(&c.as_str()) => Some(c.clone()),
        Some(_) => return Err("container_invalid".into()),
    };
    settings::validate_output_dir(&args.output_dir)?;
    check_disk_space(&args.output_dir)?;
    let filename = match args.filename.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(name) => Some(filename::sanitize(name)?),
    };
    let (ytdlp, ffmpeg) = super::resolve_binaries(&app)?;

    // --- create + register the task ---
    let task_id = uuid::Uuid::new_v4().to_string();
    let task = DownloadTask {
        id: task_id.clone(),
        url: url.clone(),
        title: args.title.clone(),
        thumbnail: args.thumbnail.clone(),
        preset_id: args.preset_id.clone().unwrap_or_else(|| "custom".into()),
        status: DownloadStatus::Queued,
        percent: 0.0,
        speed: None,
        eta: None,
        output_dir: args.output_dir.clone(),
        filename: filename.clone(),
        output_path: None,
        created_at: crate::premium::license::now_unix(),
    };
    {
        let mut mgr = dl.manager.lock().map_err(|_| "state_poisoned".to_string())?;
        // Cap queue size to keep memory + child processes sane.
        let active = mgr
            .tasks
            .values()
            .filter(|t| matches!(t.status, DownloadStatus::Queued | DownloadStatus::Downloading | DownloadStatus::Muxing))
            .count();
        if active >= 20 {
            return Err("queue_full".into());
        }
        mgr.tasks.insert(task_id.clone(), task.clone());
        mgr.specs.insert(
            task_id.clone(),
            JobSpec {
                url: url.clone(),
                format_selector: format_selector.clone(),
                kind: kind.clone(),
                audio_format: audio_format.clone(),
                container: container.clone(),
                output_dir: args.output_dir.clone(),
                filename: filename.clone(),
            },
        );
    }
    let _ = app.emit(EVT_UPDATE, task);
    persistence::persist(&app);

    // --- hand off to the worker ---
    let job = worker::DownloadJob {
        task_id: task_id.clone(),
        url,
        format_selector,
        kind,
        audio_format,
        container,
        output_dir: args.output_dir,
        filename,
        ytdlp,
        ffmpeg,
    };
    tauri::async_runtime::spawn(worker::run(app.clone(), job));
    Ok(task_id)
}

#[tauri::command]
pub fn dl_cancel(
    app: tauri::AppHandle,
    premium: State<'_, EntitlementState>,
    dl: State<'_, DlState>,
    task_id: String,
) -> Result<(), String> {
    require_premium(&premium, FEATURE)?;

    let (pid, was_queued) = {
        let mut mgr = dl.manager.lock().map_err(|_| "state_poisoned".to_string())?;
        if !mgr.tasks.contains_key(&task_id) {
            return Err("task_not_found".into());
        }
        mgr.cancelled.insert(task_id.clone());
        let was_queued = mgr
            .tasks
            .get(&task_id)
            .map(|t| t.status == DownloadStatus::Queued)
            .unwrap_or(false);
        (mgr.pids.get(&task_id).copied(), was_queued)
    };

    if let Some(pid) = pid {
        kill_process_tree(pid);
        // Worker observes the non-zero exit + cancelled flag and finalizes.
    } else if was_queued {
        // Never started — finalize immediately.
        let snap = dl.update_task(&task_id, |t| t.status = DownloadStatus::Cancelled);
        if let Some(task) = snap {
            let _ = app.emit(EVT_UPDATE, task);
        }
        persistence::persist(&app);
    }
    Ok(())
}

/// Re-launch a terminal (failed/cancelled/interrupted) task from its stored
/// spec as a NEW task. Works across app restarts thanks to persistence.
#[tauri::command]
pub fn dl_retry(
    app: tauri::AppHandle,
    premium: State<'_, EntitlementState>,
    dl: State<'_, DlState>,
    task_id: String,
) -> Result<String, String> {
    require_premium(&premium, FEATURE)?;

    let (spec, old) = {
        let mgr = dl.manager.lock().map_err(|_| "state_poisoned".to_string())?;
        let old = mgr.tasks.get(&task_id).ok_or("task_not_found")?.clone();
        if !matches!(
            old.status,
            DownloadStatus::Done | DownloadStatus::Cancelled | DownloadStatus::Error { .. }
        ) {
            return Err("task_still_active".into());
        }
        let spec = mgr.specs.get(&task_id).cloned().ok_or("retry_unavailable")?;
        (spec, old)
    };

    settings::validate_output_dir(&spec.output_dir)?;
    check_disk_space(&spec.output_dir)?;
    let (ytdlp, ffmpeg) = super::resolve_binaries(&app)?;

    let new_id = uuid::Uuid::new_v4().to_string();
    let task = DownloadTask {
        id: new_id.clone(),
        url: spec.url.clone(),
        title: old.title.clone(),
        thumbnail: old.thumbnail.clone(),
        preset_id: old.preset_id.clone(),
        status: DownloadStatus::Queued,
        percent: 0.0,
        speed: None,
        eta: None,
        output_dir: spec.output_dir.clone(),
        filename: spec.filename.clone(),
        output_path: None,
        created_at: crate::premium::license::now_unix(),
    };
    {
        let mut mgr = dl.manager.lock().map_err(|_| "state_poisoned".to_string())?;
        mgr.tasks.insert(new_id.clone(), task.clone());
        mgr.specs.insert(new_id.clone(), spec.clone());
    }
    let _ = app.emit(EVT_UPDATE, task);
    persistence::persist(&app);

    tauri::async_runtime::spawn(worker::run(
        app.clone(),
        worker::DownloadJob {
            task_id: new_id.clone(),
            url: spec.url,
            format_selector: spec.format_selector,
            kind: spec.kind,
            audio_format: spec.audio_format,
            container: spec.container,
            output_dir: spec.output_dir,
            filename: spec.filename,
            ytdlp,
            ffmpeg,
        },
    ));
    Ok(new_id)
}

/// Kill yt-dlp AND any ffmpeg children (`/T` = tree, `/F` = force).
fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
    }
}

#[tauri::command]
pub fn dl_get_queue(
    premium: State<'_, EntitlementState>,
    dl: State<'_, DlState>,
) -> Result<Vec<DownloadTask>, String> {
    require_premium(&premium, FEATURE)?;
    Ok(dl.snapshot())
}

#[tauri::command]
pub fn dl_clear_done(
    app: tauri::AppHandle,
    premium: State<'_, EntitlementState>,
    dl: State<'_, DlState>,
) -> Result<(), String> {
    require_premium(&premium, FEATURE)?;
    {
        let mut mgr = dl.manager.lock().map_err(|_| "state_poisoned".to_string())?;
        mgr.tasks.retain(|_, t| {
            !matches!(
                t.status,
                DownloadStatus::Done | DownloadStatus::Cancelled | DownloadStatus::Error { .. }
            )
        });
        let ids: Vec<String> = mgr.tasks.keys().cloned().collect();
        mgr.cancelled.retain(|id| ids.contains(id));
        mgr.specs.retain(|id, _| ids.contains(id));
    }
    persistence::persist(&app);
    Ok(())
}

#[tauri::command]
pub fn dl_get_settings(
    app: tauri::AppHandle,
    premium: State<'_, EntitlementState>,
) -> Result<settings::DownloadSettings, String> {
    require_premium(&premium, FEATURE)?;
    Ok(settings::load(&app))
}

#[tauri::command]
pub fn dl_set_settings(
    app: tauri::AppHandle,
    premium: State<'_, EntitlementState>,
    new_settings: settings::DownloadSettings,
) -> Result<(), String> {
    require_premium(&premium, FEATURE)?;
    settings::validate_output_dir(&new_settings.output_dir)?;
    if new_settings.concurrent_limit == 0 || new_settings.concurrent_limit > 8 {
        return Err("concurrent_limit_invalid".into());
    }
    settings::save(&app, &new_settings)
    // Note: a changed concurrent_limit applies after app restart (semaphore
    // is sized at init). Documented; revisit in Phase 5 if needed.
}

#[tauri::command]
pub fn dl_open_output_dir(
    app: tauri::AppHandle,
    premium: State<'_, EntitlementState>,
) -> Result<(), String> {
    require_premium(&premium, FEATURE)?;
    let dir = settings::load(&app).output_dir;
    settings::validate_output_dir(&dir)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer")
            .arg(&dir)
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|e| format!("explorer: {e}"))?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryStatus {
    pub ok: bool,
    pub ytdlp_path: Option<String>,
    pub ytdlp_version: Option<String>,
    pub ffmpeg_path: Option<String>,
    pub ffmpeg_version: Option<String>,
    pub managed: bool,
}

#[tauri::command]
pub async fn dl_check_binaries(
    app: tauri::AppHandle,
    premium: State<'_, EntitlementState>,
) -> Result<BinaryStatus, String> {
    require_premium(&premium, FEATURE)?;
    let resolved = binary::resolve(&app);
    let Ok((ytdlp, ffmpeg)) = resolved else {
        let status = BinaryStatus {
            ok: false,
            ytdlp_path: None,
            ytdlp_version: None,
            ffmpeg_path: None,
            ffmpeg_version: None,
            managed: false,
        };
        let _ = app.emit(EVT_BINARY_STATUS, &status);
        return Ok(status);
    };
    let ytdlp_version = binary::probe_version(&ytdlp, &["--version"]).await;
    let ffmpeg_version = binary::probe_version(&ffmpeg, &["-version"]).await;
    let managed = binary::managed_bin_dir(&app)
        .map(|d| ytdlp.starts_with(&d))
        .unwrap_or(false);
    let status = BinaryStatus {
        ok: ytdlp_version.is_some() && ffmpeg_version.is_some(),
        ytdlp_path: Some(ytdlp.display().to_string()),
        ytdlp_version,
        ffmpeg_path: Some(ffmpeg.display().to_string()),
        ffmpeg_version,
        managed,
    };
    let _ = app.emit(EVT_BINARY_STATUS, &status);
    Ok(status)
}

/// Self-update the MANAGED yt-dlp copy (`yt-dlp -U`), then re-emit binary
/// status. Returns yt-dlp's summary line.
#[tauri::command]
pub async fn dl_update_ytdlp(
    app: tauri::AppHandle,
    premium: State<'_, EntitlementState>,
) -> Result<String, String> {
    require_premium(&premium, FEATURE)?;
    let summary = binary::self_update_ytdlp(&app).await?;
    // Refresh status for any listening UI.
    if let Ok((ytdlp, _)) = binary::resolve(&app) {
        if let Some(v) = binary::probe_version(&ytdlp, &["--version"]).await {
            let _ = app.emit(
                EVT_BINARY_STATUS,
                serde_json::json!({ "ok": true, "ytdlpPath": ytdlp.display().to_string(), "ytdlpVersion": v }),
            );
        }
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_validation() {
        assert!(validate_url("https://youtube.com/watch?v=x").is_ok());
        assert!(validate_url("  https://a.b/c  ").is_ok());
        assert!(validate_url("file:///etc/passwd").is_err());
        assert!(validate_url("ftp://x").is_err());
        assert!(validate_url("-x https://evil").is_err());
        assert!(validate_url("https://a b").is_err());
        assert!(validate_url(&format!("https://a/{}", "x".repeat(3000))).is_err());
    }

    #[test]
    fn format_selector_validation() {
        assert!(validate_format_selector("bestvideo+bestaudio/best").is_ok());
        assert!(
            validate_format_selector("bestvideo[height<=1080]+bestaudio/best[height<=1080]")
                .is_ok()
        );
        assert!(validate_format_selector("bestaudio[ext=m4a]/bestaudio/best").is_ok());
        // Injection attempts.
        assert!(validate_format_selector("best --exec calc.exe").is_err());
        assert!(validate_format_selector("best\"; rm -rf").is_err());
        assert!(validate_format_selector("").is_err());
        assert!(validate_format_selector(&"b".repeat(300)).is_err());
    }
}
