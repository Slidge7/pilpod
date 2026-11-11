import { useCallback, useMemo, useState } from "react";
import {
  IDLE_ENABLED_STORAGE_KEY,
  IDLE_INTERVAL_STORAGE_KEY,
  IDLE_INTERVALS,
  IDLE_DEFAULT_INTERVAL,
  type IdleIntervalId,
} from "./config";
import { useStorageSync } from "../../../shared/useStorageSync";

const SYNCED_KEYS = [IDLE_ENABLED_STORAGE_KEY, IDLE_INTERVAL_STORAGE_KEY];

function readEnabled(): boolean {
  const stored = readLS(IDLE_ENABLED_STORAGE_KEY);
  return stored === null ? true : stored === "1";
}

function readIntervalId(): IdleIntervalId {
  const raw = readLS(IDLE_INTERVAL_STORAGE_KEY);
  return raw && IDLE_INTERVALS.some((i) => i.id === raw)
    ? (raw as IdleIntervalId)
    : IDLE_DEFAULT_INTERVAL;
}

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

export type IdleController = {
  enabled: boolean;
  intervalId: IdleIntervalId;
  ms: number;
  toggleEnabled: () => void;
  setIntervalId: (id: IdleIntervalId) => void;
};

export function useIdleConfig(): IdleController {
  const [enabled, setEnabled] = useState<boolean>(readEnabled);
  const [intervalId, setIntervalIdState] = useState<IdleIntervalId>(readIntervalId);

  // Another window (PilPod Sky's settings) changed idle mode.
  useStorageSync(SYNCED_KEYS, () => {
    setEnabled(readEnabled());
    setIntervalIdState(readIntervalId());
  });

  const toggleEnabled = useCallback(() => {
    setEnabled((e) => {
      const next = !e;
      writeLS(IDLE_ENABLED_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const setIntervalId = useCallback((id: IdleIntervalId) => {
    setIntervalIdState(id);
    writeLS(IDLE_INTERVAL_STORAGE_KEY, id);
  }, []);

  const ms = IDLE_INTERVALS.find(i => i.id === intervalId)?.ms ?? 60_000;

  return useMemo(
    () => ({ enabled, intervalId, ms, toggleEnabled, setIntervalId }),
    [enabled, intervalId, ms, toggleEnabled, setIntervalId]
  );
}
