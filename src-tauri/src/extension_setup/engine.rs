//! Per-browser extension-store capability table.
//!
//! Answers three questions the setup UI needs for each detected browser:
//!
//! 1. **Which rendering engine?** Decides which guide variant the frontend picks.
//! 2. **Can it install from the Chrome Web Store, and at what cost?**
//!    Chrome installs in one click; Edge and Opera each need a one-time opt-in
//!    the guide has to explain; Gecko browsers cannot install a CWS item at all.
//! 3. **Where is its own extensions page?** Used by the troubleshooting panel to
//!    let the user confirm the extension is present *and enabled*.
//!
//! # Why this is a separate table and not fields on `BrowserCatalogEntry`
//!
//! `browser_catalog` is `#[cfg(windows)]` (registry + Win32 process enumeration).
//! Keeping this table standalone lets the whole `extension_setup` module compile
//! and unit-test on any platform. Drift is prevented mechanically rather than by
//! discipline: [`tests::table_matches_catalog_exactly`] (Windows-only) fails the
//! build if a browser is added to the catalog without an entry here, or vice
//! versa. Adding a browser is therefore: one catalog row + one row below.

use serde::Serialize;

/// Browser rendering engine — determines which guide the frontend renders.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EngineFamily {
    Chromium,
    Gecko,
}

/// How much work installing the Chrome Web Store item takes in this browser.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StoreSupport {
    /// One click: "Add to <Browser>" works straight from the listing.
    Native,
    /// Works, but only after a one-time browser setting or helper add-on.
    /// The guide inserts an extra pre-step for these.
    NeedsOptIn,
    /// Cannot install a Chrome Web Store item. Shown as "not supported yet".
    Unsupported,
}

/// Store-related capabilities of one browser.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserEngineInfo {
    pub id: &'static str,
    pub engine: EngineFamily,
    pub store_support: StoreSupport,
    /// The browser's own extensions page (`chrome://extensions`, …).
    /// `None` when we have no reliable deep link for it.
    pub extensions_page: Option<&'static str>,
}

impl BrowserEngineInfo {
    /// True when it is worth showing this browser a setup flow at all.
    pub fn can_install(&self) -> bool {
        !matches!(self.store_support, StoreSupport::Unsupported)
    }
}

/// Fallback for a browser we have no entry for — treated as unsupported rather
/// than optimistically Chromium, so an unknown browser never gets a guide that
/// walks the user into a dead end.
pub const UNKNOWN: BrowserEngineInfo = BrowserEngineInfo {
    id: "unknown",
    engine: EngineFamily::Chromium,
    store_support: StoreSupport::Unsupported,
    extensions_page: None,
};

/// One row per `browser_catalog::CATALOG` entry. Order mirrors the catalog.
pub const ENGINES: &[BrowserEngineInfo] = &[
    // ── Chromium family ─────────────────────────────────────────────────────
    BrowserEngineInfo {
        // Edge blocks other stores until the user accepts the
        // "Allow extensions from other stores" banner shown on the CWS listing.
        id: "msedge",
        engine: EngineFamily::Chromium,
        store_support: StoreSupport::NeedsOptIn,
        extensions_page: Some("edge://extensions"),
    },
    BrowserEngineInfo {
        id: "chrome",
        engine: EngineFamily::Chromium,
        store_support: StoreSupport::Native,
        extensions_page: Some("chrome://extensions"),
    },
    BrowserEngineInfo {
        id: "brave",
        engine: EngineFamily::Chromium,
        store_support: StoreSupport::Native,
        extensions_page: Some("brave://extensions"),
    },
    BrowserEngineInfo {
        // Opera (both editions) needs the "Install Chrome Extensions" add-on
        // from Opera's own store before CWS items can be added.
        id: "operagx",
        engine: EngineFamily::Chromium,
        store_support: StoreSupport::NeedsOptIn,
        extensions_page: Some("opera://extensions"),
    },
    BrowserEngineInfo {
        id: "opera",
        engine: EngineFamily::Chromium,
        store_support: StoreSupport::NeedsOptIn,
        extensions_page: Some("opera://extensions"),
    },
    BrowserEngineInfo {
        id: "vivaldi",
        engine: EngineFamily::Chromium,
        store_support: StoreSupport::Native,
        extensions_page: Some("vivaldi://extensions"),
    },
    BrowserEngineInfo {
        // Plain Chromium builds use the Chrome scheme for their own pages.
        id: "chromium",
        engine: EngineFamily::Chromium,
        store_support: StoreSupport::Native,
        extensions_page: Some("chrome://extensions"),
    },
    BrowserEngineInfo {
        // Arc is Chromium and keeps the `chrome://` internal scheme.
        id: "arc",
        engine: EngineFamily::Chromium,
        store_support: StoreSupport::Native,
        extensions_page: Some("chrome://extensions"),
    },
    BrowserEngineInfo {
        // Yandex ships its own add-on catalogue but installs CWS items directly;
        // its internal pages live under `browser://`.
        id: "yandex",
        engine: EngineFamily::Chromium,
        store_support: StoreSupport::Native,
        extensions_page: Some("browser://extensions"),
    },
    // ── Gecko family — no Chrome Web Store path ─────────────────────────────
    BrowserEngineInfo {
        // Tor Browser additionally discourages extensions for fingerprinting
        // reasons; excluded regardless of engine.
        id: "tor",
        engine: EngineFamily::Gecko,
        store_support: StoreSupport::Unsupported,
        extensions_page: None,
    },
    BrowserEngineInfo {
        id: "firefox",
        engine: EngineFamily::Gecko,
        store_support: StoreSupport::Unsupported,
        extensions_page: None,
    },
    BrowserEngineInfo {
        id: "librewolf",
        engine: EngineFamily::Gecko,
        store_support: StoreSupport::Unsupported,
        extensions_page: None,
    },
    BrowserEngineInfo {
        id: "waterfox",
        engine: EngineFamily::Gecko,
        store_support: StoreSupport::Unsupported,
        extensions_page: None,
    },
];

