import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DetectedBrowser } from "../../../types/media";
import { BROWSERS_UPDATE_EVENT } from "../constants";
import { browsersEqual } from "../lib/browsersEqual";

/**
 * Subscribes to `"browsers://update"` and returns the current browser list.
 *
 * - Browsers are detected at the OS level (registry + process scan) and are
 *   always present even when no extension is installed.
 * - `browser.extensionInstalled` persists across app sessions.
 * - `browser.extensionConnected` is true only when the extension sent a POST
 *   in the last 3 seconds.
 * - `browser.tabs` is cached from the last POST and shown even when offline.
 *
 * On window focus, calls `request_browser_sync` so Rust re-emits from cache
 * immediately and signals the extension to push a fresh snapshot.
 */
export function useBrowsers() {
  const [browsers, setBrowsers] = useState<DetectedBrowser[]>([]);

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<DetectedBrowser[]>("get_browsers");
      setBrowsers((prev) => (browsersEqual(prev, list) ? prev : list));
    } catch {
      // Non-Windows dev environment — start with empty list.
      setBrowsers((prev) => (prev.length === 0 ? prev : []));
    }
  }, []);

  // Debounce focus events so rapid alt-tab doesn't flood the backend.
  const focusDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    void listen<DetectedBrowser[]>(BROWSERS_UPDATE_EVENT, (ev) => {
      setBrowsers((prev) =>
        browsersEqual(prev, ev.payload) ? prev : ev.payload,
      );
    }).then((u) => {
      unlisten = u;
    });

    void refresh();

    const onFocus = () => {
      if (focusDebounceRef.current !== null) return;
      focusDebounceRef.current = setTimeout(() => {
        focusDebounceRef.current = null;
        void invoke("request_browser_sync").catch(() => {
          // Non-Windows or command not yet registered — ignore.
        });
      }, 200);
    };

    window.addEventListener("focus", onFocus);

    return () => {
      void unlisten?.();
      window.removeEventListener("focus", onFocus);
      if (focusDebounceRef.current !== null) {
        clearTimeout(focusDebounceRef.current);
      }
    };
  }, [refresh]);

  return { browsers, refresh };
}
