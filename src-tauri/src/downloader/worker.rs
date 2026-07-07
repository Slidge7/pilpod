//! Async download execution: spawns yt-dlp, parses progress from stdout,
//! emits `dl://*` events, and reports terminal status back into `DlState`.

use super::formats::{self, Preset, VideoInfo};
use super::state::{DlState, DownloadStatus, DownloadTask};
use super::{EVT_COMPLETE, EVT_ERROR, EVT_PROGRESS, EVT_UPDATE};
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Everything the worker needs; validated and assembled by `commands.rs` —
/// the frontend can never inject raw process arguments.
pub struct DownloadJob {
    pub task_id: String,
    pub url: String,
    pub format_selector: String,
    /// "video" | "audio" (validated upstream).
    pub kind: String,
    pub audio_format: Option<String>,
    pub container: Option<String>,
    pub output_dir: String,
    /// Pre-sanitized (filename::sanitize) or None ⇒ %(title)s.
    pub filename: Option<String>,
    pub ytdlp: PathBuf,
    pub ffmpeg: PathBuf,
}

fn base_command(ytdlp: &PathBuf) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(ytdlp);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// `yt-dlp --dump-json` with a timeout. Used by `dl_fetch_info`.
pub async fn fetch_info(
    ytdlp: PathBuf,
    url: String,
) -> Result<(VideoInfo, Vec<Preset>), String> {
    let mut cmd = base_command(&ytdlp);
    cmd.args(["--dump-json", "--no-playlist", "--no-warnings", "--"])
        .arg(&url);

    let output = tokio::time::timeout(std::time::Duration::from_secs(45), cmd.output())
        .await
        .map_err(|_| "fetch_info_timeout".to_string())?
        .map_err(|e| format!("spawn_failed: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "fetch_info_failed: {}",
            tail_of(&String::from_utf8_lossy(&output.stderr), 500)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let info = formats::parse_dump_json(stdout.trim())?;
    let presets = formats::build_presets(&info);
    Ok((info, presets))
}

/// Long-running download worker. Spawned via `tauri::async_runtime::spawn`.
pub async fn run(app: tauri::AppHandle, job: DownloadJob) {
    // Respect the concurrency limit; task stays Queued (already emitted).
    let semaphore = app.state::<DlState>().semaphore.clone();
    let _permit = match semaphore.acquire_owned().await {
        Ok(p) => p,
        Err(_) => return, // semaphore closed = shutdown
    };

    // Bail out if the user cancelled while we were queued.
    if app.state::<DlState>().is_cancelled(&job.task_id) {
        set_status_and_emit(&app, &job.task_id, DownloadStatus::Cancelled);
        return;
    }

    let mut cmd = base_command(&job.ytdlp);
    cmd.args(["--newline", "--no-playlist", "--no-warnings"])
        .args([
            "--progress-template",
            "dl:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
        ])
        .arg("--ffmpeg-location")
        .arg(&job.ffmpeg)
        .args(["-f", &job.format_selector]);

    if job.kind == "audio" {
        if let Some(af) = &job.audio_format {
            cmd.args(["--extract-audio", "--audio-format", af]);
        }
    } else if let Some(container) = &job.container {
        cmd.args(["--merge-output-format", container]);
    }

    let name_part = job.filename.as_deref().unwrap_or("%(title)s");
    let template = format!("{}\\{}.%(ext)s", job.output_dir.trim_end_matches('\\'), name_part);
    cmd.arg("-o").arg(&template).arg("--").arg(&job.url);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            finish_error(&app, &job.task_id, format!("spawn_failed: {e}"));
            return;
        }
    };

    // Record PID for cancel/kill-tree, flip status to Downloading.
    if let Some(pid) = child.id() {
        if let Ok(mut mgr) = app.state::<DlState>().manager.lock() {
            mgr.pids.insert(job.task_id.clone(), pid);
        }
    }
    set_status_and_emit(&app, &job.task_id, DownloadStatus::Downloading);

    // Drain stderr concurrently (keep the tail for error reporting).
    let stderr_handle = child.stderr.take().map(|mut s| {
        tauri::async_runtime::spawn(async move {
            let mut buf = String::new();
            let _ = s.read_to_string(&mut buf).await;
            buf
        })
    });

    // Parse stdout line by line.
    if let Some(stdout) = child.stdout.take() {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            handle_stdout_line(&app, &job.task_id, &line);
        }
    }

    let exit = child.wait().await;
    let stderr_tail = match stderr_handle {
        Some(h) => h.await.unwrap_or_default(),
        None => String::new(),
    };

    // Drop PID entry.
    let (cancelled, output_path) = {
        let state = app.state::<DlState>();
        let mut mgr = state.manager.lock().ok();
        if let Some(m) = mgr.as_deref_mut() {
            m.pids.remove(&job.task_id);
        }
        let cancelled = mgr
            .as_deref()
            .map(|m| m.cancelled.contains(&job.task_id))
            .unwrap_or(false);
        let output_path = mgr
            .as_deref()
            .and_then(|m| m.tasks.get(&job.task_id))
            .and_then(|t| t.output_path.clone());
        (cancelled, output_path)
    };

    match exit {
        Ok(status) if status.success() && !cancelled => {
            let snap = app.state::<DlState>().update_task(&job.task_id, |t| {
                t.status = DownloadStatus::Done;
                t.percent = 100.0;
                t.speed = None;
                t.eta = None;
            });
            emit_update(&app, snap);
            let _ = app.emit(
                EVT_COMPLETE,
                serde_json::json!({ "id": job.task_id, "outputPath": output_path }),
            );
        }
        _ if cancelled => {
            cleanup_partials(output_path.as_deref());
            set_status_and_emit(&app, &job.task_id, DownloadStatus::Cancelled);
        }
        Ok(status) => {
            finish_error(
                &app,
                &job.task_id,
                format!("exit {}: {}", status, tail_of(&stderr_tail, 500)),
            );
        }
        Err(e) => finish_error(&app, &job.task_id, format!("wait_failed: {e}")),
    }

    // Snapshot the queue for crash recovery.
    super::persistence::persist(&app);
}

