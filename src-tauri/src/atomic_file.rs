//! Durable whole-file writes for the app's small JSON stores.
//!
//! Every store in PilPod follows the same discipline — serialize to
//! `<file>.tmp`, then rename over the original — so a crash mid-write can never
//! leave a truncated file behind. That is only half the guarantee.
//!
//! `rename` is atomic with respect to the *directory entry*: once it returns,
//! the name points either at the old file or at the new one, never at a mixture
//! of both. It says nothing about whether the new file's bytes ever reached the
//! disk. Both the write and the rename can still be sitting in the OS cache, so
//! a power loss at the wrong moment can leave the real name pointing at a
//! zero-length or half-written file — precisely the outcome tmp+rename was
//! adopted to prevent.
//!
//! `sync_all` on the temp file, *before* the rename, is what closes that gap.
//! It costs almost nothing at these file sizes, and these stores hold data the
//! user cannot reconstruct: bookmarks, playlists, a license token.

use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

/// `<file>` → `<file>.tmp`, beside the original so the rename never has to
/// cross a filesystem boundary.
///
/// Stores that assert on the temp path in their own tests keep a private copy
/// of this; new callers should use it from here.
pub fn tmp_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_else(|| "store.json".into());
    name.push(".tmp");
    path.with_file_name(name)
}

/// Write `contents` to `tmp`, flush it to the disk itself, then rename it over
/// `path`. No orphan temp file is left behind on any failure path.
///
/// The caller owns creating the parent directory and serializing the data —
/// this is only the durable-bytes-to-path step.
pub fn write_durable(path: &Path, tmp: &Path, contents: &str) -> Result<(), String> {
    let write = || -> std::io::Result<()> {
        let mut f = File::create(tmp)?;
        f.write_all(contents.as_bytes())?;
        // Flushes this file's data *and* its metadata. A plain `flush()` would
        // only empty the userspace buffer, which is not the problem here.
        f.sync_all()
    };
    if let Err(e) = write() {
        let _ = std::fs::remove_file(tmp);
        return Err(format!("write {}: {e}", tmp.display()));
    }
    std::fs::rename(tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(tmp);
        format!("rename {} -> {}: {e}", tmp.display(), path.display())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("pilpod-atomic-{name}-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn writes_contents_and_leaves_no_tmp() {
        let dir = scratch("write");
        let path = dir.join("store.json");
        let tmp = tmp_path(&path);
        write_durable(&path, &tmp, "{\"a\":1}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":1}");
        assert!(!tmp.exists(), "temp file survived a successful write");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The replacement must be whole, not an overlay: a shorter body must not
    /// leave the tail of the longer previous one behind.
    #[test]
    fn overwrites_an_existing_file_whole() {
        let dir = scratch("overwrite");
        let path = dir.join("store.json");
        std::fs::write(&path, "a considerably longer previous body").unwrap();
        write_durable(&path, &tmp_path(&path), "{}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tmp_sits_beside_the_original() {
        let dir = scratch("beside");
        let path = dir.join("vault_store.json");
        assert_eq!(tmp_path(&path), dir.join("vault_store.json.tmp"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
