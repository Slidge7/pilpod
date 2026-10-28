//! God Mode — the all-seeing overview window.
//!
//! One large page showing everything PilPod knows at once: every browser
//! profile and its connection state, every window and tab as a thumbnail card,
//! the media playing across all of them, and PilPod's own runtime (playlist
//! player, floating widget).
//!
//! Unlike the dev lab this is a shipped feature, not a diagnostic tool: it only
//! *reads* state that is already broadcast to every window (`browsers://update`,
//! `player://update`, `widget://state`) and acts through the same commands the
//! dashboard uses. So it needs no state of its own and no command beyond the one
//! that opens it — keep it that way, and new data reaches it by being broadcast,
//! not by growing a second query surface here.

use tauri::AppHandle;

use crate::aux_window::{self, AuxWindowSpec};

/// Window label. Mirrored by `GOD_MODE_LABEL` in `src/features/god-mode`, and
/// by the `god-mode` capability.
pub const GOD_MODE_LABEL: &str = "god-mode";

const WINDOW: AuxWindowSpec = AuxWindowSpec {
    label: GOD_MODE_LABEL,
    title: "PilPod God Mode",
    size: (1480.0, 920.0),
    min_size: (960.0, 620.0),
};

#[tauri::command]
pub async fn open_god_mode_window(app: AppHandle) -> Result<(), String> {
    aux_window::open(app, WINDOW).await
}