fn handle_stdout_line(app: &tauri::AppHandle, task_id: &str, line: &str) {
    if let Some((percent, speed, eta)) = parse_progress_line(line) {
        let snap = app.state::<DlState>().update_task(task_id, |t| {
            t.percent = percent;
            t.speed = speed.clone();
            t.eta = eta.clone();
            if t.status == DownloadStatus::Queued {
                t.status = DownloadStatus::Downloading;
            }
        });
        if snap.is_some() {
            let _ = app.emit(
                EVT_PROGRESS,
                serde_json::json!({ "id": task_id, "percent": percent, "speed": speed, "eta": eta }),
            );
        }
        return;
    }

    if line.starts_with("[Merger]") || line.starts_with("[ExtractAudio]") {
        // Merging / transcoding phase.
        if let Some(dest) = extract_destination(line) {
            let _ = app
                .state::<DlState>()
                .update_task(task_id, |t| t.output_path = Some(dest.clone()));
        }
        set_status_and_emit(app, task_id, DownloadStatus::Muxing);
        return;
    }

    if let Some(dest) = line.strip_prefix("[download] Destination: ") {
        let dest = dest.trim().to_string();
        let snap = app
            .state::<DlState>()
            .update_task(task_id, |t| t.output_path = Some(dest.clone()));
        emit_update(app, snap);
    }
}

/// Parses `dl:  42.3%|  8.31MiB/s|00:12` lines from our progress template.
/// Returns None for non-progress lines and unparseable percents.
pub fn parse_progress_line(line: &str) -> Option<(f32, Option<String>, Option<String>)> {
    let rest = line.strip_prefix("dl:")?;
    let mut parts = rest.splitn(3, '|');
    let percent_raw = parts.next()?.trim().trim_end_matches('%').trim();
    let percent: f32 = percent_raw.parse().ok()?;
    let clean = |s: Option<&str>| {
        s.map(str::trim)
            .filter(|v| !v.is_empty() && *v != "N/A" && *v != "Unknown")
            .map(String::from)
    };
    let speed = clean(parts.next());
    let eta = clean(parts.next());
    Some((percent.clamp(0.0, 100.0), speed, eta))
}

