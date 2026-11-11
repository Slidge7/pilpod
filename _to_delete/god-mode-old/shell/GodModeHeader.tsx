import { useState } from "react";
import {
  IconClose,
  IconGodMode,
  IconMaximize,
  IconMinimize,
  IconRefresh,
} from "../../../shared/ui/icons";
import { errorText, syncBrowsers } from "../data/commands";
import { useLiveBrowsers } from "../data/GodModeData";
import { UniversalSearch } from "../search/components/UniversalSearch";
import { useWindowChrome } from "./useWindowChrome";

/**
 * Title bar: brand, the universal search, sync, and the window buttons (the
 * window is undecorated). Empty space drags the window; double-click
 * maximizes.
 */
export function GodModeHeader() {
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
    <header className="gm-header" data-tauri-drag-region>
      <div className="gm-brand" data-tauri-drag-region>
        <span className="gm-brand__mark" aria-hidden="true">
          <IconGodMode />
        </span>
        <h1 className="gm-brand__title" data-tauri-drag-region>
          God Mode
        </h1>
        <span
          className={`gm-live${stats.connected === 0 ? " gm-live--idle" : ""}`}
          title={
            stats.connected === 0
              ? "No browser is connected"
              : "Updates live from every connected browser"
          }
        >
          <span className="gm-live__dot" aria-hidden="true" />
          {stats.connected === 0 ? "Waiting" : "Live"}
        </span>
      </div>

      <UniversalSearch />

      <div className="gm-header__actions">
        <button
          type="button"
          className={`gm-btn gm-btn--quiet${syncing ? " is-busy" : ""}`}
          onClick={sync}
          title="Ask every connected browser to resend its tabs"
        >
          <IconRefresh />
          Sync
        </button>
        <span className="gm-header__sep" aria-hidden="true" />
        <button
          type="button"
          className="gm-window-btn"
          onClick={chrome.minimize}
          title="Minimize"
          aria-label="Minimize"
        >
          <IconMinimize />
        </button>
        <button
          type="button"
          className="gm-window-btn"
          onClick={chrome.toggleMaximize}
          title="Maximize"
          aria-label="Maximize"
        >
          <IconMaximize />
        </button>
        <button
          type="button"
          className="gm-window-btn gm-window-btn--close"
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
