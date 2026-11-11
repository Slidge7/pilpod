import { useCallback, useEffect, useState } from "react";
import { historyApi } from "../api";
import { HISTORY_ERRORS, type HistorySettings } from "../types";

export interface HistorySettingsApi {
  /** `null` until loaded (or when history is unavailable). */
  settings: HistorySettings | null;
  /** The history database could not be opened this session. */
  unavailable: boolean;
  update: (patch: Partial<HistorySettings>) => Promise<void>;
  /** Remove every page and media row. */
  clearAll: () => Promise<void>;
}

export function useHistorySettings(): HistorySettingsApi {
  const [settings, setSettings] = useState<HistorySettings | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let alive = true;
    historyApi
      .getSettings()
      .then((s) => {
        if (alive) setSettings(s);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err === HISTORY_ERRORS.unavailable) setUnavailable(true);
        else console.error("[history] settings:", err);
      });
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback(
    async (patch: Partial<HistorySettings>) => {
      if (!settings) return;
      try {
        setSettings(await historyApi.setSettings({ ...settings, ...patch }));
      } catch (err) {
        console.error("[history] update settings:", err);
      }
    },
    [settings],
  );

  const clearAll = useCallback(async () => {
    try {
      await historyApi.clear({});
    } catch (err) {
      console.error("[history] clear:", err);
    }
  }, []);

  return { settings, unavailable, update, clearAll };
}
