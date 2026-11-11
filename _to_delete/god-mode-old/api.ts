import { invoke } from "@tauri-apps/api/core";
import { OPEN_GOD_MODE_COMMAND } from "./constants";

/** Open the God Mode window, or bring it forward if it is already open. */
export function openGodModeWindow(): Promise<void> {
  return invoke<void>(OPEN_GOD_MODE_COMMAND);
}
