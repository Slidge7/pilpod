use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

use super::state::{DownloadManagerState, DownloadStatus, DownloadTask};

// ─── Event payloads ──────────────────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
pub struct ProgressPayload {
    pub id: String,
    pub percent: f32,
    pub speed: Option<String>,
    pub eta: Option<String>,
}

#[derive(serde::Serialize, Clone)]
pub struct CompletePayload {
    pub id: String,
    pub output_path: Option<String>,
}

#[derive(serde::Serialize, Clone)]
pub struct ErrorPayload {
    pub id: String,
    pub message: String,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn emit_task(app: &AppHandle, task: DownloadTask) {
    let _ = app.emit("dl://update", task);
}

fn emit_progress(app: &AppHandle, payload: ProgressPayload) {
    let _ = app.emit("dl://progress", payload);
}

fn set_status(state: &DownloadManagerState, id: &str, status: DownloadStatus) -> Option<DownloadTask> {
    let mut mgr = state.lock().unwrap();
    if let Some(task) = mgr.tasks.get_mut(id) {
        task.status = status;
        return Some(task.clone());
    }
    None
}

fn get_task(state: &DownloadManagerState, id: &str) -> Option<DownloadTask> {
    state.lock().unwrap().tasks.get(id).cloned()
}

fn is_cancelled(state: &DownloadManagerState, id: &str) -> bool {
    matches!(
        state.lock().unwrap().tasks.get(id).map(|t| &t.status),
        Some(DownloadStatus::Cancelled)
    )
}

/// Parse a progress-template line: "XX.X%|speed|eta"
fn parse_progress(line: &str) -> Option<(f32, Option<String>, Option<String>)> {
    let trimmed = line.trim();
    let parts: Vec<&str> = trimmed.splitn(3, '|').collect();
    if parts.len() != 3 {
        return None;
    }
    let pct_str = parts[0].trim();
    if !pct_str.ends_with('%') {
        return None;
    }
    let pct = pct_str.trim_end_matches('%').trim().parse::<f32>().ok()?;
    let clean = |s: &str| -> Option<String> {
        let s = s.trim();
        if s.is_empty() || s == "NA" || s == "Unknown" || s == "N/A" {
            None
        } else {
            Some(s.to_string())
        }
    };
    Some((pct, clean(parts[1]), clean(parts[2])))
}

/// After a worker finishes (success or error), decrement active_count and
/// start the next queued task if one exists.
fn finish_worker(
    state: &DownloadManagerState,
    finished_id: &str,
    app: &AppHandle,
    ytdlp_path: PathBuf,
    ffmpeg_path: PathBuf,
) {
    let next = {
        let mut mgr = state.lock().unwrap();
        mgr.child_pids.remove(finished_id);
        if mgr.active_count > 0 {
            mgr.active_count -= 1;
        }
        // If there's a queued task and capacity available, grab it.
        if mgr.can_start() {
            mgr.next_queued_id()
        } else {
            None
        }
    };

    if let Some(next_id) = next {
        // Retrieve params from the queued task.
        let (url, format_id, audio_only, audio_format, output_dir) = {
            let mut mgr = state.lock().unwrap();
            if let Some(task) = mgr.tasks.get(&next_id).cloned() {
                if let Some(t) = mgr.tasks.get_mut(&next_id) {
                    t.status = DownloadStatus::Downloading;
                }
                mgr.active_count += 1;
                (
                    task.url.clone(),
                    task.format_id.clone().unwrap_or_default(),
                    task.audio_only,
                    task.audio_format.clone(),
                    mgr.settings.output_dir.clone(),
                )
            } else {
                return;
            }
        };

        let state2 = std::sync::Arc::clone(state);
        let app2 = app.clone();
        tokio::spawn(run_download(
            next_id,
            url,
            format_id,
            audio_only,
            audio_format,
            output_dir,
            ytdlp_path,
            ffmpeg_path,
            state2,
            app2,
        ));
    }
}

// ─── Main worker ─────────────────────────────────────────────────────────────

pub async fn run_download(
    task_id: String,
    url: String,
    format_id: String,
    audio_only: bool,
    audio_format: Option<String>,
    output_dir: String,
    ytdlp_path: PathBuf,
    ffmpeg_path: PathBuf,
    state: DownloadManagerState,
    app: AppHandle,
) {
    // Ensure output dir exists.
    let _ = std::fs::create_dir_all(&output_dir);

    // Mark as Downloading and emit.
    if let Some(task) = set_status(&state, &task_id, DownloadStatus::Downloading) {
        emit_task(&app, task);
    }

    // Build yt-dlp args.
    let mut args: Vec<String> = vec![
        "--format".into(),
        format_id.clone(),
        "--ffmpeg-location".into(),
        ffmpeg_path.to_string_lossy().into_owned(),
        "--newline".into(),
        "--progress-template".into(),
        "%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s".into(),
        "--output".into(),
        format!("{}/%(title)s.%(ext)s", output_dir),
        "--no-playlist".into(),
    ];

    if audio_only {
        args.push("--extract-audio".into());
        if let Some(ref fmt) = audio_format {
            args.push("--audio-format".into());
            args.push(fmt.clone());
        }
    } else {
        args.push("--merge-output-format".into());
        args.push("mp4".into());
    }

    args.push(url.clone());

    let mut child = match tokio::process::Command::new(&ytdlp_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("Failed to spawn yt-dlp: {e}");
            let mut mgr = state.lock().unwrap();
            if let Some(task) = mgr.tasks.get_mut(&task_id) {
                task.status = DownloadStatus::Error(msg.clone());
                let snap = task.clone();
                drop(mgr);
                emit_task(&app, snap);
                let _ = app.emit("dl://error", ErrorPayload { id: task_id.clone(), message: msg });
            }
            finish_worker(&state, &task_id, &app, ytdlp_path, ffmpeg_path);
            return;
        }
    };

