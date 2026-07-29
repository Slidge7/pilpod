mod app;
mod premium;
mod vault;
// Platform-neutral: pure file I/O + a state machine. The Windows-only pieces
// (browser launching, registry paths) live behind cfg gates inside the module.
//
// TODO(phase-5): drop `allow(dead_code)` — a few read accessors and the
// `forget`/`state_of` helpers are exercised only by unit tests until the
// dev-lab activation panel lands.
#[allow(dead_code)]
mod extension_setup;
#[cfg(windows)]
mod downloader;
mod browser_dto;
mod browser_tabs;
#[cfg(windows)]
mod browser_audio;
#[cfg(windows)]
mod dev_lab;
#[cfg(windows)]
mod browser_bridge;
#[cfg(windows)]
mod browser_commands;
#[cfg(windows)]
mod browser_catalog;
#[cfg(windows)]
mod browser_icon;
#[cfg(windows)]
mod browser_profile_order;
#[cfg(windows)]
mod browser_detector;
#[cfg(windows)]
mod browser_os_scan;
#[cfg(windows)]
mod browser_focus_win;
#[cfg(windows)]
mod audio_mixer;
#[cfg(windows)]
mod playlist_player;
#[cfg(windows)]
mod inapp_player;
mod wallpaper;
// The floating widget owns its own top-level window and does its placement
// math over plain integers — no Windows-only APIs, so it builds everywhere
// Tauri does. Supersedes the old `window_widget` module, which implemented
// "widget mode" by shrinking the main window.
mod widget;
#[cfg(not(windows))]
mod platform;

pub use app::run;
