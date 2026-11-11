import { useCallback, useEffect, useState } from "react";
import {
  GLASS_STRENGTH_STORAGE_KEY,
  applyGlassStrength,
  persistGlassStrength,
  readStoredGlassStrength,
} from "../../../theme/glassAppearance";
import { useStorageSync } from "../../../shared/useStorageSync";

const SYNCED_KEYS = [GLASS_STRENGTH_STORAGE_KEY];

export function useGlassAppearance() {
  const [glassStrength, setGlassStrength] = useState(readStoredGlassStrength);

  useEffect(() => {
    applyGlassStrength(glassStrength);
    persistGlassStrength(glassStrength);
  }, [glassStrength]);

  // Another window (PilPod Sky's settings) moved the slider.
  useStorageSync(SYNCED_KEYS, () => setGlassStrength(readStoredGlassStrength()));

  const setGlassStrengthClamped = useCallback((value: number) => {
    setGlassStrength(Math.min(100, Math.max(0, Math.round(value))));
  }, []);

  return { glassStrength, setGlassStrength: setGlassStrengthClamped };
}
