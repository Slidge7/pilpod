pub mod dto;

#[cfg(windows)]
mod mapping;
#[cfg(windows)]
mod audio_attach;
#[cfg(windows)]
pub(crate) mod state;
#[cfg(windows)]
mod thumbnail;

#[cfg(windows)]
pub use state::GsmtcState;

#[cfg(windows)]
pub mod commands;

/// Tauri event name emitted by the GSMTC manager whenever sessions change.
/// Must stay in sync with `GSMTC_UPDATE_EVENT` in the frontend.
pub const EVT_UPDATE: &str = "gsmtc://update";

/// Tauri event name emitted when the GSMTC manager fails to start.
/// Must stay in sync with `GSMTC_INIT_ERROR_EVENT` in the frontend.
pub const EVT_INIT_ERROR: &str = "gsmtc://init-error";
