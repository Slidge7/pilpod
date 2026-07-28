import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { BROWSERS_UPDATE_EVENT } from "../../media-dashboard/constants";
import {
  EMPTY_OVERVIEW,
  SETUP_COMMANDS,
  type BrowserSetupInfo,
  type SetupOverview,
} from "../types";

export type ExtensionSetupApi = {
  overview: SetupOverview;
  loading: boolean;
  /** Last command error, cleared on the next successful action. */
  error: string | null;
  refresh: () => Promise<void>;
  browserById: (id: string) => BrowserSetupInfo | undefined;
  openListing: (browserId: string) => Promise<boolean>;
  openExtensionsPage: (browserId: string) => Promise<boolean>;
  skip: (browserId: string) => Promise<void>;
  cancel: (browserId: string) => Promise<void>;
  setDismissed: (dismissed: boolean) => Promise<void>;
  copyStoreUrl: () => Promise<boolean>;
};

/**
 * The single stateful hook for extension setup (pattern: `useVault`).
 *
 * Rust owns the truth. We hydrate once via `extension_setup_overview`, then
 * refresh on every `browsers://update` — which the bridge emits the instant a
 * handshake flips a browser to `active`. That is what makes the guide's final
 * step complete on its own, with no polling and no "did it work?" button.
 */
export function useExtensionSetup(): ExtensionSetupApi {
  const [overview, setOverview] = useState<SetupOverview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<SetupOverview>(SETUP_COMMANDS.overview);
      if (alive.current) setOverview(next);
    } catch (e) {
      // A failed refresh must not wipe the list the user is looking at.
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    let unlisten: UnlistenFn | undefined;

    // The browser feed is our activation signal: the bridge re-emits it on
    // every state change, so we never poll.
    void listen(BROWSERS_UPDATE_EVENT, () => {
      void refresh();
    }).then((u) => {
      if (alive.current) unlisten = u;
      else void u();
    });

    void refresh();

    return () => {
      alive.current = false;
      void unlisten?.();
    };
  }, [refresh]);

  /** Run a command, refresh, and surface a readable error. */
  const run = useCallback(
    async (cmd: string, args?: Record<string, unknown>): Promise<boolean> => {
      try {
        await invoke(cmd, args);
        if (alive.current) setError(null);
        await refresh();
        return true;
      } catch (e) {
        if (alive.current) setError(String(e));
        await refresh();
        return false;
      }
    },
    [refresh],
  );

  const browserById = useCallback(
    (id: string) => overview.browsers.find((b) => b.id === id),
    [overview.browsers],
  );

  const copyStoreUrl = useCallback(async () => {
    if (!overview.storeUrl) return false;
    try {
      await navigator.clipboard.writeText(overview.storeUrl);
      return true;
    } catch {
      return false;
    }
  }, [overview.storeUrl]);

  return {
    overview,
    loading,
    error,
    refresh,
    browserById,
    openListing: (browserId) => run(SETUP_COMMANDS.openListing, { browserId }),
    openExtensionsPage: (browserId) =>
      run(SETUP_COMMANDS.openExtensionsPage, { browserId }),
    skip: async (browserId) => {
      await run(SETUP_COMMANDS.skip, { browserId });
    },
    cancel: async (browserId) => {
      await run(SETUP_COMMANDS.cancel, { browserId });
    },
    setDismissed: async (dismissed) => {
      await run(SETUP_COMMANDS.setDismissed, { dismissed });
    },
    copyStoreUrl,
  };
}
