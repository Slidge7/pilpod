import { useMemo } from "react";
import type { CaptureBrowser } from "../../vault";
import { useLiveBrowsers } from "../data/SkyData";

/**
 * Provenance for anything saved from a tab — which OS browser and profile it
 * came from — read from the live browser list. Used only inside open menus,
 * so following the browser stream here costs nothing while they are closed.
 */
export function useCaptureBrowser(browserId: string): CaptureBrowser | undefined {
  const { browsers } = useLiveBrowsers();
  const b = browsers.find((x) => x.id === browserId);
  const osBrowserId = b?.osBrowserId;
  const displayName = b?.displayName;
  const profileLabel = b?.profileLabel ?? null;
  return useMemo(
    () => (osBrowserId ? { osBrowserId, displayName, profileLabel } : undefined),
    [osBrowserId, displayName, profileLabel],
  );
}

/** The tab as it is right now — popovers show live values (volume, position). */
export function useLiveTab(browserId: string, tabId: number) {
  const { browsers } = useLiveBrowsers();
  return browsers.find((b) => b.id === browserId)?.tabs.find((t) => t.tabId === tabId) ?? null;
}
