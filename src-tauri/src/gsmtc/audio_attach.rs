use std::collections::HashMap;
use std::path::Path;

use crate::audio_mixer::{enumerate_sessions, MixerSessionRow};
use crate::browser_tabs::BrowserSlot;

use super::dto::{AudioSessionInfoDto, GsmtcSnapshot, MediaSessionDto};

fn normalize_path(p: &str) -> String {
    let s = p.trim().replace('/', "\\").to_lowercase();
    // QueryFullProcessImageName vs canonicalize often disagree on `\\?\` prefix.
    s.strip_prefix("\\\\?\\").unwrap_or(&s).to_string()
}

/// Tokens that correlate poorly with GSMTC AUMIDs (cause false overlaps).
fn is_generic_overlap_token(tok: &str) -> bool {
    matches!(
        tok,
        "microsoft"
            | "windows"
            | "immersive"
            | "system"
            | "application"
            | "services"
            | "service"
            | "framework"
            | "runtime"
            | "background"
            | "playback"
            | "process"
            | "host"
            | "shell"
            | "common"
            | "content"
            | "client"
            | "package"
            | "experience"
            | "user"
            | "model"
    ) || tok.chars().all(|c| c.is_ascii_digit())
}

fn split_word_tokens(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_ascii_alphanumeric())
        .map(|w| w.to_ascii_lowercase())
        .filter(|w| !w.is_empty())
        .collect()
}

fn compact_alnum_lower(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

fn tokenize_for_aumid_match(s: &str) -> Vec<String> {
    let mut raw = split_word_tokens(s);
    raw.retain(|t| !is_generic_overlap_token(t) && t.len() >= 5);
    // Drop publisher-style hex blobs ("8wekyb3d8bbwe" survives as mixed? all hex len>=10 dropped)
    raw.retain(|t| !(t.len() >= 10 && t.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))));
    raw.sort();
    raw.dedup();
    raw
}

fn tokens_from_image_path(ip: Option<&str>) -> Vec<String> {
    let Some(ip) = ip else {
        return Vec::new();
    };
    let path = Path::new(ip);
    let stem = path.file_stem().and_then(|x| x.to_str());
    let base = path
        .file_name()
        .and_then(|x| x.to_str())
        .map(|nm| nm.rsplit_once('.').map(|x| x.0).unwrap_or(nm));
    let mut out = Vec::new();
    for s in stem.into_iter().chain(base.into_iter()) {
        out.extend(tokenize_for_aumid_match(s));
        let compact = compact_alnum_lower(s);
        if compact.len() >= 10 && !is_generic_overlap_token(&compact) {
            out.push(compact);
        }
    }
    let fname_compact = compact_alnum_lower(
        Path::new(ip).file_name().and_then(|n| n.to_str()).unwrap_or(""),
    );
    if fname_compact.len() >= 10 && !is_generic_overlap_token(&fname_compact) {
        out.push(fname_compact);
    }
    out.sort();
    out.dedup();
    out
}

fn longest_aumid_token_hit(aumid_lc: &str, tokens: &[String]) -> usize {
    tokens
        .iter()
        .filter(|t| aumid_lc.contains(t.as_str()))
        .map(|t| t.len())
        .max()
        .unwrap_or(0)
}

fn display_tokens(display: &str) -> Vec<String> {
    let mut tok = split_word_tokens(display);
    tok.retain(|t| !is_generic_overlap_token(t) && t.len() >= 4);
    tok.sort();
    tok.dedup();
    tok
}

/// Match UWP/desktop apps whose AUMID does not spell out `.exe`: correlate significant
/// substrings from the mixer process image path / WASAPI display name vs `SourceAppUserModelId`.
fn match_gsmtc_by_aumid_token_overlap(
    session: &MediaSessionDto,
    mixer: &[MixerSessionRow],
) -> Option<AudioSessionInfoDto> {
    let aumid_lc = session.source_app_user_model_id.to_lowercase();

    #[derive(Clone, Copy)]
    struct Hit {
        pid: u32,
        score: usize,
    }

    let mut hits = Vec::<Hit>::new();
    for row in mixer {
        let exe_toks = tokens_from_image_path(row.image_path.as_deref());
        let mut best = longest_aumid_token_hit(&aumid_lc, &exe_toks);
        let disp_best = longest_aumid_token_hit(&aumid_lc, &display_tokens(&row.display_name));
        best = best.max(disp_best);
        if best >= 5 {
            hits.push(Hit {
                pid: row.process_id,
                score: best,
            });
        }
    }

    let max_score = hits.iter().map(|h| h.score).max()?;
    hits.retain(|h| h.score == max_score);
    let mut pids: Vec<u32> = hits.iter().map(|h| h.pid).collect();
    pids.sort_unstable();
    pids.dedup();
    if pids.len() != 1 {
        return None;
    }
    pick_mixer_row_for_pid(mixer, pids[0]).map(row_to_dto)
}

