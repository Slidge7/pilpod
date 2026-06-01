mod app;
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
mod browser_detector;
#[cfg(windows)]
mod browser_os_scan;
#[cfg(windows)]
mod browser_focus_win;
#[cfg(windows)]
mod audio_mixer;
mod wallpaper;
#[cfg(not(windows))]
mod platform;
#[cfg(windows)]
mod window_widget;

pub use app::run;
