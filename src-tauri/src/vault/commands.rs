//! Vault Tauri commands. Thin by design: validate the frontend payload, call a
//! single `VaultState` mutation, then emit `vault://update` (diff-before-emit)
//! and let the debounced thread persist. The vault is a FREE feature, so there
//! is no `require_premium` gate here (contrast the downloader).
//!
//! Capture payloads come *from the frontend*, which already holds `BrowserTab`
//! + `DetectedBrowser` from `browsers://update`. The backend never looks tabs
//! up itself — that decoupling is the whole point of the isolation contract.

use tauri::State;

use super::dto::{Bookmark, MediaItem, Playlist, VaultData};
use super::state::{BookmarkPatch, VaultStateHandle};
use super::{emit_update, now_ms, url};

const MAX_NAME_LEN: usize = 200;
const MAX_EMOJI_LEN: usize = 16;
const MAX_PLAYLIST_ITEMS: usize = 5000;

const MAX_URL_LEN: usize = 2048;
const MAX_TITLE_LEN: usize = 500;
const MAX_TAGS: usize = 32;
const MAX_TAG_LEN: usize = 48;
const MAX_NOTES_LEN: usize = 4000;

/// Accept only http/https, bounded length, no control chars/whitespace.
fn validate_url(raw: &str) -> Result<String, String> {
    let u = raw.trim();
    if u.is_empty() {
        return Err("url_empty".into());
    }
    if u.len() > MAX_URL_LEN {
        return Err("url_too_long".into());
    }
    if !(u.starts_with("https://") || u.starts_with("http://")) {
        return Err("url_scheme_not_allowed".into());
    }
    if u.chars().any(|c| c.is_whitespace() || (c as u32) < 0x20) {
        return Err("url_invalid_chars".into());
    }
    Ok(u.to_string())
}

/// Trim + bound; fall back to the URL when the tab gave us no title.
fn clean_title(raw: Option<&str>, fallback_url: &str) -> String {
    let t = raw.map(str::trim).unwrap_or("");
    let t = if t.is_empty() { fallback_url } else { t };
    t.chars().take(MAX_TITLE_LEN).collect()
}

/// Trim, drop empties, bound length, dedupe (order-preserving), cap count.
fn clean_tags(tags: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for t in tags {
        let t: String = t.trim().chars().take(MAX_TAG_LEN).collect();
        if t.is_empty() || out.iter().any(|e| e == &t) {
            continue;
        }
        out.push(t);
        if out.len() >= MAX_TAGS {
            break;
        }
    }
    out
}

fn clean_notes(notes: Option<String>) -> Option<String> {
    notes.map(|n| n.chars().take(MAX_NOTES_LEN).collect())
}

/// Full vault snapshot (canonical order). The frontend calls this once on mount
/// then trusts `vault://update`.
#[tauri::command]
pub fn vault_get_state(state: State<'_, VaultStateHandle>) -> VaultData {
    state.snapshot()
}

/// Payload captured on the frontend from the tab row being saved.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddBookmarkArgs {
    pub url: String,
    pub title: Option<String>,
    pub favicon_url: Option<String>,
    pub source_os_browser_id: Option<String>,
    pub source_profile_label: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub notes: Option<String>,
    #[serde(default)]
    pub pinned: bool,
}

/// Add a bookmark. Returns the new id, or the typed `already_saved` error when
/// a bookmark with the same normalized URL already exists.
#[tauri::command]
pub fn vault_add_bookmark(
    app: tauri::AppHandle,
    state: State<'_, VaultStateHandle>,
    args: AddBookmarkArgs,
) -> Result<String, String> {
    let url = validate_url(&args.url)?;
    let normalized_url = url::normalize_url(&url);
    let bookmark = Bookmark {
        id: format!("b_{}", uuid::Uuid::new_v4()),
        title: clean_title(args.title.as_deref(), &url),
        url,
        normalized_url,
        favicon_url: args.favicon_url.filter(|s| !s.trim().is_empty()),
        source_os_browser_id: args.source_os_browser_id.filter(|s| !s.trim().is_empty()),
        source_profile_label: args.source_profile_label.filter(|s| !s.trim().is_empty()),
        created_at_ms: now_ms(),
        last_opened_at_ms: None,
        open_count: 0,
        pinned: args.pinned,
        tags: clean_tags(args.tags),
        notes: clean_notes(args.notes),
    };
    let saved = state.add_bookmark(bookmark)?;
    emit_update(&app, &state);
    Ok(saved.id)
}

