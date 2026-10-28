import { useMemo } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * Title-bar actions for this undecorated window. Failures are logged rather
 * than surfaced: a button that does nothing is the only symptom either way,
 * and the cause (a missing capability) is a developer error, not a user one.
 */
export function useWindowChrome() {
  return useMemo(() => {
    const win = getCurrentWebviewWindow();
    const run = (what: string, op: () => Promise<void>) => () => {
      op().catch((err: unknown) =>
        console.error(`[god-mode] ${what} failed:`, err),
      );
    };
    return {
      minimize: run("minimize", () => win.minimize()),
      toggleMaximize: run("toggle maximize", () => win.toggleMaximize()),
      close: run("close", () => win.close()),
    };
  }, []);
}
