use windows::{
    core::HSTRING,
    Media::Control::{
        GlobalSystemMediaTransportControlsSession,
        GlobalSystemMediaTransportControlsSessionPlaybackControls,
        GlobalSystemMediaTransportControlsSessionPlaybackInfo,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
        GlobalSystemMediaTransportControlsSessionTimelineProperties,
        GlobalSystemMediaTransportControlsSessionManager,
    },
};

use super::dto::{ControlsDto, MediaSessionDto, TimelineDto, GsmtcSnapshot, SNAPSHOT_VERSION};
use super::thumbnail::read_thumbnail_b64;

/// GSMTC AUMID substrings for browsers that can run the Chromium companion extension.
/// When `browser_tabs` is non-empty, these sessions duplicate the extension list.
const CHROMIUM_FAMILY_AUMID_MARKERS: &[&str] = &[
    "chrome",
    "msedge",
    "microsoftedge",
    "brave",
    "opera",
    "vivaldi",
    "chromium",
    "yandexbrowser",
];

fn aumid_is_chromium_browser_media_source(aumid: &str) -> bool {
    let a = aumid.to_lowercase();
    CHROMIUM_FAMILY_AUMID_MARKERS.iter().any(|m| a.contains(m))
}

/// Drops Chromium-family system sessions from `sessions` when the extension supplies tab data,
/// so the same media is not listed under both Browsers and Windows.
pub fn apply_extension_gsmtc_dedup(mut snap: GsmtcSnapshot) -> GsmtcSnapshot {
    if snap.browser_tabs.is_empty() {
        return snap;
    }
    snap.sessions
        .retain(|s| !aumid_is_chromium_browser_media_source(&s.source_app_user_model_id));
    snap
}

fn hstring_opt(h: windows::core::Result<HSTRING>) -> String {
    h.map(|s| s.to_string()).unwrap_or_default()
}

fn playback_status_str(s: GlobalSystemMediaTransportControlsSessionPlaybackStatus) -> &'static str {
    use GlobalSystemMediaTransportControlsSessionPlaybackStatus as P;
    if s == P::Closed {
        "closed"
    } else if s == P::Opened {
        "opened"
    } else if s == P::Changing {
        "changing"
    } else if s == P::Stopped {
        "stopped"
    } else if s == P::Playing {
        "playing"
    } else if s == P::Paused {
        "paused"
    } else {
        "unknown"
    }
}

fn timeline_from_win(t: &GlobalSystemMediaTransportControlsSessionTimelineProperties) -> TimelineDto {
    let start = t.StartTime().map(|x| x.Duration).unwrap_or(0);
    let end = t.EndTime().map(|x| x.Duration).unwrap_or(0);
    let pos = t.Position().map(|x| x.Duration).unwrap_or(0);
    let min_seek = t.MinSeekTime().map(|x| x.Duration).unwrap_or(0);
    let max_seek = t.MaxSeekTime().map(|x| x.Duration).unwrap_or(0);
    const EPOCH_100NS: i64 = 116_444_736_000_000_000;
    let last_ms = t
        .LastUpdatedTime()
        .map(|dt| (dt.UniversalTime - EPOCH_100NS) / 10_000)
        .unwrap_or(0);
    TimelineDto {
        start_ticks: start,
        end_ticks: end,
        position_ticks: pos,
        min_seek_ticks: min_seek,
        max_seek_ticks: max_seek,
        last_updated_unix_ms: last_ms,
    }
}

fn controls_from_win(c: &GlobalSystemMediaTransportControlsSessionPlaybackControls) -> ControlsDto {
    ControlsDto {
        play_pause_toggle_enabled: c.IsPlayPauseToggleEnabled().unwrap_or(false),
        next_enabled: c.IsNextEnabled().unwrap_or(false),
        previous_enabled: c.IsPreviousEnabled().unwrap_or(false),
    }
}

fn playback_type_str(
    info: &GlobalSystemMediaTransportControlsSessionPlaybackInfo,
) -> Option<String> {
    let r = info.PlaybackType().ok()?;
    Some(format!("{:?}", r.Value().ok()?))
}

pub fn map_session(
    session: &GlobalSystemMediaTransportControlsSession,
    session_index: u32,
    include_thumbnails: bool,
) -> MediaSessionDto {
    let aumid = session
        .SourceAppUserModelId()
        .map(|s| s.to_string())
        .unwrap_or_default();

    let playback = session.GetPlaybackInfo();
    let (playback_status, controls, playback_type) = match playback {
        Ok(info) => (
            playback_status_str(info.PlaybackStatus().unwrap_or(
                GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped,
            ))
            .to_string(),
            info.Controls()
                .map(|c| controls_from_win(&c))
                .unwrap_or_else(|_| ControlsDto {
                    play_pause_toggle_enabled: false,
                    next_enabled: false,
                    previous_enabled: false,
                }),
            playback_type_str(&info),
        ),
        Err(_) => (
            "unknown".into(),
            ControlsDto {
                play_pause_toggle_enabled: false,
                next_enabled: false,
                previous_enabled: false,
            },
            None,
        ),
    };

    let timeline = session
        .GetTimelineProperties()
        .map(|t| timeline_from_win(&t))
        .unwrap_or_else(|_| TimelineDto {
            start_ticks: 0,
            end_ticks: 0,
            position_ticks: 0,
            min_seek_ticks: 0,
            max_seek_ticks: 0,
            last_updated_unix_ms: 0,
        });

    let mut title = String::new();
    let mut artist = String::new();
    let mut album = String::new();
    let mut subtitle = String::new();
    let mut thumb_b64 = None;
    let mut thumb_mime = None;

    if let Ok(op) = session.TryGetMediaPropertiesAsync() {
        if let Ok(props) = op.get() {
            title = hstring_opt(props.Title());
            artist = hstring_opt(props.Artist());
            album = hstring_opt(props.AlbumTitle());
            subtitle = hstring_opt(props.Subtitle());
            if include_thumbnails {
                if let Ok(thumb) = props.Thumbnail() {
                    if let Ok(op) = thumb.OpenReadAsync() {
                        if let Ok(stream) = op.get() {
                            if let Ok((b64, mime)) = read_thumbnail_b64(&stream) {
                                if !b64.is_empty() {
                                    thumb_b64 = Some(b64);
                                    thumb_mime = mime;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    MediaSessionDto {
        session_index,
        source_app_user_model_id: aumid,
        title,
        artist,
        album,
        subtitle,
        playback_status,
        playback_type,
        timeline,
        controls,
        thumbnail_mime: thumb_mime,
        thumbnail_base64: thumb_b64,
    }
}

pub fn build_snapshot(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
    include_thumbnails: bool,
) -> GsmtcSnapshot {
    let mut sessions = Vec::new();
    if let Ok(list) = manager.GetSessions() {
        if let Ok(n) = list.Size() {
            for i in 0..n {
                if let Ok(s) = list.GetAt(i) {
                    sessions.push(map_session(&s, i, include_thumbnails));
                }
            }
        }
    }
    GsmtcSnapshot {
        version: SNAPSHOT_VERSION,
        sessions,
        browser_tabs: Vec::new(),
    }
}