fn tokens_from_audio_session_package_family(aumid: &str) -> Vec<String> {
    let left = aumid.split('!').next().unwrap_or("").trim();
    let mut tok = split_word_tokens(left);
    tok.retain(|t| !is_generic_overlap_token(t));
    tok.retain(|t| !(t.len() >= 10 && t.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))));
    tok.sort();
    tok.dedup();
    tok.retain(|t| t.len() >= 6);
    tok
}

/// Store / MSIX installs often embed package family fragments in `image_path`
/// (`…\WindowsApps\Microsoft.ZuneVideo_…\Video.UI.exe`). GSMTC `SourceAppUserModelId`
/// repeats the same token before `!`.
fn match_gsmtc_by_package_token_in_process_path(
    session: &MediaSessionDto,
    mixer: &[MixerSessionRow],
) -> Option<AudioSessionInfoDto> {
    let pf_toks = tokens_from_audio_session_package_family(&session.source_app_user_model_id);
    if pf_toks.is_empty() {
        return None;
    }
    let mut pids = Vec::<u32>::new();
    for row in mixer {
        let Some(ip) = row.image_path.as_deref() else {
            continue;
        };
        let ip = ip.to_lowercase();
        if pf_toks.iter().any(|t| ip.contains(t)) {
            pids.push(row.process_id);
        }
    }
    pids.sort_unstable();
    pids.dedup();
    if pids.len() != 1 {
        return None;
    }
    pick_mixer_row_for_pid(mixer, pids[0]).map(row_to_dto)
}

fn candidate_exe_from_aumid(aumid: &str) -> Option<String> {
    let left = aumid.split('!').next()?.trim();
    if left.len() < 5 || !left.to_ascii_lowercase().ends_with(".exe") {
        return None;
    }
    let path = Path::new(left);
    if path.exists() {
        if let Ok(canonical) = std::fs::canonicalize(path) {
            return Some(normalize_path(&canonical.to_string_lossy()));
        }
    }
    Some(normalize_path(left))
}

fn row_to_dto(row: &MixerSessionRow) -> AudioSessionInfoDto {
    AudioSessionInfoDto {
        instance_id: row.instance_id.clone(),
        volume: row.volume,
        muted: row.muted,
    }
}

fn pick_mixer_row_for_pid<'a>(
    rows: &'a [MixerSessionRow],
    pid: u32,
) -> Option<&'a MixerSessionRow> {
    let candidates: Vec<&MixerSessionRow> = rows.iter().filter(|r| r.process_id == pid).collect();
    if candidates.is_empty() {
        return None;
    }
    candidates
        .iter()
        .find(|r| !r.display_name.trim().is_empty())
        .copied()
        .or_else(|| candidates.first().copied())
}

/// Classic desktop apps: full exe path in AUMID before `!`.
fn match_gsmtc_by_exe_path(
    session: &MediaSessionDto,
    mixer: &[MixerSessionRow],
) -> Option<AudioSessionInfoDto> {
    let target_path = candidate_exe_from_aumid(&session.source_app_user_model_id)?;
    let mut pid_match: Option<u32> = None;
    for row in mixer {
        let Some(ip) = row.image_path.as_deref() else { continue };
        if normalize_path(ip) == target_path {
            pid_match = Some(row.process_id);
            break;
        }
    }
    let pid = pid_match?;
    let row = pick_mixer_row_for_pid(mixer, pid)?;
    Some(row_to_dto(row))
}

