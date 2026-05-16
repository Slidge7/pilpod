//! Local HTTP endpoint so the Chromium companion extension can POST per-tab media.
//! Each browser instance sends a stable `browserId`; the backend keeps one slot per
//! browser so Opera and Chrome never overwrite each other. Tab lifecycle and removals
//! are driven by the extension payload; a slot is hidden only when the extension reports
//! `connectionState: disconnected` and we have not received a successful POST for >1s
//! (see `crate::browser_tabs::flatten_tabs`).
//!
//! Bind: 127.0.0.1 only. See `extensions/pilpod-companion`.

pub mod command;
mod http;

pub use http::spawn;

pub const BROWSER_BRIDGE_PORT: u16 = 17_399;
pub const BROWSER_MEDIA_PATH: &str = "/browser-media";
