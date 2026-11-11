import { useState } from "react";
import {
  IconClose,
  IconSky,
  IconMaximize,
  IconMinimize,
  IconRefresh,
} from "../../../shared/ui/icons";
import { errorText, syncBrowsers } from "../data/commands";
import { useLiveBrowsers } from "../data/SkyData";
import { UniversalSearch } from "../search/components/UniversalSearch";
import { useWindowChrome } from "./useWindowChrome";

/**
 * Title bar: brand, the universal search, sync, and the window buttons (the
 * window is undecorated). Empty space drags the window; double-click
 * maximizes.
 */
export function SkyHeader() {
  const chrome = useWindowChrome();
  const { stats, controls } = useLiveBrowsers();
  const [syncing, setSyncing] = useState(false);

  const sync = () => {
    setSyncing(true);
    syncBrowsers()
      .catch((err: unknown) => controls.setError(errorText(err)))
      // The browsers answer on their own schedule; the spin only says "asked".
      .finally(() => window.setTimeout(() => setSyncing(false), 900));
  };

  return (
    <header className="sky-header" data-tauri-drag-region>
      <div className="sky-brand" data-tauri-drag-region>
        <span className="sky-brand__mark" aria-hidden="true">
          <IconSky />
        </span>
        <h1 className="sky-brand__title" data-tauri-drag-region>
          PilPod Sky
        </h1>
        <span
          className={`sky-live${stats.connected === 0 ? " sky-live--idle" : ""}`}
          title={
            stats.connected === 0
              ? "No browser is connected"
              : "Updates live from every connected browser"
          }
        >
          <span className="sky-live__dot" aria-hidden="true" />
          {stats.connected === 0 ? "Waiting" : "Live"}
        </span>
      </div>

      <UniversalSearch />

      <div className="sky-header__actions">
        <button
          type="button"
          className={`sky-btn sky-btn--quiet${syncing ? " is-busy" : ""}`}
          onClick={sync}
          title="Ask every connected browser to resend its tabs"
        >
          <IconRefresh />
          Sync
        </button>
        <span className="sky-header__sep" aria-hidden="true" />
        <button
          type="button"
          className="sky-window-btn"
          onClick={chrome.minimize}
          title="Minimize"
          aria-label="Minimize"
        >
          <IconMinimize />
        </button>
        <button
          type="button"
          className="sky-window-btn"
          onClick={chrome.toggleMaximize}
          title="Maximize"
          aria-label="Maximize"
        >
          <IconMaximize />
        </button>
        <button
          type="button"
          className="sky-window-btn sky-window-btn--close"
          onClick={chrome.close}
          title="Close"
          aria-label="Close"
        >
          <IconClose />
        </button>
      </div>
    </header>
  );
}
