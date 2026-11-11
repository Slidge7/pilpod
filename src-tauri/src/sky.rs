//! PilPod Sky — the window that sees everything from above.
//!
//! One large page over everything PilPod knows and keeps: every browser
//! profile, window and tab live; the media playing across all of them;
//! history; the vault's bookmarks and playlists; PilPod's own runtime
//! (playlist player, floating widget); and one search across all of it.
//!
//! It is a shipped feature, not a diagnostic tool, and it owns no state: it
//! *reads* what is already broadcast to every window (`browsers://update`,
//! `player://update`, `widget://state`, `vault://update`, `history://changed`)
//! and acts through the same commands the dashboard uses. So it needs no
//! command beyond the one that opens it — keep it that way: new data reaches
//! it by being broadcast, not by growing a second query surface here.

use tauri::AppHandle;

use crate::aux_window::{self, AuxWindowSpec};

/// Window label. Mirrored by `SKY_LABEL` in `src/features/sky`, and by the
/// `sky` capability.
pub const SKY_LABEL: &str = "sky";

const WINDOW: AuxWindowSpec = AuxWindowSpec {
    label: SKY_LABEL,
    title: "PilPod Sky",
    size: (1480.0, 920.0),
    min_size: (960.0, 620.0),
};

#[tauri::command]
pub async fn open_sky_window(app: AppHandle) -> Result<(), String> {
    aux_window::open(app, WINDOW).await
}
