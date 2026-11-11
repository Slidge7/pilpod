import { useCallback, useState } from "react";
import { ALWAYS_ON_TOP_STORAGE_KEY } from "../../../../media-dashboard";
import { useStorageSync } from "../../../../../shared/useStorageSync";

const KEYS = [ALWAYS_ON_TOP_STORAGE_KEY];

function read(): boolean {
  try {
    return localStorage.getItem(ALWAYS_ON_TOP_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The dashboard's "keep on top" preference, edited from Sky. The dashboard
 * owns its window and re-reads this key when it changes (see
 * `useMediaDashboard`), so writing it here pins or unpins that window.
 */
export function useAlwaysOnTopSetting() {
  const [on, setOn] = useState(read);
  useStorageSync(KEYS, () => setOn(read()));

  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(ALWAYS_ON_TOP_STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }, []);

  return { alwaysOnTop: on, setAlwaysOnTop: set };
}
