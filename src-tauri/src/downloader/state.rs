//! In-memory download queue state. Lives in Rust so the React side can crash,
//! remount, or be closed without losing track of running downloads.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::Semaphore;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum DownloadStatus {
    Queued,
    Downloading,
    Muxing,
    Done,
    Cancelled,
    Error { message: String },
}

/// Everything needed to (re-)launch a download — captured at `dl_start`
/// after validation, reused verbatim by `dl_retry` and crash recovery.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSpec {
    pub url: String,
    pub format_selector: String,
    pub kind: String,
    pub audio_format: Option<String>,
    pub container: Option<String>,
    pub output_dir: String,
    pub filename: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    pub id: String,
    pub url: String,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub preset_id: String,
    pub status: DownloadStatus,
    pub percent: f32,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub output_dir: String,
    pub filename: Option<String>,
    pub output_path: Option<String>,
    pub created_at: u64,
}

#[derive(Default)]
pub struct DownloadManager {
    pub tasks: HashMap<String, DownloadTask>,
    /// Launch spec per task, kept for retry and crash recovery.
    pub specs: HashMap<String, JobSpec>,
    /// PID of the running yt-dlp process per task (for cancel/kill-tree).
    pub pids: HashMap<String, u32>,
    /// Tasks the user cancelled — lets the worker distinguish "killed by us"
    /// from a real failure when the child exits non-zero.
    pub cancelled: std::collections::HashSet<String>,
}

/// Managed Tauri state for the downloader.
pub struct DlState {
    pub manager: Mutex<DownloadManager>,
    /// Bounds concurrent yt-dlp processes (permits = settings.concurrent_limit).
    pub semaphore: Arc<Semaphore>,
}

impl DlState {
    pub fn new(concurrent_limit: usize) -> Self {
        Self {
            manager: Mutex::new(DownloadManager::default()),
            semaphore: Arc::new(Semaphore::new(concurrent_limit.max(1))),
        }
    }

    /// Run `f` on a task under the lock; returns a snapshot for emitting
    /// AFTER the lock is released (never emit while holding it).
    pub fn update_task<F>(&self, id: &str, f: F) -> Option<DownloadTask>
    where
        F: FnOnce(&mut DownloadTask),
    {
        let mut mgr = self.manager.lock().ok()?;
        let task = mgr.tasks.get_mut(id)?;
        f(task);
        Some(task.clone())
    }

    pub fn snapshot(&self) -> Vec<DownloadTask> {
        let mgr = match self.manager.lock() {
            Ok(m) => m,
            Err(_) => return Vec::new(),
        };
        let mut v: Vec<DownloadTask> = mgr.tasks.values().cloned().collect();
        v.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        v
    }

    pub fn is_cancelled(&self, id: &str) -> bool {
        self.manager
            .lock()
            .map(|m| m.cancelled.contains(id))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(id: &str, created_at: u64) -> DownloadTask {
        DownloadTask {
            id: id.into(),
            url: "https://example.com/v".into(),
            title: None,
            thumbnail: None,
            preset_id: "best".into(),
            status: DownloadStatus::Queued,
            percent: 0.0,
            speed: None,
            eta: None,
            output_dir: "C:\\Downloads".into(),
            filename: None,
            output_path: None,
            created_at,
        }
    }

    #[test]
    fn update_task_returns_snapshot() {
        let state = DlState::new(2);
        state.manager.lock().unwrap().tasks.insert("a".into(), task("a", 1));
        let snap = state
            .update_task("a", |t| {
                t.status = DownloadStatus::Downloading;
                t.percent = 42.5;
            })
            .unwrap();
        assert_eq!(snap.status, DownloadStatus::Downloading);
        assert_eq!(snap.percent, 42.5);
        // Unknown id → None, no panic.
        assert!(state.update_task("nope", |_| {}).is_none());
    }

    #[test]
    fn snapshot_sorted_newest_first() {
        let state = DlState::new(2);
        {
            let mut m = state.manager.lock().unwrap();
            m.tasks.insert("old".into(), task("old", 100));
            m.tasks.insert("new".into(), task("new", 200));
        }
        let ids: Vec<String> = state.snapshot().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["new", "old"]);
    }

    #[test]
    fn status_serializes_with_kind_tag() {
        let json = serde_json::to_string(&DownloadStatus::Error {
            message: "boom".into(),
        })
        .unwrap();
        assert_eq!(json, r#"{"kind":"error","message":"boom"}"#);
        assert_eq!(
            serde_json::to_string(&DownloadStatus::Queued).unwrap(),
            r#"{"kind":"queued"}"#
        );
    }
}
