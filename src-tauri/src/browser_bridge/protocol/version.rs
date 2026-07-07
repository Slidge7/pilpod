//! Version negotiation for protocol v2. The server accepts only `v == 2`
//! (no backward compatibility, per the v2 mandate) and answers `hello` with a
//! server-driven capability set.

use super::frames::WelcomeCaps;

pub const PROTOCOL_VERSION: u8 = 2;
pub const BRIDGE_VERSION: &str = "2.0";

/// Minimum companion extension version the bridge will talk to. Must be <= the
/// version the shipped companion actually reports (see `pilpod-companion/manifest.json`,
/// currently 2.0.0) or the `hello` gate in `ws.rs` will reject the live extension.
pub const MIN_EXT_VERSION: &str = "2.0.0";

// Negotiated capability defaults (mirrors DEFAULT_CAPS in messages.js).
pub const PROGRESS_HZ: u32 = 5;
pub const IDLE_PING_MS: u64 = 15_000;
pub const DELTA_DEBOUNCE_MS: u64 = 40;
pub const MAX_TABS: u32 = 500;

/// Negotiate against a client-advertised protocol version. Returns the caps to
/// embed in `welcome`, or `Err` if the version is unsupported.
pub fn negotiate(v: u8) -> Result<WelcomeCaps, VersionError> {
    if v != PROTOCOL_VERSION {
        return Err(VersionError::Unsupported(v));
    }
    Ok(default_caps())
}

pub fn default_caps() -> WelcomeCaps {
    WelcomeCaps {
        progress_hz: PROGRESS_HZ,
        idle_ping_ms: IDLE_PING_MS,
        delta_debounce_ms: DELTA_DEBOUNCE_MS,
        max_tabs: MAX_TABS,
    }
}

/// Compare two dotted version strings (major.minor.patch). Returns true when
/// `have` >= `want`. Missing components are treated as 0; unparseable as 0.
pub fn version_at_least(have: &str, want: &str) -> bool {
    let parse = |s: &str| -> [u64; 3] {
        let mut out = [0u64; 3];
        for (i, part) in s.split('.').take(3).enumerate() {
            out[i] = part.trim().parse().unwrap_or(0);
        }
        out
    };
    parse(have) >= parse(want)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VersionError {
    Unsupported(u8),
}

impl std::fmt::Display for VersionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VersionError::Unsupported(v) => write!(f, "unsupported protocol version: {v}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negotiate_accepts_v2_only() {
        assert!(negotiate(2).is_ok());
        assert_eq!(negotiate(1), Err(VersionError::Unsupported(1)));
        assert_eq!(negotiate(3), Err(VersionError::Unsupported(3)));
    }

    #[test]
    fn version_compare() {
        assert!(version_at_least("3.0.0", "3.0.0"));
        assert!(version_at_least("3.1.0", "3.0.0"));
        assert!(version_at_least("3.0.1", "3.0.0"));
        assert!(!version_at_least("2.9.9", "3.0.0"));
        assert!(version_at_least("3", "3.0.0"));
    }
}
