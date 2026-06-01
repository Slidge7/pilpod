import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AudioSessionInfoDto,
  BrowsersUpdatePayload,
  DetectedBrowser,
} from "../../../types/media";
import { BROWSERS_UPDATE_EVENT } from "../constants";
import { browsersEqual } from "../lib/browsersEqual";

function browserAudioEqual(
  a: Record<string, AudioSessionInfoDto>,
  b: Record<string, AudioSessionInfoDto>,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function applyPayload(
  payload: BrowsersUpdatePayload,
  setBrowsers: React.Dispatch<React.SetStateAction<DetectedBrowser[]>>,
  setBrowserAudio: React.Dispatch<
    React.SetStateAction<Record<string, AudioSessionInfoDto>>
  >,
) {
  setBrowsers((prev) =>
    browsersEqual(prev, payload.browsers) ? prev : payload.browsers,
  );
  const audio = payload.browserAudio ?? {};
  setBrowserAudio((prev) => (browserAudioEqual(prev, audio) ? prev : audio));
}

/**
 * Subscribes to `"browsers://update"` and returns browsers plus WASAPI profile audio.
 */
export function useBrowsers() {
  const [browsers, setBrowsers] = useState<DetectedBrowser[]>([]);
  const [browserAudio, setBrowserAudio] = useState<
    Record<string, AudioSessionInfoDto>
  >({});

  const refresh = useCallback(async () => {
    try {
      const payload = await invoke<BrowsersUpdatePayload>("get_browsers");
      applyPayload(payload, setBrowsers, setBrowserAudio);
    } catch {
      setBrowsers((prev) => (prev.length === 0 ? prev : []));
      setBrowserAudio((prev) =>
        Object.keys(prev).length === 0 ? prev : {},
      );
    }
  }, []);

  const focusDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    void listen<BrowsersUpdatePayload>(BROWSERS_UPDATE_EVENT, (ev) => {
      applyPayload(ev.payload, setBrowsers, setBrowserAudio);
    }).then((u) => {
      unlisten = u;
    });

    void refresh();

    const onFocus = () => {
      if (focusDebounceRef.current !== null) return;
      focusDebounceRef.current = setTimeout(() => {
        focusDebounceRef.current = null;
        void invoke("request_browser_sync").catch(() => {});
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

  return { browsers, browserAudio, refresh };
}
