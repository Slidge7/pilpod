//! The seam between setup logic and the operating system.
//!
//! Two operations, one trait: find a browser's executable, and open a URL *in
//! that specific browser*. Everything else in this module is pure, so putting
//! both behind [`BrowserOps`] makes the command layer fully unit-testable with
//! [`MockOps`] — no browsers launched during `cargo test`.
//!
//! # Why not `ShellExecute` / the `opener` plugin
//!
//! Shell-opening a URL hands it to the user's **default** browser. This flow is
//! specifically about installing into a browser the user picked, which is very
//! often *not* the default one — that is the whole point of the browser list.
//! So we always resolve the concrete executable and pass the URL as an argument.

use std::path::{Path, PathBuf};

/// Things the setup flow needs from the OS.
pub trait BrowserOps: Send + Sync {
    /// Absolute path to the browser's executable, or `None` if not installed.
    fn resolve_exe(&self, os_browser_id: &str) -> Option<PathBuf>;

    /// Launch `exe` pointed at `url`. Returns once the process is spawned — we
    /// deliberately do not wait, the browser owns its own lifetime.
    fn open_url(&self, exe: &Path, url: &str) -> Result<(), String>;
}

/// Real implementation, backed by the browser catalog's registry/process scan.
pub struct SystemOps;

impl BrowserOps for SystemOps {
    #[cfg(windows)]
    fn resolve_exe(&self, os_browser_id: &str) -> Option<PathBuf> {
        crate::browser_catalog::resolve_exe_path(os_browser_id).map(PathBuf::from)
    }

    #[cfg(not(windows))]
    fn resolve_exe(&self, _os_browser_id: &str) -> Option<PathBuf> {
        None
    }

    fn open_url(&self, exe: &Path, url: &str) -> Result<(), String> {
        std::process::Command::new(exe)
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("could not launch {}: {e}", exe.display()))
    }
}

/// Test double. Records every call and can be told to fail.
#[cfg(test)]
pub struct MockOps {
    /// `os_browser_id → exe path`. Absent ⇒ "not installed".
    pub installed: std::collections::HashMap<String, PathBuf>,
    /// Every `open_url` call, in order: `(exe, url)`.
    pub opened: std::sync::Mutex<Vec<(PathBuf, String)>>,
    /// When true, `open_url` reports a spawn failure.
    pub fail_open: bool,
}

#[cfg(test)]
impl MockOps {
    /// Mock where each given id resolves to `C:\fake\<id>.exe`.
    pub fn with_installed(ids: &[&str]) -> Self {
        Self {
            installed: ids
                .iter()
                .map(|id| (id.to_string(), PathBuf::from(format!("C:\\fake\\{id}.exe"))))
                .collect(),
            opened: std::sync::Mutex::new(Vec::new()),
            fail_open: false,
        }
    }

    pub fn failing(ids: &[&str]) -> Self {
        Self {
            fail_open: true,
            ..Self::with_installed(ids)
        }
    }

    /// All recorded `(exe, url)` calls.
    pub fn calls(&self) -> Vec<(PathBuf, String)> {
        self.opened.lock().unwrap().clone()
    }

    /// The single call recorded so far. Panics unless there is exactly one —
    /// "we opened one thing" is the assertion nearly every test wants.
    pub fn only_call(&self) -> (PathBuf, String) {
        let calls = self.calls();
        assert_eq!(calls.len(), 1, "expected exactly one launch, got {calls:?}");
        calls.into_iter().next().unwrap()
    }
}

#[cfg(test)]
impl BrowserOps for MockOps {
    fn resolve_exe(&self, os_browser_id: &str) -> Option<PathBuf> {
        self.installed.get(os_browser_id).cloned()
    }

    fn open_url(&self, exe: &Path, url: &str) -> Result<(), String> {
        if self.fail_open {
            return Err(format!("mock failure launching {}", exe.display()));
        }
        self.opened
            .lock()
            .unwrap()
            .push((exe.to_path_buf(), url.to_string()));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_resolves_only_installed_browsers() {
        let ops = MockOps::with_installed(&["chrome", "msedge"]);
        assert_eq!(
            ops.resolve_exe("chrome"),
            Some(PathBuf::from("C:\\fake\\chrome.exe"))
        );
        assert!(ops.resolve_exe("brave").is_none());
    }

    #[test]
    fn mock_records_calls_in_order() {
        let ops = MockOps::with_installed(&["chrome"]);
        let exe = ops.resolve_exe("chrome").unwrap();
        ops.open_url(&exe, "https://example.com/a").unwrap();
        ops.open_url(&exe, "https://example.com/b").unwrap();

        let calls = ops.calls();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].1, "https://example.com/a");
        assert_eq!(calls[1].1, "https://example.com/b");
    }

    #[test]
    fn mock_can_simulate_a_spawn_failure() {
        let ops = MockOps::failing(&["chrome"]);
        let exe = ops.resolve_exe("chrome").unwrap();
        assert!(ops.open_url(&exe, "https://example.com").is_err());
        assert!(ops.calls().is_empty(), "a failed launch records nothing");
    }

    #[test]
    fn system_ops_reports_unknown_browsers_as_not_installed() {
        assert!(SystemOps.resolve_exe("definitely-not-a-browser").is_none());
    }
}
