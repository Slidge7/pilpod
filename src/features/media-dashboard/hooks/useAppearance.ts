import { useCallback, useEffect, useState } from "react";
import {
  THEME_STORAGE_KEY,
  applyAppearance,
  persistAppearance,
  readStoredAppearance,
  type AppearanceMode,
} from "../../../theme/appearance";
import { useStorageSync } from "../../../shared/useStorageSync";

const SYNCED_KEYS = [THEME_STORAGE_KEY];

export function useAppearance() {
  const [appearance, setAppearance] = useState<AppearanceMode>(
    readStoredAppearance,
  );

  useEffect(() => {
    applyAppearance(appearance);
    persistAppearance(appearance);
  }, [appearance]);

  // Another window (PilPod Sky's settings) switched the theme.
  useStorageSync(SYNCED_KEYS, () => setAppearance(readStoredAppearance()));

  const toggle = useCallback(() => {
    setAppearance((m) => (m === "dark" ? "light" : "dark"));
  }, []);

  return { appearance, toggle, setAppearance };
}
