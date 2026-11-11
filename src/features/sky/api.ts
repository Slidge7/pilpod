import { invoke } from "@tauri-apps/api/core";
import { OPEN_SKY_COMMAND } from "./constants";

/** Open the Sky window, or bring it forward if it is already open. */
export function openSkyWindow(): Promise<void> {
  return invoke<void>(OPEN_SKY_COMMAND);
}
