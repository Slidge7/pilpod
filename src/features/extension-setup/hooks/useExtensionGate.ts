import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { BrowsersUpdatePayload } from "../../../types/media";
import { BROWSERS_UPDATE_EVENT } from "../../media-dashboard/constants";
import {
  EMPTY_GATE_STATE,
  SETUP_COMMANDS,
  type SetupGateState,
} from "../types";

/**
 * The only part of the browser feed this module cares about: which browsers
 * exist, and whether each one is activated.
 *
 * Sorted and de-duplicated on `osBrowserId` so that neither the order the
 * detector happens to emit in, nor a second profile appearing for a browser
 * that is already activated, counts as a change.
 */
export function activationSignature(payload: BrowsersUpdatePayload): string {
  const seen = new Set<string>();
  for (const b of payload.browsers) {
    seen.add(`${b.osBrowserId}:${b.activationState}`);
  }
  return Array.from(seen).sort().join("|");
}

export type ExtensionGateApi = {
  state: SetupGateState;
  loading: boolean;
  /** Re-read after a command that could have changed activation or dismissal. */
  refresh: () => Promise<void>;
};

/**
 * Always-on setup state, kept deliberately cheap.
 *
 * # Why this hook exists
 *
 * `useExtensionSetup` used to be mounted for the whole session and refreshed on
 * every `browsers://update`. That event is the *media* feed: the companion
 * streams playback progress at 5 Hz, so "the browser list changed" fired five
 * times a second for as long as anything was playing. Each one re-ran
 * `extension_setup_overview` — a full process enumeration, a profile scan on
 * disk, and seven base64 PNGs on the wire — for a screen nobody had open.
 *
 * Two rules keep that from coming back:
 *
 * 1. **Cheap command.** `extension_setup_gate_state` reads the activation store
 *    and the detector's cached id list. No scans, no icons.
 * 2. **Filtered trigger.** We re-read only when the *activation signature*
 *    changes. A song advancing is not an activation change, so it costs one
 *    string compare and nothing else.
 *
 * The expensive overview stays behind `useExtensionSetup({ active })`, which is
 * only on when the setup UI is actually on screen.
 */
export function useExtensionGate(): ExtensionGateApi {
  const [state, setState] = useState<SetupGateState>(EMPTY_GATE_STATE);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const signature = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<SetupGateState>(SETUP_COMMANDS.gateState);
      if (alive.current) setState(next);
    } catch {
      // Leave the last good state in place. A failed read must never flash the
      // onboarding gate back up at someone who already dismissed it.
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    let unlisten: UnlistenFn | undefined;

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
  }, [refresh]);

  return { state, loading, refresh };
}
