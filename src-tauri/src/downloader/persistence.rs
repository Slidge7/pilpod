//! Crash recovery: the task queue (with launch specs) is snapshotted to
//! `app_data_dir()/download_state.json`. On startup any task that was still
//! active is marked `Error("interrupted")` so the UI can offer Retry —
//! in-flight child processes do not survive an app crash.

use super::state::{DlState, DownloadStatus, DownloadTask, JobSpec};
use tauri::Manager;

const FILE_NAME: &str = "download_state.json";

#[derive(serde::Serialize, serde::Deserialize)]
struct PersistedEntry {
    task: DownloadTask,
    spec: Option<JobSpec>,
}

fn path(handle: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    handle.path().app_data_dir().ok().map(|d| d.join(FILE_NAME))
}

/// Snapshot current tasks + specs. Best effort — failures only log.
pub fn persist(handle: &tauri::AppHandle) {
    let state = handle.state::<DlState>();
    let entries: Vec<PersistedEntry> = {
        let Ok(mgr) = state.manager.lock() else { return };
        mgr.tasks
            .values()
            .map(|t| PersistedEntry {
                task: t.clone(),
                spec: mgr.specs.get(&t.id).cloned(),
            })
            .collect()
    };
    let Some(p) = path(handle) else { return };
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match serde_json::to_string(&entries) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&p, json) {
                log::warn!("[downloader] persist failed: {e}");
            }
        }
        Err(e) => log::warn!("[downloader] persist serialize failed: {e}"),
    }
}

/// Load the previous session's queue into the manager. Active tasks become
/// `Error("interrupted")`. Corrupt/missing file ⇒ empty queue, no error.
pub fn restore_into(state: &DlState, handle: &tauri::AppHandle) {
    let Some(p) = path(handle) else { return };
    let Ok(raw) = std::fs::read_to_string(&p) else { return };
    let Ok(entries) = serde_json::from_str::<Vec<PersistedEntry>>(&raw) else {
        log::warn!("[downloader] download_state.json corrupt — starting fresh");
        return;
    };
    let Ok(mut mgr) = state.manager.lock() else { return };
    let mut interrupted = 0usize;
    for mut e in entries {
        if matches!(
            e.task.status,
            DownloadStatus::Queued | DownloadStatus::Downloading | DownloadStatus::Muxing
        ) {
            e.task.status = DownloadStatus::Error {
                message: "interrupted".into(),
            };
            e.task.speed = None;
            e.task.eta = None;
            interrupted += 1;
        }
        if let Some(spec) = e.spec {
            mgr.specs.insert(e.task.id.clone(), spec);
        }
        mgr.tasks.insert(e.task.id.clone(), e.task);
    }
    if interrupted > 0 {
        log::info!("[downloader] restored queue: {interrupted} interrupted task(s) marked Error");
    }
}
