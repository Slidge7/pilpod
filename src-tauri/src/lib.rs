mod app;
mod browser_tabs;
#[cfg(windows)]
mod browser_bridge;
#[cfg(windows)]
mod browser_commands;
#[cfg(windows)]
mod browser_detector;
#[cfg(windows)]
mod browser_focus_win;
#[cfg(windows)]
mod audio_mixer;
mod gsmtc;
#[cfg(not(windows))]
mod platform;
#[cfg(windows)]
mod window_widget;

pub use app::run;
