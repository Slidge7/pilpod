/**
 * Import/export the whole vault to a user-chosen JSON file (Phase 6). Uses the
 * existing `tauri-plugin-dialog` for the file pickers, then hands the chosen
 * path to the Rust `vault_export` / `vault_import` commands, which do the file
 * I/O. A local-only feature still deserves a backup story.
 */

import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export async function exportVault(): Promise<boolean> {
  const path = await save({
    defaultPath: "pilpod-vault.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return false;
  try {
    await invoke("vault_export", { path });
    return true;
  } catch {
    return false;
  }
}

export async function importVault(): Promise<boolean> {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!picked || Array.isArray(picked)) return false;
  try {
    await invoke("vault_import", { path: picked });
    return true;
  } catch {
    return false;
  }
}