/// Store / bridged AUMIDs (e.g. `SpotifyAB.SpotifyMusic_…`): match exe **stem** substring.
fn match_gsmtc_by_exe_stem_in_aumid(
    session: &MediaSessionDto,
    mixer: &[MixerSessionRow],
) -> Option<AudioSessionInfoDto> {
    let aumid = session.source_app_user_model_id.to_lowercase();
    let mut pids: Vec<u32> = Vec::new();
    for row in mixer {
        let Some(ip) = row.image_path.as_deref() else { continue };
        let stem = match Path::new(ip).file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_lowercase(),
            None => continue,
        };
        if stem.len() < 3 {
            continue;
        }
        if aumid.contains(&stem) {
            pids.push(row.process_id);
        }
    }
    pids.sort_unstable();
    pids.dedup();
    if pids.len() != 1 {
        return None;
    }
    pick_mixer_row_for_pid(mixer, pids[0]).map(row_to_dto)
}

fn normalize_title(s: &str) -> String {
    s.trim().to_lowercase()
}

fn mixer_display_matches_gsmtc(session: &MediaSessionDto, display_norm: &str) -> bool {
    if display_norm.is_empty() {
        return false;
    }
    let title = normalize_title(&session.title);
    let artist = normalize_title(&session.artist);
    let subtitle = normalize_title(&session.subtitle);
    let album = normalize_title(&session.album);

    for meta in [&title, &artist, &subtitle, &album] {
        if meta.is_empty() {
            continue;
        }
        if display_norm == meta
            || display_norm.contains(meta.as_str())
            || meta.contains(display_norm)
        {
            return true;
        }
    }
    false
}

/// Prefer mixer rows whose display string overlaps GSMTC title / artist / subtitle.
fn match_gsmtc_by_media_metadata(
    session: &MediaSessionDto,
    mixer: &[MixerSessionRow],
) -> Option<AudioSessionInfoDto> {
    let hits: Vec<&MixerSessionRow> = mixer
        .iter()
        .filter(|m| mixer_display_matches_gsmtc(session, &normalize_title(&m.display_name)))
        .collect();
    let mut pids: Vec<u32> = hits.iter().map(|h| h.process_id).collect();
    pids.sort_unstable();
    pids.dedup();
    if pids.len() != 1 {
        return None;
    }
    pick_mixer_row_for_pid(mixer, pids[0]).map(row_to_dto)
}

fn match_gsmtc_audio(session: &MediaSessionDto, mixer: &[MixerSessionRow]) -> Option<AudioSessionInfoDto> {
    match_gsmtc_by_exe_path(session, mixer)
        .or_else(|| match_gsmtc_by_exe_stem_in_aumid(session, mixer))
        .or_else(|| match_gsmtc_by_package_token_in_process_path(session, mixer))
        .or_else(|| match_gsmtc_by_aumid_token_overlap(session, mixer))
        .or_else(|| match_gsmtc_by_media_metadata(session, mixer))
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

/// Match browser profiles to WASAPI sessions using the new unified `BrowserSlot` map.
/// Groups tabs by `browser_id` (slot key), uses media tab titles as matching hints.
fn match_browser_profiles_from_slots(
    slots: &HashMap<String, BrowserSlot>,
    mixer: &[MixerSessionRow],
) -> HashMap<String, AudioSessionInfoDto> {
    let mut out = HashMap::new();

    for (browser_id, slot) in slots {
        // Collect titles from tabs that currently have active media.
        let titles: Vec<String> = slot
            .tabs
            .iter()
            .filter_map(|t| t.media.as_ref())
            .filter_map(|m| {
                let n = normalize_title(&m.title);
                if n.is_empty() { None } else { Some(n) }
            })
            .collect();

        let chromium = chromium_sessions_for_profile(mixer, &slot.browser_name);
        if chromium.is_empty() {
            continue;
        }

        let mut chosen: Option<&MixerSessionRow> = None;

        // Try exact title match first.
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
            // Substring match fallback.
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

/// Enrich a `GsmtcSnapshot` with per-session and per-browser WASAPI audio info.
pub fn enrich_snapshot_with_audio(
    snap: &mut GsmtcSnapshot,
    slots: &HashMap<String, BrowserSlot>,
) {
    let mixer = match enumerate_sessions() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[audio] enumerate_sessions failed: {e}");
            return;
        }
    };
    for session in &mut snap.sessions {
        session.audio = match_gsmtc_audio(session, &mixer);
    }
    snap.browser_audio = match_browser_profiles_from_slots(slots, &mixer);
}
