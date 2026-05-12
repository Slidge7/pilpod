use serde::{Deserialize, Serialize};

pub const SNAPSHOT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GsmtcSnapshot {
    pub version: u32,
    pub sessions: Vec<MediaSessionDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSessionDto {
    pub source_app_user_model_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub subtitle: String,
    pub playback_status: String,
    pub playback_type: Option<String>,
    pub timeline: TimelineDto,
    pub controls: ControlsDto,
    pub thumbnail_mime: Option<String>,
    pub thumbnail_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineDto {
    pub start_ticks: i64,
    pub end_ticks: i64,
    pub position_ticks: i64,
    pub min_seek_ticks: i64,
    pub max_seek_ticks: i64,
    pub last_updated_unix_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlsDto {
    pub play_pause_toggle_enabled: bool,
    pub next_enabled: bool,
    pub previous_enabled: bool,
}
