//! Parsing of `yt-dlp --dump-json` output into typed structs, plus the
//! user-facing preset list (MP4 quality tiers, audio-only formats).
//!
//! Parsing is deliberately tolerant: every field except `title` is optional,
//! unknown fields are ignored, and a missing/odd `formats` array degrades to
//! presets that only contain the "best" selectors.

// NOTE: deserialized FROM yt-dlp (snake_case JSON), serialized TO the
// frontend (camelCase) — hence the split rename_all.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct VideoInfo {
    pub title: String,
    #[serde(default)]
    pub thumbnail: Option<String>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub webpage_url: Option<String>,
    #[serde(default)]
    pub uploader: Option<String>,
    #[serde(default)]
    pub formats: Vec<Format>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct Format {
    #[serde(default)]
    pub format_id: String,
    #[serde(default)]
    pub ext: Option<String>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub fps: Option<f64>,
    #[serde(default)]
    pub vcodec: Option<String>,
    #[serde(default)]
    pub acodec: Option<String>,
    #[serde(default)]
    pub filesize: Option<u64>,
    #[serde(default)]
    pub filesize_approx: Option<u64>,
    #[serde(default)]
    pub tbr: Option<f64>,
    #[serde(default)]
    pub format_note: Option<String>,
}

impl Format {
    pub fn has_video(&self) -> bool {
        matches!(&self.vcodec, Some(v) if v != "none")
    }
    pub fn has_audio(&self) -> bool {
        matches!(&self.acodec, Some(a) if a != "none")
    }
}

/// One user-facing download option. `format_selector` goes to `-f`;
/// `postprocess` describes fixed extra behavior applied by the worker
/// (never raw args from the frontend).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub label: String,
    /// "video" | "audio"
    pub kind: String,
    pub format_selector: String,
    /// Audio-only: target codec for --extract-audio (mp3/m4a). None for video.
    pub audio_format: Option<String>,
    /// Video: container passed to --merge-output-format.
    pub container: Option<String>,
    /// Rough size hint in bytes when derivable from the format list.
    pub filesize_hint: Option<u64>,
}

/// Standard video heights offered when the source provides them.
const VIDEO_TIERS: &[u32] = &[1080, 720, 480];

pub fn parse_dump_json(raw: &str) -> Result<VideoInfo, String> {
    serde_json::from_str::<VideoInfo>(raw).map_err(|e| format!("info_parse: {e}"))
}

/// Build the preset list shown to the user.
pub fn build_presets(info: &VideoInfo) -> Vec<Preset> {
    let mut presets = Vec::new();

    let max_height = info
        .formats
        .iter()
        .filter(|f| f.has_video())
        .filter_map(|f| f.height)
        .max();

    presets.push(Preset {
        id: "best".into(),
        label: match max_height {
            Some(h) => format!("Best quality (MP4, up to {h}p)"),
            None => "Best quality (MP4)".into(),
        },
        kind: "video".into(),
        format_selector: "bestvideo+bestaudio/best".into(),
        audio_format: None,
        container: Some("mp4".into()),
        filesize_hint: size_hint_for(info, max_height),
    });

    for &tier in VIDEO_TIERS {
        // Offer the tier only if the source actually has video at/above it.
        if max_height.map(|h| h >= tier).unwrap_or(false) {
            presets.push(Preset {
                id: format!("mp4-{tier}"),
                label: format!("MP4 {tier}p"),
                kind: "video".into(),
                format_selector: format!(
                    "bestvideo[height<={tier}]+bestaudio/best[height<={tier}]"
                ),
                audio_format: None,
                container: Some("mp4".into()),
                filesize_hint: size_hint_for(info, Some(tier)),
            });
        }
    }

    let audio_hint = info
        .formats
        .iter()
        .filter(|f| f.has_audio() && !f.has_video())
        .filter_map(|f| f.filesize.or(f.filesize_approx))
        .max();

    presets.push(Preset {
        id: "mp3".into(),
        label: "Audio only (MP3)".into(),
        kind: "audio".into(),
        format_selector: "bestaudio/best".into(),
        audio_format: Some("mp3".into()),
        container: None,
        filesize_hint: audio_hint,
    });
    presets.push(Preset {
        id: "m4a".into(),
        label: "Audio only (M4A)".into(),
        kind: "audio".into(),
        format_selector: "bestaudio[ext=m4a]/bestaudio/best".into(),
        audio_format: Some("m4a".into()),
        container: None,
        filesize_hint: audio_hint,
    });

    presets
}