    // Store PID for cancellation.
    if let Some(pid) = child.id() {
        state.lock().unwrap().child_pids.insert(task_id.clone(), pid);
    }

    // Take stdout/stderr before handing child off.
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    // Read stderr in background.
    let stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        let mut r = BufReader::new(stderr);
        let _ = r.read_to_string(&mut buf).await;
        buf
    });

    // Read stdout line-by-line, parse and emit progress.
    let mut lines = BufReader::new(stdout).lines();
    let mut captured_output_path: Option<String> = None;

    while let Ok(Some(line)) = lines.next_line().await {
        if is_cancelled(&state, &task_id) {
            break;
        }

        if let Some((pct, speed, eta)) = parse_progress(&line) {
            // Update task in-place.
            {
                let mut mgr = state.lock().unwrap();
                if let Some(task) = mgr.tasks.get_mut(&task_id) {
                    task.percent = pct;
                    task.speed = speed.clone();
                    task.eta = eta.clone();
                }
            }
            emit_progress(
                &app,
                ProgressPayload {
                    id: task_id.clone(),
                    percent: pct,
                    speed,
                    eta,
                },
            );
        } else if line.contains("[Merger]") {
            // Switch to Muxing status.
            if let Some(task) = set_status(&state, &task_id, DownloadStatus::Muxing) {
                emit_task(&app, task);
            }
            // Try to capture output path from: Merging formats into "/path/to/file"
            if let Some(idx) = line.find("into \"") {
                let rest = &line[idx + 6..];
                if let Some(end) = rest.rfind('"') {
                    captured_output_path = Some(rest[..end].to_string());
                }
            }
        } else if line.contains("[download] Destination:") {
            // Capture the first destination as a fallback output path.
            if captured_output_path.is_none() {
                if let Some(idx) = line.find("Destination: ") {
                    captured_output_path = Some(line[idx + 13..].trim().to_string());
                }
            }
        }
    }

    // Wait for child to exit.
    let exit_status = child.wait().await;
    let stderr_text = stderr_task.await.unwrap_or_default();

    // Don't override Cancelled.
    if is_cancelled(&state, &task_id) {
        finish_worker(&state, &task_id, &app, ytdlp_path, ffmpeg_path);
        return;
    }

    let success = exit_status.map(|s| s.success()).unwrap_or(false);

    if success {
        {
            let mut mgr = state.lock().unwrap();
            if let Some(task) = mgr.tasks.get_mut(&task_id) {
                task.status = DownloadStatus::Done;
                task.percent = 100.0;
                task.output_path = captured_output_path.clone();
            }
        }
        if let Some(task) = get_task(&state, &task_id) {
            emit_task(&app, task);
        }
        let _ = app.emit(
            "dl://complete",
            CompletePayload {
                id: task_id.clone(),
                output_path: captured_output_path,
            },
        );
    } else {
        let msg = if stderr_text.trim().is_empty() {
            "yt-dlp exited with an error.".to_string()
        } else {
            // Trim long stderr to last 300 chars.
            let trimmed = stderr_text.trim();
            if trimmed.len() > 300 {
                trimmed[trimmed.len() - 300..].to_string()
            } else {
                trimmed.to_string()
            }
        };

        {
            let mut mgr = state.lock().unwrap();
            if let Some(task) = mgr.tasks.get_mut(&task_id) {
                task.status = DownloadStatus::Error(msg.clone());
            }
        }
        if let Some(task) = get_task(&state, &task_id) {
            emit_task(&app, task);
        }
        let _ = app.emit(
            "dl://error",
            ErrorPayload {
                id: task_id.clone(),
                message: msg,
            },
        );
    }

    finish_worker(&state, &task_id, &app, ytdlp_path, ffmpeg_path);
}
