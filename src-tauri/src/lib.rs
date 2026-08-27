mod app;
// Durable tmp+rename writes shared by every on-disk store (vault, widget
// settings, extension activation, license token).
mod atomic_file;
mod premium;
mod vault;
// Every window that is not `main` resolves its own document. One module owns
// that decision so the dev-server-vs-bundled-asset branch cannot be written
// wrong twice — see the module docs for the release-only blank-window bug it
// was extracted to fix.
mod frontend;
// Platform-neutral: pure file I/O + a state machine. The Windows-only pieces
// (browser launching, registry paths) live behind cfg gates inside the module.
//
// TODO(phase-5): drop `allow(dead_code)` — a few read accessors and the
// `forget`/`state_of` helpers are exercised only by unit tests until the
// dev-lab activation panel lands.
#[allow(dead_code)]
mod extension_setup;

mod browser_dto;
mod browser_tabs;
#[cfg(windows)]
mod browser_audio;
// Debug-only. The dev lab kills live sockets, injects stale slots and fakes
// resume events; none of that belongs in a shipped binary. The frontend
// already hides its entry point behind `import.meta.env.DEV` — this makes
// the Rust side agree instead of leaving ten commands reachable in release.
#[cfg(all(windows, debug_assertions))]
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
// Running with no dashboard on screen: the tray icon, and the rule that
// decides which of the two PilPod surfaces is showing. Cross-platform — the
// tray and window calls it makes are all Tauri-level.
mod background;
// Platform shims. The module itself is cross-platform; its contents are gated
// per-OS (`stub_commands` off-Windows, `window_corners` on Windows).
mod platform;

pub use app::run;