/// Best-effort size hint: biggest video stream at/below `height` + biggest
/// audio-only stream.
fn size_hint_for(info: &VideoInfo, height: Option<u32>) -> Option<u64> {
    let video = info
        .formats
        .iter()
        .filter(|f| f.has_video())
        .filter(|f| match (height, f.height) {
            (Some(cap), Some(h)) => h <= cap,
            _ => true,
        })
        .filter_map(|f| f.filesize.or(f.filesize_approx))
        .max()?;
    let audio = info
        .formats
        .iter()
        .filter(|f| f.has_audio() && !f.has_video())
        .filter_map(|f| f.filesize.or(f.filesize_approx))
        .max()
        .unwrap_or(0);
    Some(video + audio)
}

#[cfg(test)]
mod tests {
    use super::*;

    const YOUTUBE_FIXTURE: &str = include_str!("testdata/youtube_dump.json");
    const AUDIO_SITE_FIXTURE: &str = include_str!("testdata/audio_site_dump.json");

    #[test]
    fn parses_youtube_dump() {
        let info = parse_dump_json(YOUTUBE_FIXTURE).expect("fixture should parse");
        assert_eq!(info.title, "Test Video — PilPod fixture");
        assert_eq!(info.thumbnail.as_deref(), Some("https://i.ytimg.com/vi/x/hq720.jpg"));
        assert!(info.duration.unwrap() > 0.0);
        assert_eq!(info.formats.len(), 8);
        // snake_case fields from yt-dlp must actually populate (regression
        // guard: rename_all camelCase on deserialize silently dropped these).
        assert_eq!(info.formats[0].format_id, "251");
        assert_eq!(info.webpage_url.as_deref(), Some("https://www.youtube.com/watch?v=fixture01"));
        assert!(info.formats.iter().any(|f| f.filesize_approx.is_some()));
        assert!(info.formats.iter().all(|f| !f.format_id.is_empty()));
        // Classification sanity.
        let audio_only = info
            .formats
            .iter()
            .filter(|f| f.has_audio() && !f.has_video())
            .count();
        assert_eq!(audio_only, 2);
    }

    #[test]
    fn youtube_presets_include_expected_tiers() {
        let info = parse_dump_json(YOUTUBE_FIXTURE).unwrap();
        let presets = build_presets(&info);
        let ids: Vec<&str> = presets.iter().map(|p| p.id.as_str()).collect();
        // Source max is 1080p ⇒ best, 1080, 720, 480, mp3, m4a.
        assert_eq!(ids, vec!["best", "mp4-1080", "mp4-720", "mp4-480", "mp3", "m4a"]);

        let p1080 = presets.iter().find(|p| p.id == "mp4-1080").unwrap();
        assert_eq!(
            p1080.format_selector,
            "bestvideo[height<=1080]+bestaudio/best[height<=1080]"
        );
        assert_eq!(p1080.container.as_deref(), Some("mp4"));
        assert!(p1080.filesize_hint.unwrap() > 0);

        let mp3 = presets.iter().find(|p| p.id == "mp3").unwrap();
        assert_eq!(mp3.kind, "audio");
        assert_eq!(mp3.audio_format.as_deref(), Some("mp3"));
    }

    #[test]
    fn low_res_source_drops_missing_tiers() {
        // Non-YouTube site fixture maxes at 720p and has no separate audio streams.
        let info = parse_dump_json(AUDIO_SITE_FIXTURE).unwrap();
        let presets = build_presets(&info);
        let ids: Vec<&str> = presets.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["best", "mp4-720", "mp4-480", "mp3", "m4a"]);
        assert!(!ids.contains(&"mp4-1080"));
    }

    #[test]
    fn minimal_json_still_yields_presets() {
        let info = parse_dump_json(r#"{"title":"bare"}"#).unwrap();
        assert!(info.formats.is_empty());
        let presets = build_presets(&info);
        let ids: Vec<&str> = presets.iter().map(|p| p.id.as_str()).collect();
        // No format data ⇒ just best + audio presets, no fake tiers.
        assert_eq!(ids, vec!["best", "mp3", "m4a"]);
    }

    #[test]
    fn garbage_json_is_an_error_not_a_panic() {
        assert!(parse_dump_json("").is_err());
        assert!(parse_dump_json("not json").is_err());
        assert!(parse_dump_json(r#"{"formats":"nope"}"#).is_err());
    }
}