/// Patch fields on a bookmark. Any absent field is left unchanged. For `notes`
/// we avoid the `Option<Option<T>>` serde pitfall (JSON `null` deserializes to
/// the *outer* `None`, i.e. "leave"): the field is a plain `Option<String>` and
/// an **empty string clears** the note while a non-empty string sets it.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBookmarkArgs {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub pinned: Option<bool>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// Absent ⇒ leave; empty string ⇒ clear; non-empty ⇒ set.
    #[serde(default)]
    pub notes: Option<String>,
}

#[tauri::command]
pub fn vault_update_bookmark(
    app: tauri::AppHandle,
    state: State<'_, VaultStateHandle>,
    args: UpdateBookmarkArgs,
) -> Result<(), String> {
    let notes = match args.notes {
        None => None,                                   // leave unchanged
        Some(s) if s.trim().is_empty() => Some(None),   // clear
        Some(s) => Some(clean_notes(Some(s))),          // set
    };
    let patch = BookmarkPatch {
        title: args.title.map(|t| clean_title(Some(&t), "")),
        pinned: args.pinned,
        tags: args.tags.map(clean_tags),
        notes,
    };
    state.update_bookmark(&args.id, patch)?;
    emit_update(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn vault_remove_bookmark(
    app: tauri::AppHandle,
    state: State<'_, VaultStateHandle>,
    id: String,
) -> Result<(), String> {
    state.remove_bookmark(&id)?;
    emit_update(&app, &state);
    Ok(())
}

// ── Phase 3: playlists & media ─────────────────────────────────────────────

fn clean_name(raw: &str) -> Result<String, String> {
    let n: String = raw.trim().chars().take(MAX_NAME_LEN).collect();
    if n.is_empty() {
        return Err("name_empty".into());
    }
    Ok(n)
}

fn clean_emoji(raw: Option<String>) -> Option<String> {
    raw.map(|e| e.trim().chars().take(MAX_EMOJI_LEN).collect::<String>())
        .filter(|e| !e.is_empty())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePlaylistArgs {
    pub name: String,
    pub emoji: Option<String>,
}

#[tauri::command]
pub fn vault_create_playlist(
    app: tauri::AppHandle,
    state: State<'_, VaultStateHandle>,
    args: CreatePlaylistArgs,
) -> Result<String, String> {
    let name = clean_name(&args.name)?;
    let now = now_ms();
    let playlist = Playlist {
        id: format!("p_{}", uuid::Uuid::new_v4()),
        name,
        emoji: clean_emoji(args.emoji),
        created_at_ms: now,
        updated_at_ms: now,
        item_ids: Vec::new(),
    };
    let saved = state.create_playlist(playlist)?;
    emit_update(&app, &state);
    Ok(saved.id)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlaylistArgs {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    /// Absent ⇒ leave; empty string ⇒ clear; non-empty ⇒ set.
    #[serde(default)]
    pub emoji: Option<String>,
}

#[tauri::command]
pub fn vault_update_playlist(
    app: tauri::AppHandle,
    state: State<'_, VaultStateHandle>,
    args: UpdatePlaylistArgs,
) -> Result<(), String> {
    let name = match args.name {
        Some(n) => Some(clean_name(&n)?),
        None => None,
    };
    let emoji = match args.emoji {
        None => None,                                   // leave unchanged
        Some(s) if s.trim().is_empty() => Some(None),   // clear
        Some(s) => Some(clean_emoji(Some(s))),          // set
    };
    state.update_playlist(&args.id, name, emoji, now_ms())?;
    emit_update(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn vault_delete_playlist(
    app: tauri::AppHandle,
    state: State<'_, VaultStateHandle>,
    id: String,
) -> Result<(), String> {
    state.delete_playlist(&id)?;
    emit_update(&app, &state);
    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddMediaArgs {
    pub url: String,
    pub page_title: Option<String>,
    pub media_title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub artwork_url: Option<String>,
    pub duration_secs: Option<f64>,
    pub media_match_rule: Option<String>,
    pub kind: Option<String>,
    pub source_os_browser_id: Option<String>,
}

fn opt_trim(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

#[tauri::command]
pub fn vault_add_media_to_playlist(
    app: tauri::AppHandle,
    state: State<'_, VaultStateHandle>,
    playlist_id: String,
    media: AddMediaArgs,
) -> Result<String, String> {
    let url = validate_url(&media.url)?;
    let normalized_url = url::normalize_url(&url);
    let kind = match media.kind.as_deref() {
        Some("video") => "video",
        Some("audio") => "audio",
        _ => "unknown",
    }
    .to_string();
    let item = MediaItem {
        id: format!("m_{}", uuid::Uuid::new_v4()),
        page_title: clean_title(media.page_title.as_deref(), &url),
        url,
        normalized_url,
        media_title: opt_trim(media.media_title),
        artist: opt_trim(media.artist),
        album: opt_trim(media.album),
        artwork_url: opt_trim(media.artwork_url),
        duration_secs: media.duration_secs.filter(|d| d.is_finite() && *d > 0.0),
        media_match_rule: opt_trim(media.media_match_rule),
        kind,
        source_os_browser_id: opt_trim(media.source_os_browser_id),
        added_at_ms: now_ms(),
        last_played_at_ms: None,
        play_count: 0,
    };
    let item_id = state.add_media_to_playlist(&playlist_id, item, now_ms())?;
    emit_update(&app, &state);
    Ok(item_id)
}

#[tauri::command]
pub fn vault_remove_from_playlist(
    app: tauri::AppHandle,
    state: State<'_, VaultStateHandle>,
    playlist_id: String,
    item_id: String,
) -> Result<(), String> {
    state.remove_from_playlist(&playlist_id, &item_id, now_ms())?;
    emit_update(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn vault_reorder_playlist(
    app: tauri::AppHandle,
    state: State<'_, VaultStateHandle>,
    playlist_id: String,
    item_ids: Vec<String>,
) -> Result<(), String> {
    if item_ids.len() > MAX_PLAYLIST_ITEMS {
        return Err("playlist_too_large".into());
    }
    state.reorder_playlist(&playlist_id, item_ids, now_ms())?;
    emit_update(&app, &state);
    Ok(())
}

// ── Phase 6: import / export ────────────────────────────────────────────────

/// Write the current vault to a user-chosen JSON file (atomic write reused from
/// `store`). The frontend supplies `path` via `tauri-plugin-dialog`.
#[tauri::command]
pub fn vault_export(state: State<'_, VaultStateHandle>, path: String) -> Result<(), String> {
    let data = state.snapshot();
    super::store::save_to(std::path::Path::new(&path), &data)
}

/// Replace the vault with the contents of a user-chosen JSON file. Corrupt or
/// future-versioned files are rejected by `store::load_from` (which backs them
/// up and yields an empty vault), so a bad import cannot crash the app.
#[tauri::command]
pub fn vault_import(
    app: tauri::AppHandle,
    state: State<'_, VaultStateHandle>,
    path: String,
) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err("import_file_missing".into());
    }
    let data = super::store::load_from(p);
    state.replace_all(data);
    emit_update(&app, &state);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_url_rejects_non_http() {
        assert!(validate_url("ftp://x.com").is_err());
        assert!(validate_url("javascript:alert(1)").is_err());
        assert!(validate_url("").is_err());
        assert!(validate_url("https://ok.com").is_ok());
    }

    #[test]
    fn clean_title_falls_back_to_url() {
        assert_eq!(clean_title(Some("  "), "https://x"), "https://x");
        assert_eq!(clean_title(Some(" Hi "), "https://x"), "Hi");
        assert_eq!(clean_title(None, "https://x"), "https://x");
    }

    #[test]
    fn clean_tags_dedupes_and_bounds() {
        let out = clean_tags(vec![
            " a ".into(),
            "a".into(),
            "".into(),
            "b".into(),
        ]);
        assert_eq!(out, vec!["a".to_string(), "b".to_string()]);
    }
}
