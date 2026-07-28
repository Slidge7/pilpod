//! The injected agent: static assets + the one-shot assembly that turns them
//! into the window's `initialization_script`.
//!
//! Everything here is data. The agent's behaviour lives in `agent/agent.js`;
//! per-site quirks live in `agent/adapters.js`. Adding a site is a table edit
//! in the JS, never a Rust change.

/// Mobile UA. Not cosmetic: mobile pages ship a fraction of the DOM and JS of
/// their desktop counterparts, which is the biggest RAM lever available to an
/// embedded webview.
pub const MOBILE_UA: &str = "Mozilla/5.0 (Linux; Android 13; Pixel 7) \
AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

/// WebView2 browser arguments — **must be identical for every window in the
/// process**.
///
/// WebView2 creates one environment per process from the first webview's
/// options; any later webview asking for *different* arguments fails
/// environment creation, and the window flashes up and dies. wry always sends
/// arguments (its default is the `--disable-features=…` group below), so
/// "leave them unset" is not the same as "match" — an unset window and a
/// configured one still disagree.
///
/// Consequently this string is mirrored in three places, and
/// `browser_args_match_the_window_config` fails the build if they drift:
///   * `tauri.conf.json` → main window `additionalBrowserArgs`
///   * this module → the player window
///   * `dev_lab` → the dev-lab window
///
/// `--autoplay-policy` is the load-bearing addition: without it every track
/// after the first stalls waiting for a user gesture a playlist never produces.
/// `--disable-background-timer-throttling` keeps the agent reporting while the
/// player sits behind other windows.
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling";

const AGENT_JS: &str = include_str!("agent/agent.js");
const ADAPTERS_JS: &str = include_str!("agent/adapters.js");
const CINEMA_CSS: &str = include_str!("agent/cinema.css");

/// Assemble the init script: config → adapter table → agent.
pub fn script() -> String {
    let css = serde_json::to_string(CINEMA_CSS).unwrap_or_else(|_| "\"\"".into());
    let ep = serde_json::to_string(super::bridge::IPC_ENDPOINT).unwrap_or_else(|_| "\"\"".into());
    format!("window.__PILPOD_CFG={{ep:{ep},css:{css}}};\n{ADAPTERS_JS}\n{AGENT_JS}\n")
}

/// Rust → page command frame.
pub fn command_js(action: &str, value: Option<f64>) -> String {
    let value = match value {
        Some(v) if v.is_finite() => v.to_string(),
        _ => "null".into(),
    };
    let action = serde_json::to_string(action).unwrap_or_else(|_| "\"\"".into());
    format!("window.__pilpod&&window.__pilpod.cmd({{action:{action},value:{value}}});")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The one thing that silently breaks the whole feature: a window whose
    /// browser arguments differ from the rest of the process.
    #[test]
    fn browser_args_match_the_window_config() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).expect("config parses");
        let main = config["app"]["windows"]
            .as_array()
            .expect("windows array")
            .iter()
            .find(|w| w["label"] == "main")
            .expect("main window");
        assert_eq!(
            main["additionalBrowserArgs"].as_str(),
            Some(BROWSER_ARGS),
            "main window args must equal BROWSER_ARGS or WebView2 refuses the \
             second environment and the player window dies on open",
        );
    }

    #[test]
    fn script_embeds_config_before_the_agent() {
        let s = script();
        let cfg = s.find("__PILPOD_CFG").expect("config present");
        let adapters = s.find("__PILPOD_ADAPTERS").expect("adapters present");
        let agent = s.find("window.__pilpod =").expect("agent present");
        assert!(cfg < adapters && adapters < agent, "load order matters");
        assert!(s.contains("pilpod-ipc.invalid"));
    }

    #[test]
    fn command_js_is_injection_safe() {
        let js = command_js("seek", Some(42.5));
        assert!(js.contains("\"seek\""));
        assert!(js.contains("42.5"));
        // Quotes in an action name are escaped, never interpolated raw.
        let nasty = command_js("a\");evil(\"", None);
        assert!(nasty.starts_with("window.__pilpod&&window.__pilpod.cmd({action:\""));
        assert!(nasty.contains("\\\""), "quotes must be escaped: {nasty}");
        assert!(nasty.ends_with("value:null});"));
    }

    #[test]
    fn non_finite_values_never_reach_the_page() {
        assert!(command_js("seek", Some(f64::NAN)).contains("value:null"));
        assert!(command_js("seek", Some(f64::INFINITY)).contains("value:null"));
    }
}
