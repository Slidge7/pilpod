import { useCallback, useEffect, useState } from "react";
import {
  applyGlassStrength,
  persistGlassStrength,
  readStoredGlassStrength,
} from "../../../theme/glassAppearance";

export function useGlassAppearance() {
  const [glassStrength, setGlassStrength] = useState(readStoredGlassStrength);

  useEffect(() => {
    applyGlassStrength(glassStrength);
    persistGlassStrength(glassStrength);
  }, [glassStrength]);

  const setGlassStrengthClamped = useCallback((value: number) => {
    setGlassStrength(Math.min(100, Math.max(0, Math.round(value))));
  }, []);

  return { glassStrength, setGlassStrength: setGlassStrengthClamped };
}
