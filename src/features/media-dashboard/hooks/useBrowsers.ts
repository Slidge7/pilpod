import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DetectedBrowser } from "../../../types/media";
import { BROWSERS_UPDATE_EVENT } from "../constants";

/**
 * Subscribes to `"browsers://update"` and returns the current browser list.
 *
 * - Browsers are detected at the OS level (registry + process scan) and are
 *   always present even when no extension is installed.
 * - `browser.extensionInstalled` is true when the companion extension recently
 *   sent a POST.
 * - `browser.tabs` is populated only when the extension is installed and active.
 */
export function useBrowsers() {
  const [browsers, setBrowsers] = useState<DetectedBrowser[]>([]);

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<DetectedBrowser[]>("get_browsers");
      setBrowsers(list);
    } catch {
      // Non-Windows dev environment — start with empty list.
      setBrowsers([]);
    }
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    void listen<DetectedBrowser[]>(BROWSERS_UPDATE_EVENT, (ev) => {
      setBrowsers(ev.payload);
    }).then((u) => {
      unlisten = u;
    });

    void refresh();

    return () => {
      void unlisten?.();
    };
  }, [refresh]);

  return { browsers, refresh };
}
