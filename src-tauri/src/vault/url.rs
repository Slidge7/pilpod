//! URL normalization — the dedupe + live-tab-matching key for the vault.
//!
//! Two saved entries are "the same page" iff their normalized URLs are equal,
//! and a saved entry is "live" iff a currently synced tab normalizes to the
//! same string (Phase 5 smart open). The rules are therefore load-bearing for
//! correctness, and this file is mirrored in
//! `src/features/vault/lib/normalizeUrl.ts`. Both sides are validated against
//! the shared vectors in `vault/testdata/url_vectors.json` so they can never
//! silently drift.
//!
//! Rules (deliberately conservative — we never want to merge two genuinely
//! different pages):
//!   * lowercase the scheme and host only (paths and query values stay as-is —
//!     they are case-sensitive on the wire);
//!   * strip any `userinfo@` and a trailing dot on the host;
//!   * drop the default port (80 for http, 443 for https);
//!   * drop the fragment (`#...`);
//!   * drop a lone root path so `example.com` and `example.com/` unify, and
//!     strip a single trailing slash elsewhere;
//!   * remove known tracking params, then sort the survivors by key then value
//!     so query-param order never affects identity.
//!
//! No URL crate is used (zero new deps); the parse is intentionally simple and
//! string-based. `www.` is NOT stripped — that is an opinionated merge we avoid.

/// Query keys removed entirely before comparison. Anything starting with
/// `utm_` is also stripped (handled in [`is_tracking_param`]).
const TRACKING_PARAMS: &[&str] = &[
    "gclid", "gclsrc", "dclid", "fbclid", "msclkid", "yclid", "twclid",
    "mc_eid", "mc_cid", "igshid", "_ga", "_gl", "_hsenc", "_hsmi", "spm",
    "vero_id", "wickedid", "oly_enc_id", "oly_anon_id",
];

fn is_tracking_param(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    k.starts_with("utm_") || TRACKING_PARAMS.contains(&k.as_str())
}

/// Normalize `input` per the module rules. Empty/whitespace input → `""`.
/// Input without a scheme is treated as `authority[/path]` (scheme omitted from
/// the output). The function never panics.
pub fn normalize_url(input: &str) -> String {
    let raw = input.trim();
    if raw.is_empty() {
        return String::new();
    }

    // Drop the fragment first — it never participates in identity.
    let no_frag = raw.split('#').next().unwrap_or("");

    // Split scheme.
    let (scheme, after_scheme) = match no_frag.find("://") {
        Some(i) => (no_frag[..i].to_ascii_lowercase(), &no_frag[i + 3..]),
        None => (String::new(), no_frag),
    };

    // Split authority from path+query at the first '/'.
    let (authority, path_query) = match after_scheme.find('/') {
        Some(i) => (&after_scheme[..i], &after_scheme[i..]),
        None => (after_scheme, ""),
    };

    // authority = [userinfo@]host[:port]. Drop userinfo.
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    let (host_raw, port) = match host_port.rfind(':') {
        Some(i) => (&host_port[..i], Some(&host_port[i + 1..])),
        None => (host_port, None),
    };
    let host = host_raw.trim_end_matches('.').to_ascii_lowercase();

    // Drop the default port for the scheme.
    let port_out = match (scheme.as_str(), port) {
        ("http", Some("80")) | ("https", Some("443")) => None,
        (_, p) => p,
    };

    // Split path and query.
    let (path_raw, query) = match path_query.find('?') {
        Some(i) => (&path_query[..i], Some(&path_query[i + 1..])),
        None => (path_query, None),
    };

    // Path: collapse a lone root to empty; strip a trailing slash otherwise.
    let mut path = path_raw.to_string();
    if path == "/" {
        path.clear();
    } else {
        while path.len() > 1 && path.ends_with('/') {
            path.pop();
        }
    }

    // Query: filter tracking params, then sort by (key, value) for stability.
    let query_out = query.and_then(|q| {
        let mut pairs: Vec<(String, String)> = q
            .split('&')
            .filter(|s| !s.is_empty())
            .map(|kv| match kv.find('=') {
                Some(i) => (kv[..i].to_string(), kv[i + 1..].to_string()),
                None => (kv.to_string(), String::new()),
            })
            .filter(|(k, _)| !is_tracking_param(k))
            .collect();
        pairs.sort();
        if pairs.is_empty() {
            return None;
        }
        Some(
            pairs
                .into_iter()
                .map(|(k, v)| if v.is_empty() { k } else { format!("{k}={v}") })
                .collect::<Vec<_>>()
                .join("&"),
        )
    });

    // Reassemble.
    let mut out = String::new();
    if !scheme.is_empty() {
        out.push_str(&scheme);
        out.push_str("://");
    }
    out.push_str(&host);
    if let Some(p) = port_out {
        out.push(':');
        out.push_str(p);
    }
    out.push_str(&path);
    if let Some(q) = query_out {
        out.push('?');
        out.push_str(&q);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Vector {
        input: String,
        expected: String,
    }

    /// The single source of truth shared with the TypeScript mirror. If this
    /// fails, either `normalize_url` or the vectors changed — update both sides.
    #[test]
    fn matches_shared_vectors() {
        let raw = include_str!("testdata/url_vectors.json");
        let vectors: Vec<Vector> = serde_json::from_str(raw).expect("valid vectors json");
        for v in vectors {
            assert_eq!(
                normalize_url(&v.input),
                v.expected,
                "normalize_url({:?})",
                v.input
            );
        }
    }

    #[test]
    fn idempotent() {
        let raw = include_str!("testdata/url_vectors.json");
        let vectors: Vec<Vector> = serde_json::from_str(raw).unwrap();
        for v in vectors {
            let once = normalize_url(&v.input);
            assert_eq!(normalize_url(&once), once, "not idempotent for {:?}", v.input);
        }
    }

    #[test]
    fn query_order_independent() {
        assert_eq!(
            normalize_url("https://x.com/a?b=2&a=1&c=3"),
            normalize_url("https://x.com/a?c=3&a=1&b=2"),
        );
    }
}
