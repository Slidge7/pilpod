import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { BrowsersUpdatePayload } from "../../../types/media";
import { BROWSERS_UPDATE_EVENT } from "../../media-dashboard/constants";
import {
  EMPTY_OVERVIEW,
  SETUP_COMMANDS,
  type BrowserSetupInfo,
  type SetupOverview,
} from "../types";
import { activationSignature } from "./useExtensionGate";

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

export type UseExtensionSetupOptions = {
  /**
   * Whether the setup UI is on screen right now — the browser-setup tab, or the
   * first-run gate. **Off means this hook makes no IPC calls at all.**
   */
  active: boolean;
  /**
   * Called after any command that can change activation or dismissal, so the
   * always-on gate state can be re-read without waiting for a browser event.
   */
  onChanged?: () => void;
};

/**
 * The stateful hook for the extension setup screen.
 *
 * Rust owns the truth. While the screen is open we hydrate via
 * `extension_setup_overview` and refresh when a browser's activation changes —
 * which is what makes the guide's final step complete on its own, with no
 * polling and no "did it work?" button.
 *
 * # Two rules, both load-bearing
 *
 * **1. It only runs while the screen is open.** `extension_setup_overview` is
 * the expensive command in this module: it joins the browser catalog, probes
 * every Chromium profile on disk for the companion, and returns a base64 PNG
 * per browser. Nothing outside the setup UI needs any of that — the dashboard
 * reads `activationState` straight off the `browsers://update` payload, and the
 * gate and menu badge run on {@link useExtensionGate}. So `active: false` means
 * no listener and no fetch, not a cheaper one.
 *
 * **2. It ignores media traffic.** `browsers://update` is the media feed; the
 * companion streams playback progress at 5 Hz. Subscribing to it naively meant
 * five overview calls a second for the whole time anything was playing. We
 * compare the activation signature and skip everything else.
 */
export function useExtensionSetup(
  options: UseExtensionSetupOptions,
): ExtensionSetupApi {
  const { active, onChanged } = options;

  const [overview, setOverview] = useState<SetupOverview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const signature = useRef<string | null>(null);

  // Held in a ref so that a caller passing an inline arrow function does not
  // tear down and rebuild the subscription on every render.
  const changed = useRef(onChanged);
  changed.current = onChanged;

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
    if (!active) {
      // Forget the signature so re-opening the screen always re-hydrates: the
      // world may have moved on while we were not listening.
      signature.current = null;
      return;
    }

    alive.current = true;
    let unlisten: UnlistenFn | undefined;

    setLoading(true);

    void listen<BrowsersUpdatePayload>(BROWSERS_UPDATE_EVENT, (ev) => {
      const next = activationSignature(ev.payload);
      if (next === signature.current) return;
      signature.current = next;
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
  }, [active, refresh]);

  /** Run a command, refresh, and surface a readable error. */
  const run = useCallback(
    async (cmd: string, args?: Record<string, unknown>): Promise<boolean> => {
      let ok = true;
      try {
        await invoke(cmd, args);
        if (alive.current) setError(null);
      } catch (e) {
        if (alive.current) setError(String(e));
        ok = false;
      }
      await refresh();
      changed.current?.();
      return ok;
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