/// Pulls the quoted path out of `[Merger] Merging formats into "C:\x\y.mp4"`
/// or the plain path in `[ExtractAudio] Destination: C:\x\y.mp3`.
pub fn extract_destination(line: &str) -> Option<String> {
    if let Some(idx) = line.find("into \"") {
        let rest = &line[idx + 6..];
        return rest.split('"').next().map(String::from);
    }
    line.split("Destination: ")
        .nth(1)
        .map(|s| s.trim().to_string())
}

fn cleanup_partials(output_path: Option<&str>) {
    if let Some(p) = output_path {
        let _ = std::fs::remove_file(p);
        let _ = std::fs::remove_file(format!("{p}.part"));
        let _ = std::fs::remove_file(format!("{p}.ytdl"));
    }
}

fn tail_of(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.len() <= max {
        t.to_string()
    } else {
        let start = t.len() - max;
        // Snap to a char boundary.
        let mut start = start;
        while !t.is_char_boundary(start) {
            start += 1;
        }
        format!("…{}", &t[start..])
    }
}

fn set_status_and_emit(app: &tauri::AppHandle, task_id: &str, status: DownloadStatus) {
    let snap = app.state::<DlState>().update_task(task_id, |t| {
        t.status = status;
        if matches!(t.status, DownloadStatus::Cancelled) {
            t.speed = None;
            t.eta = None;
        }
    });
    emit_update(app, snap);
}

fn finish_error(app: &tauri::AppHandle, task_id: &str, message: String) {
    let snap = app.state::<DlState>().update_task(task_id, |t| {
        t.status = DownloadStatus::Error {
            message: message.clone(),
        };
        t.speed = None;
        t.eta = None;
    });
    emit_update(app, snap);
    let _ = app.emit(EVT_ERROR, serde_json::json!({ "id": task_id, "message": message }));
}

fn emit_update(app: &tauri::AppHandle, snap: Option<DownloadTask>) {
    if let Some(task) = snap {
        let _ = app.emit(EVT_UPDATE, task);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_lines_parse() {
        let (p, s, e) = parse_progress_line("dl:  42.3%|  8.31MiB/s|00:12").unwrap();
        assert!((p - 42.3).abs() < 0.001);
        assert_eq!(s.as_deref(), Some("8.31MiB/s"));
        assert_eq!(e.as_deref(), Some("00:12"));

        let (p, s, e) = parse_progress_line("dl:100.0%|N/A|N/A").unwrap();
        assert_eq!(p, 100.0);
        assert!(s.is_none() && e.is_none());
    }

    #[test]
    fn non_progress_lines_ignored() {
        assert!(parse_progress_line("[download] Destination: C:\\x.mp4").is_none());
        assert!(parse_progress_line("dl:garbage|x|y").is_none());
        assert!(parse_progress_line("").is_none());
    }

    #[test]
    fn percent_clamped() {
        let (p, _, _) = parse_progress_line("dl:120.0%|a|b").unwrap();
        assert_eq!(p, 100.0);
    }

    #[test]
    fn destination_extraction() {
        assert_eq!(
            extract_destination(r#"[Merger] Merging formats into "C:\dl\vid.mp4""#).unwrap(),
            r"C:\dl\vid.mp4"
        );
        assert_eq!(
            extract_destination(r"[ExtractAudio] Destination: C:\dl\song.mp3").unwrap(),
            r"C:\dl\song.mp3"
        );
        assert!(extract_destination("[Merger] something else").is_none());
    }

    #[test]
    fn tail_of_respects_char_boundaries() {
        let s = "é".repeat(400);
        let t = tail_of(&s, 100);
        // "…" is 3 bytes in UTF-8; payload is ≤100 bytes snapped forward to
        // a char boundary.
        assert!(t.len() <= 100 + '…'.len_utf8());
        assert!(t.starts_with('…'));
        assert!(t.chars().skip(1).all(|c| c == 'é')); // no broken chars
        assert_eq!(tail_of("short", 100), "short");
    }
}