/// Look up a browser's capabilities, or `None` if it is not in the table.
pub fn engine_for(os_browser_id: &str) -> Option<&'static BrowserEngineInfo> {
    ENGINES.iter().find(|e| e.id == os_browser_id)
}

/// Look up a browser's capabilities, falling back to [`UNKNOWN`].
pub fn engine_or_unknown(os_browser_id: &str) -> &'static BrowserEngineInfo {
    engine_for(os_browser_id).unwrap_or(&UNKNOWN)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_id_is_unique() {
        let mut ids: Vec<&str> = ENGINES.iter().map(|e| e.id).collect();
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), count, "duplicate id in ENGINES");
    }

    #[test]
    fn chromium_entries_have_an_extensions_page() {
        for e in ENGINES.iter().filter(|e| e.engine == EngineFamily::Chromium) {
            assert!(
                e.extensions_page.is_some(),
                "{} is Chromium but has no extensions page",
                e.id
            );
        }
    }

    #[test]
    fn extensions_pages_are_well_formed_internal_urls() {
        for e in ENGINES {
            let Some(page) = e.extensions_page else {
                continue;
            };
            assert!(
                page.ends_with("://extensions"),
                "{}: {page} should be a `<scheme>://extensions` URL",
                e.id
            );
            assert!(!page.ends_with('/'), "{}: no trailing slash", e.id);
        }
    }

    #[test]
    fn gecko_is_unsupported_and_has_no_deep_link() {
        for e in ENGINES.iter().filter(|e| e.engine == EngineFamily::Gecko) {
            assert_eq!(
                e.store_support,
                StoreSupport::Unsupported,
                "{} is Gecko and cannot install a Chrome Web Store item",
                e.id
            );
            assert!(e.extensions_page.is_none(), "{}", e.id);
            assert!(!e.can_install(), "{}", e.id);
        }
    }

    #[test]
    fn known_opt_in_browsers_are_flagged() {
        // These three are the reason `NeedsOptIn` exists: shipping them as
        // `Native` would send users to a listing whose install button silently
        // does nothing.
        for id in ["msedge", "opera", "operagx"] {
            assert_eq!(
                engine_or_unknown(id).store_support,
                StoreSupport::NeedsOptIn,
                "{id} needs a one-time opt-in step in the guide"
            );
        }
        assert_eq!(
            engine_or_unknown("chrome").store_support,
            StoreSupport::Native
        );
    }

    #[test]
    fn edge_deep_link_uses_the_edge_scheme() {
        // Regression guard for the copy/paste failure mode of duplicating the
        // Chrome row and forgetting to change the scheme.
        for (id, scheme) in [
            ("msedge", "edge://"),
            ("brave", "brave://"),
            ("vivaldi", "vivaldi://"),
            ("opera", "opera://"),
            ("operagx", "opera://"),
            ("yandex", "browser://"),
        ] {
            let page = engine_or_unknown(id).extensions_page.unwrap();
            assert!(page.starts_with(scheme), "{id}: expected {scheme}, got {page}");
        }
    }

    #[test]
    fn unknown_browser_falls_back_to_unsupported() {
        assert!(engine_for("netscape").is_none());
        let info = engine_or_unknown("netscape");
        assert_eq!(info.store_support, StoreSupport::Unsupported);
        assert!(!info.can_install());
        assert!(
            info.extensions_page.is_none(),
            "never hand the UI a deep link we cannot vouch for"
        );
    }

    #[test]
    fn serializes_camel_case_for_the_frontend() {
        let json = serde_json::to_string(&engine_or_unknown("msedge")).unwrap();
        assert!(json.contains("\"storeSupport\":\"needsOptIn\""), "{json}");
        assert!(json.contains("\"engine\":\"chromium\""), "{json}");
        assert!(json.contains("\"extensionsPage\":\"edge://extensions\""), "{json}");
    }

    /// The anti-drift guard. Adding a browser to the catalog without adding it
    /// here (or removing one and leaving a stale row) fails the suite.
    #[cfg(windows)]
    #[test]
    fn table_matches_catalog_exactly() {
        use std::collections::BTreeSet;

        let catalog: BTreeSet<&str> = crate::browser_catalog::CATALOG
            .iter()
            .map(|e| e.id)
            .collect();
        let table: BTreeSet<&str> = ENGINES.iter().map(|e| e.id).collect();

        let missing: Vec<_> = catalog.difference(&table).collect();
        assert!(
            missing.is_empty(),
            "browsers in the catalog with no engine entry: {missing:?} \
             — add a row to extension_setup::engine::ENGINES"
        );

        let stale: Vec<_> = table.difference(&catalog).collect();
        assert!(
            stale.is_empty(),
            "engine entries for browsers not in the catalog: {stale:?}"
        );
    }
}
