use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", content = "data")]
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
    pub id: String,
    pub url: String,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub status: DownloadStatus,
    pub percent: f32,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub output_path: Option<String>,
    pub format_id: Option<String>,
    pub audio_only: bool,
    pub audio_format: Option<String>,
    pub created_at: u64,
}

pub struct DownloadManager {
    pub tasks: HashMap<String, DownloadTask>,
    /// task_id → child PID, used for cancellation.
    pub child_pids: HashMap<String, u32>,
    /// Number of currently active (Downloading/Muxing/FetchingInfo) workers.
    pub active_count: u8,
    pub concurrent_limit: u8,
    /// Insertion-ordered list of all task IDs for queue ordering.
    pub queued_order: Vec<String>,
    /// Persisted settings (output dir, preferred format, etc.).
    pub settings: super::settings::DownloadSettings,
}

impl DownloadManager {
    pub fn new(settings: super::settings::DownloadSettings) -> Self {
        let concurrent_limit = settings.concurrent_limit;
        Self {
            tasks: HashMap::new(),
            child_pids: HashMap::new(),
            active_count: 0,
            concurrent_limit,
            queued_order: Vec::new(),
            settings,
        }
    }

    /// Returns the ID of the next Queued task, in insertion order.
    pub fn next_queued_id(&self) -> Option<String> {
        self.queued_order
            .iter()
            .find(|id| {
                matches!(
                    self.tasks.get(*id).map(|t| &t.status),
                    Some(DownloadStatus::Queued)
                )
            })
            .cloned()
    }

    pub fn can_start(&self) -> bool {
        self.active_count < self.concurrent_limit
    }
}

pub type DownloadManagerState = Arc<Mutex<DownloadManager>>;
