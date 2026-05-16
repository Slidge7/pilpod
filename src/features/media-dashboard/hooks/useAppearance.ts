import { useCallback, useEffect, useState } from "react";
import {
  applyAppearance,
  persistAppearance,
  readStoredAppearance,
  type AppearanceMode,
} from "../../../theme/appearance";

export function useAppearance() {
  const [appearance, setAppearance] = useState<AppearanceMode>(
    readStoredAppearance,
  );

  useEffect(() => {
    applyAppearance(appearance);
    persistAppearance(appearance);
  }, [appearance]);

  const toggle = useCallback(() => {
    setAppearance((m) => (m === "dark" ? "light" : "dark"));
  }, []);

  return { appearance, toggle };
}
