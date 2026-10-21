//! Published-extension coordinates — the *only* place the store identity lives.
//!
//! The companion ships as an **unlisted** Chrome Web Store item. Unlisted means
//! it does not appear in search and has no public category page, but anyone with
//! the direct URL can install it normally (one click, no Developer Mode). If the
//! item is ever re-published under a new id, editing [`EXTENSION_ID`] is the
//! entire change — nothing else in the codebase hardcodes it.

/// Chrome Web Store item id for **PilPod Companion** (unlisted).
pub const EXTENSION_ID: &str = "ooogjmdnagfepkocppnldkafbcbmdhal";

/// Canonical listing URL. Deliberately built without `authuser`/`hl` query
/// parameters: `authuser` pins the link to whichever Google account slot the
/// *developer* was signed into, which is meaningless (and sometimes a 404) on
/// the user's machine.
pub fn store_listing_url() -> String {
    format!("https://chromewebstore.google.com/detail/{EXTENSION_ID}")
}

/// Direct link to the extension's entry on a Chromium browser's own extensions
/// page. Used by the troubleshooting panel to let the user confirm the
/// extension is present *and enabled* after installing.
///
/// `extensions_page` is the browser's own scheme root (e.g. `chrome://extensions`),
/// supplied by the catalog — this function only appends the item path.
pub fn extension_detail_url(extensions_page: &str) -> String {
    extension_detail_url_for(extensions_page, EXTENSION_ID)
}

/// [`extension_detail_url`] for a specific installed id — the store id, or a
/// developer's unpacked copy.
pub fn extension_detail_url_for(extensions_page: &str, extension_id: &str) -> String {
    format!("{}/?id={extension_id}", extensions_page.trim_end_matches('/'))
}

/// The companion's options page, relative to its root. This is where the user
/// turns the desktop connection on (it is off by default and consent-gated), so
/// it is where "installed but not connected" sends them.
pub const OPTIONS_PAGE_PATH: &str = "src/ui/options.html";

/// Absolute URL of the companion's options page for an installed id.
/// `chrome-extension://` is understood by every Chromium fork, Edge included.
pub fn options_page_url(extension_id: &str) -> String {
    format!("chrome-extension://{extension_id}/{OPTIONS_PAGE_PATH}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listing_url_is_canonical_and_param_free() {
        let url = store_listing_url();
        assert_eq!(
            url,
            "https://chromewebstore.google.com/detail/ooogjmdnagfepkocppnldkafbcbmdhal"
        );
        // Regression guard: a developer pasting a browser-bar URL back into the
        // constant would drag `?authuser=0&hl=en` along with it.
        assert!(!url.contains('?'), "listing URL must carry no query params");
        assert!(!url.contains("authuser"));
    }

    #[test]
    fn detail_url_targets_the_published_id() {
        assert_eq!(
            extension_detail_url("chrome://extensions"),
            "chrome://extensions/?id=ooogjmdnagfepkocppnldkafbcbmdhal"
        );
        // Trailing slash must not double up.
        assert_eq!(
            extension_detail_url("edge://extensions/"),
            "edge://extensions/?id=ooogjmdnagfepkocppnldkafbcbmdhal"
        );
    }

    #[test]
    fn options_url_targets_the_installed_id() {
        assert_eq!(
            options_page_url(EXTENSION_ID),
            "chrome-extension://ooogjmdnagfepkocppnldkafbcbmdhal/src/ui/options.html"
        );
        assert_eq!(
            extension_detail_url_for("edge://extensions", "abc"),
            "edge://extensions/?id=abc"
        );
    }

    #[test]
    fn extension_id_looks_like_a_web_store_id() {
        // CWS ids are exactly 32 lowercase letters a–p.
        assert_eq!(EXTENSION_ID.len(), 32);
        assert!(EXTENSION_ID.chars().all(|c| ('a'..='p').contains(&c)));
    }
}
