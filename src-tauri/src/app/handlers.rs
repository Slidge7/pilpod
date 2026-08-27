use tauri::Wry;

// ── Platform aliases ────────────────────────────────────────────────────────
//
// Windows carries the real implementations; every other platform gets the
// fallbacks in `platform::stub_commands`. Aliasing the *modules* here is what
// lets the command list below be written exactly once.
//
// It used to be written twice — one `generate_handler!` per platform — and the
// two had already drifted: the eight `extension_setup_*` commands existed only
// in the Windows list, so off-Windows the frontend's invokes failed with
// "command not found" instead of hitting a stub that degrades politely.
//
// This works because `generate_handler!` rewrites only the *last* segment of
// each path into the generated wrapper ident, leaving the prefix untouched — so
// a module alias resolves exactly like the full path would.

#[cfg(windows)]
use crate::browser_audio as audio_cmds;
#[cfg(not(windows))]
use crate::platform::stub_commands as audio_cmds;

#[cfg(windows)]
use crate::browser_bridge::command as bridge_cmds;
#[cfg(not(windows))]
use crate::platform::stub_commands as bridge_cmds;

#[cfg(windows)]
use crate::browser_commands as browser_cmds;
#[cfg(not(windows))]
use crate::platform::stub_commands as browser_cmds;

#[cfg(windows)]
use crate::extension_setup::commands as setup_cmds;
#[cfg(not(windows))]
use crate::platform::stub_commands as setup_cmds;

#[cfg(windows)]
use crate::vault::open as vault_open_cmds;
#[cfg(not(windows))]
use crate::platform::stub_commands as vault_open_cmds;

#[cfg(windows)]
use crate::playlist_player::commands as player_cmds;
#[cfg(not(windows))]
use crate::platform::stub_commands as player_cmds;

#[cfg(windows)]
use crate::inapp_player::commands as inapp_cmds;
#[cfg(not(windows))]
use crate::platform::stub_commands as inapp_cmds;

// The dev lab is a debug-build tool. Its commands poke at live bridge state —
// killing sockets, injecting stale slots, faking a resume — and there is no
// reason for any of that to exist in a shipped binary. The frontend already
// hides the entry point behind `import.meta.env.DEV`; this makes the Rust side
// agree instead of leaving ten commands reachable in release.
#[cfg(all(windows, debug_assertions))]
use crate::dev_lab as dev_cmds;
#[cfg(all(not(windows), debug_assertions))]
use crate::platform::stub_commands as dev_cmds;

/// The command surface, written once. `$dev` is the debug-only tail — passed as
/// raw token trees so the paths reach `generate_handler!` untouched.
macro_rules! pilpod_invoke_handler {
    ($builder:expr, [$($dev:tt)*]) => {
        $builder.invoke_handler(tauri::generate_handler![
            audio_cmds::mixer_set_volume,
            bridge_cmds::browser_media_control,
            browser_cmds::get_browsers,
            browser_cmds::refresh_browser_connection,
            browser_cmds::request_browser_sync,
            // The widget is platform-neutral — real commands everywhere.
            crate::widget::commands::widget_get_state,
            crate::widget::commands::widget_set_enabled,
            crate::widget::commands::widget_set_placement,
            crate::widget::commands::widget_use_free_placement,
            crate::widget::commands::widget_set_accent,
            crate::widget::commands::widget_set_size,
            crate::widget::commands::widget_set_preview,
            crate::widget::commands::widget_open_main,
            crate::widget::commands::widget_hide_main,
            crate::widget::commands::widget_relayout,
            setup_cmds::extension_setup_overview,
            setup_cmds::extension_setup_gate_state,
            setup_cmds::extension_setup_open_listing,
            setup_cmds::extension_setup_open_extensions_page,
            setup_cmds::extension_setup_skip,
            setup_cmds::extension_setup_cancel,
            setup_cmds::extension_setup_set_dismissed,
            setup_cmds::extension_setup_reset,
            crate::wallpaper::list_wallpapers,
            crate::wallpaper::read_wallpaper,
            crate::wallpaper::list_folder_images,
            crate::wallpaper::read_image_file,
            crate::premium::commands::premium_get_status,
            crate::premium::commands::premium_activate,
            crate::premium::commands::premium_deactivate,
            // Vault is platform-neutral — real commands everywhere.
            crate::vault::commands::vault_get_state,
            crate::vault::commands::vault_add_bookmark,
            crate::vault::commands::vault_update_bookmark,
            crate::vault::commands::vault_remove_bookmark,
            crate::vault::commands::vault_create_collection,
            crate::vault::commands::vault_update_collection,
            crate::vault::commands::vault_delete_collection,
            crate::vault::commands::vault_toggle_bookmark_collection,
            crate::vault::commands::vault_save_bookmark_to_collection,
            crate::vault::commands::vault_create_playlist,
            crate::vault::commands::vault_update_playlist,
            crate::vault::commands::vault_delete_playlist,
            crate::vault::commands::vault_add_media_to_playlist,
            crate::vault::commands::vault_remove_from_playlist,
            crate::vault::commands::vault_reorder_playlist,
            crate::vault::commands::vault_export,
            crate::vault::commands::vault_import,
            // Smart open reaches into the browser subsystem — Windows-only.
            vault_open_cmds::vault_open_entry,
            player_cmds::player_get_state,
            player_cmds::player_start,
            player_cmds::player_stop,
            player_cmds::player_next,
            player_cmds::player_prev,
            player_cmds::player_play_item,
            player_cmds::player_set_modes,
            inapp_cmds::inapp_get_media,
            inapp_cmds::inapp_drag_window,
            inapp_cmds::inapp_minimize_window,
            inapp_cmds::inapp_stage_get,
            inapp_cmds::inapp_stage_report,
            inapp_cmds::inapp_stage_ended,
            $($dev)*
        ])
    };
}

#[cfg(debug_assertions)]
pub fn with_invoke_handler(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    pilpod_invoke_handler!(builder, [
        dev_cmds::open_dev_lab_window,
        dev_cmds::dev_scan_os_browsers,
        dev_cmds::dev_wake_and_sync_browser,
        dev_cmds::dev_get_full_state,
        dev_cmds::dev_kill_ws,
        dev_cmds::dev_clear_ext_installed,
        dev_cmds::dev_clear_icon_cache,
        dev_cmds::dev_inject_stale_slot,
        dev_cmds::dev_gc_slots_now,
        dev_cmds::dev_simulate_resume,
    ])
}

#[cfg(not(debug_assertions))]
pub fn with_invoke_handler(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    pilpod_invoke_handler!(builder, [])
}
