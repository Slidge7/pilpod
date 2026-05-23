use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use super::binary::{self, BinaryStatus};
use super::formats::{self, VideoInfoWithPresets};
use super::settings;
use super::state::{DownloadManagerState, DownloadStatus, DownloadTask};
use super::worker;

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ─── Info / metadata ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dl_fetch_info(
    url: String,
    app_handle: AppHandle,
) -> Result<VideoInfoWithPresets, String> {
    let ytdlp = binary::ytdlp_path(&app_handle);
    if !ytdlp.exists() {
        return Err("yt-dlp not found. Run fetch-binaries.ps1 or use the install button.".into());
    }

    let out = tokio::process::Command::new(&ytdlp)
        .args(["--dump-json", "--no-playlist", &url])
        .output()
        .await
        .map_err(|e| format!("Failed to run yt-dlp: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(format!("yt-dlp error: {stderr}"));
    }

    let json = String::from_utf8_lossy(&out.stdout);
    let info = formats::parse_video_info(&json)?;
    Ok(formats::into_with_presets(info))
}

// ─── Queue management ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dl_start(
    url: String,
    format_id: String,
    audio_only: bool,
    audio_format: Option<String>,
    app_handle: AppHandle,
    state: State<'_, DownloadManagerState>,
) -> Result<String, String> {
    let task_id = uuid::Uuid::new_v4().to_string();

    let (should_start, output_dir, ytdlp_path, ffmpeg_path) = {
        let mut mgr = state.lock().unwrap();
        let output_dir = mgr.settings.output_dir.clone();
        let can = mgr.can_start();
        if can {
            mgr.active_count += 1;
        }

        let task = DownloadTask {
            id: task_id.clone(),
            url: url.clone(),
            title: None,
            thumbnail: None,
            status: if can {
                DownloadStatus::Downloading
            } else {
                DownloadStatus::Queued
            },
            percent: 0.0,
            speed: None,
            eta: None,
            output_path: None,
            format_id: Some(format_id.clone()),
            audio_only,
            audio_format: audio_format.clone(),
            created_at: unix_now(),
        };

        mgr.tasks.insert(task_id.clone(), task.clone());
        mgr.queued_order.push(task_id.clone());

        (
            can,
            output_dir,
            binary::ytdlp_path(&app_handle),
            binary::ffmpeg_path(&app_handle),
        )
    };

    // Emit initial task state.
    if let Some(task) = state.lock().unwrap().tasks.get(&task_id).cloned() {
        let _ = app_handle.emit("dl://update", task);
    }

    if should_start {
        let state_arc = Arc::clone(&*state);
        let app2 = app_handle.clone();
        tokio::spawn(worker::run_download(
            task_id.clone(),
            url,
            format_id,
            audio_only,
            audio_format,
            output_dir,
            ytdlp_path,
            ffmpeg_path,
            state_arc,
            app2,
        ));
    }

    Ok(task_id)
}

#[tauri::command]
pub fn dl_cancel(
    task_id: String,
    state: State<'_, DownloadManagerState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let pid = {
        let mut mgr = state.lock().unwrap();
        if let Some(task) = mgr.tasks.get_mut(&task_id) {
            task.status = DownloadStatus::Cancelled;
        }
        mgr.child_pids.remove(&task_id)
    };

    if let Some(pid) = pid {
        // Kill the yt-dlp process tree on Windows.
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }

    if let Some(task) = state.lock().unwrap().tasks.get(&task_id).cloned() {
        let _ = app_handle.emit("dl://update", task);
    }

    Ok(())
}

#[tauri::command]
pub fn dl_get_queue(state: State<'_, DownloadManagerState>) -> Vec<DownloadTask> {
    let mgr = state.lock().unwrap();
    // Return in insertion order.
    mgr.queued_order
        .iter()
        .filter_map(|id| mgr.tasks.get(id).cloned())
        .collect()
}

#[tauri::command]
pub fn dl_clear_done(state: State<'_, DownloadManagerState>) {
    let mut mgr = state.lock().unwrap();
    mgr.tasks.retain(|_, t| {
        !matches!(
            t.status,
            DownloadStatus::Done | DownloadStatus::Cancelled | DownloadStatus::Error(_)
        )
    });
    let remaining: std::collections::HashSet<String> = mgr.tasks.keys().cloned().collect();
    mgr.queued_order.retain(|id| remaining.contains(id));
}

// ─── Output directory ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn dl_get_output_dir(state: State<'_, DownloadManagerState>) -> String {
    state.lock().unwrap().settings.output_dir.clone()
}

#[tauri::command]
pub fn dl_set_output_dir(
    path: String,
    state: State<'_, DownloadManagerState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let mut mgr = state.lock().unwrap();
    mgr.settings.output_dir = path;
    settings::save(&app_handle, &mgr.settings)
}

#[tauri::command]
pub fn dl_open_output_dir(state: State<'_, DownloadManagerState>) -> Result<(), String> {
    let dir = state.lock().unwrap().settings.output_dir.clone();
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("Could not open folder: {e}"))?;
    Ok(())
}

// ─── Binary management ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dl_check_binaries(app_handle: AppHandle) -> BinaryStatus {
    binary::check_binaries(&app_handle).await
}

#[tauri::command]
pub async fn dl_update_ytdlp(app_handle: AppHandle) -> Result<(), String> {
    let ytdlp = binary::ytdlp_path(&app_handle);
    if !ytdlp.exists() {
        return Err("yt-dlp not found".into());
    }

    let bin_dir = binary::bin_dir(&app_handle);
    let out = tokio::process::Command::new(&ytdlp)
        .arg("-U")
        .current_dir(&bin_dir)
        .output()
        .await
        .map_err(|e| format!("Failed to run yt-dlp: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(format!("yt-dlp update failed: {stderr}"));
    }

    // Emit updated binary status.
    let status = binary::check_binaries(&app_handle).await;
    let _ = app_handle.emit("dl://binary-status", &status);

    Ok(())
}
