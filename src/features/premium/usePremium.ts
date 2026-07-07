import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PREMIUM_STATUS_EVENT, type PremiumStatus } from "./types";

interface UsePremium {
  /** null while the initial hydrate is in flight. */
  status: PremiumStatus | null;
  activating: boolean;
  activationError: string | null;
  activate: (key: string) => Promise<boolean>;
  deactivate: () => Promise<void>;
}

export function usePremium(): UsePremium {
  const [status, setStatus] = useState<PremiumStatus | null>(null);
  const [activating, setActivating] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Hydrate from Rust state (source of truth), then stay in sync via events.
    invoke<PremiumStatus>("premium_get_status")
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        /* command missing (stub build) — stay null */
      });
    const unlisten = listen<PremiumStatus>(PREMIUM_STATUS_EVENT, (e) => {
      if (!cancelled) setStatus(e.payload);
    });
    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
    };
  }, []);

  const activate = useCallback(async (key: string): Promise<boolean> => {
    setActivating(true);
    setActivationError(null);
    try {
      const s = await invoke<PremiumStatus>("premium_activate", { key });
      setStatus(s);
      return true;
    } catch (err) {
      setActivationError(humanizeActivationError(String(err)));
      return false;
    } finally {
      setActivating(false);
    }
  }, []);

  const deactivate = useCallback(async () => {
    try {
      const s = await invoke<PremiumStatus>("premium_deactivate");
      setStatus(s);
    } catch {
      /* keep current status */
    }
  }, []);

  return { status, activating, activationError, activate, deactivate };
}

function humanizeActivationError(raw: string): string {
  if (raw.includes("expired")) return "This license key has expired.";
  if (raw.includes("invalid_signature")) return "This license key is not valid.";
  if (raw.includes("invalid_format")) return "That doesn't look like a PilPod license key.";
  return "Could not activate the license. Please try again.";
}
