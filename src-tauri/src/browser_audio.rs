//! WASAPI matching for browser extension profiles (per-profile volume sliders).

use std::collections::HashMap;
use std::path::Path;

use tauri::{AppHandle, State};

use crate::audio_mixer::{enumerate_sessions, set_session_volume_by_instance_id, MixerSessionRow};
use crate::browser_bridge::WsConnectionMap;
use crate::browser_detector::{
    emit_browsers_to_ui, DetectedBrowsersState, ExtensionInstalledState,
    ReconnectingBrowsersState,
};
use crate::browser_dto::AudioSessionInfoDto;
use crate::browser_tabs::{BrowserSlot, BrowserSlotsMap};

fn normalize_title(s: &str) -> String {
    s.trim().to_lowercase()
}

fn row_to_dto(row: &MixerSessionRow) -> AudioSessionInfoDto {
    AudioSessionInfoDto {
        instance_id: row.instance_id.clone(),
        volume: row.volume,
        muted: row.muted,
    }
}

fn exe_is_chromium(image_path: Option<&str>) -> bool {
    let Some(ip) = image_path else {
        return false;
    };
    let name = Path::new(ip)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        name.as_str(),
        "chrome.exe"
            | "msedge.exe"
            | "brave.exe"
            | "opera.exe"
            | "vivaldi.exe"
            | "chromium.exe"
            | "yandexbrowser.exe"
    )
}

fn chromium_exe_matches_browser_hint(image_path: Option<&str>, hint: &str) -> bool {
    let Some(ip) = image_path else {
        return false;
    };
    let name = Path::new(ip)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let h = hint.trim().to_lowercase();

    if h.contains("edge") || h == "microsoft edge" {
        return name == "msedge.exe";
    }
    if h.contains("brave") {
        return name == "brave.exe";
    }
    if h.contains("opera") {
        return name.contains("opera");
    }
    if h.contains("vivaldi") {
        return name == "vivaldi.exe";
    }
    if h.contains("yandex") {
        return name.contains("yandex");
    }
    if h.contains("chromium") {
        return name == "chromium.exe";
    }
    name == "chrome.exe"
}

fn chromium_sessions_for_profile<'a>(
    mixer: &'a [MixerSessionRow],
    browser_name_hint: &str,
) -> Vec<&'a MixerSessionRow> {
    let all: Vec<&MixerSessionRow> = mixer
        .iter()
        .filter(|m| exe_is_chromium(m.image_path.as_deref()))
        .collect();

    let hint = browser_name_hint.trim();
    if hint.is_empty() {
        return all;
    }

    let filtered: Vec<&MixerSessionRow> = all
        .iter()
        .copied()
        .filter(|m| chromium_exe_matches_browser_hint(m.image_path.as_deref(), hint))
        .collect();

    if filtered.is_empty() {
        all
    } else {
        filtered
    }
}

/// Match browser profiles to WASAPI sessions using extension tab media titles as hints.
pub fn match_browser_profiles_from_slots(
    slots: &HashMap<String, BrowserSlot>,
    mixer: &[MixerSessionRow],
) -> HashMap<String, AudioSessionInfoDto> {
    let mut out = HashMap::new();

    for (browser_id, slot) in slots {
        let titles: Vec<String> = slot
            .tabs
            .iter()
            .filter_map(|t| t.media.as_ref())
            .filter_map(|m| {
                let n = normalize_title(&m.title);
                if n.is_empty() {
                    None
                } else {
                    Some(n)
                }
            })
            .collect();

        let chromium = chromium_sessions_for_profile(mixer, &slot.browser_name);
        if chromium.is_empty() {
            continue;
        }

        let mut chosen: Option<&MixerSessionRow> = None;

        let mut exact: Vec<&MixerSessionRow> = Vec::new();
        for m in &chromium {
            let d = normalize_title(&m.display_name);
            if d.is_empty() {
                continue;
            }
            if titles.iter().any(|t| t == &d) {
                exact.push(*m);
            }
        }

        if exact.len() == 1 {
            chosen = Some(exact[0]);
        } else if exact.is_empty() {
            let mut sub: Vec<&MixerSessionRow> = Vec::new();
            for m in &chromium {
                let d = normalize_title(&m.display_name);
                if d.is_empty() {
                    continue;
                }
                if titles
                    .iter()
                    .any(|t| d.contains(t.as_str()) || t.contains(d.as_str()))
                {
                    sub.push(*m);
                }
            }
            if sub.len() == 1 {
                chosen = Some(sub[0]);
            } else if chromium.len() == 1 && !titles.is_empty() {
                chosen = Some(chromium[0]);
            }
        }

        if let Some(row) = chosen {
            out.insert(browser_id.clone(), row_to_dto(row));
        }
    }
    out
}

pub fn browser_audio_for_slots(
    slots: &HashMap<String, BrowserSlot>,
) -> HashMap<String, AudioSessionInfoDto> {
    let mixer = match enumerate_sessions() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[browser-audio] enumerate_sessions failed: {e}");
            return HashMap::new();
        }
    };
    match_browser_profiles_from_slots(slots, &mixer)
}

/// Set WASAPI volume for a browser profile audio session; re-emits browsers payload.
#[tauri::command]
pub fn mixer_set_volume(
    app: AppHandle,
    detected: State<'_, DetectedBrowsersState>,
    slots: State<'_, BrowserSlotsMap>,
    ext_store: State<'_, ExtensionInstalledState>,
    reconnecting: State<'_, ReconnectingBrowsersState>,
    ws_connections: State<'_, WsConnectionMap>,
    instance_id: String,
    volume: f32,
) -> Result<(), String> {
    set_session_volume_by_instance_id(&instance_id, volume)?;
    emit_browsers_to_ui(
        &app,
        &detected,
        &slots,
        &ext_store,
        &reconnecting,
        &ws_connections,
    );
    Ok(())
}
