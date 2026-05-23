/// Raw yt-dlp --dump-json output (only the fields we care about).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VideoInfo {
    pub title: String,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub webpage_url: String,
    #[serde(default)]
    pub formats: Vec<Format>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Format {
    pub format_id: String,
    #[serde(default)]
    pub ext: String,
    /// e.g. "1920x1080" or "audio only"
    pub resolution: Option<String>,
    pub fps: Option<f64>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub filesize: Option<u64>,
    /// Total bitrate kbps
    pub tbr: Option<f64>,
    pub height: Option<u32>,
}

/// A user-facing quality preset shown in the dropdown.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FormatPreset {
    pub label: String,
    pub format_id: String,
    pub audio_only: bool,
    pub audio_format: Option<String>,
}

/// Full response from dl_fetch_info: original info + generated presets.
#[derive(Debug, Clone, serde::Serialize)]
pub struct VideoInfoWithPresets {
    pub title: String,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub webpage_url: String,
    pub presets: Vec<FormatPreset>,
}

pub fn parse_video_info(json: &str) -> Result<VideoInfo, String> {
    serde_json::from_str(json).map_err(|e| format!("Failed to parse yt-dlp JSON: {e}"))
}

pub fn generate_presets(formats: &[Format]) -> Vec<FormatPreset> {
    let mut presets = Vec::new();

    presets.push(FormatPreset {
        label: "Best quality (auto)".into(),
        format_id: "bestvideo+bestaudio/best".into(),
        audio_only: false,
        audio_format: None,
    });

    // Height-based MP4 presets — only add if the source has that resolution.
    for (height, label) in &[(1080u32, "1080p MP4"), (720u32, "720p MP4"), (480u32, "480p MP4")] {
        let has_height = formats.iter().any(|f| {
            f.height.map_or(false, |h| h == *height)
                || f.resolution
                    .as_deref()
                    .and_then(|r| r.split('x').nth(1)?.parse::<u32>().ok())
                    .map_or(false, |h| h == *height)
        });
        if has_height {
            presets.push(FormatPreset {
                label: label.to_string(),
                format_id: format!(
                    "bestvideo[height<={}]+bestaudio/best[height<={}]",
                    height, height
                ),
                audio_only: false,
                audio_format: None,
            });
        }
    }

    presets.push(FormatPreset {
        label: "Audio only (MP3)".into(),
        format_id: "bestaudio/best".into(),
        audio_only: true,
        audio_format: Some("mp3".into()),
    });

    presets
}

pub fn into_with_presets(info: VideoInfo) -> VideoInfoWithPresets {
    let presets = generate_presets(&info.formats);
    VideoInfoWithPresets {
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        webpage_url: info.webpage_url,
        presets,
    }
}
