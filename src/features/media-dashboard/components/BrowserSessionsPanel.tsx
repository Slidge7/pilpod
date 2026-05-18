import { useCallback, useState } from "react";
import "./BrowserSessionsPanel.css";
import type { AudioSessionInfoDto, BrowserTab, DetectedBrowser } from "../../../types/media";
import { tabRowKey, tabHasMedia } from "../lib/browserMedia";
import { AppVolumeSlider } from "./AppVolumeSlider";
import { UnifiedTabRow } from "./UnifiedTabRow";

/** Format an age in seconds as a compact human-readable string. */
function formatAge(secs: number): string {
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

type Props = {
  browsers: DetectedBrowser[];
  pendingKeys: ReadonlySet<string>;
  browserAudio: Readonly<Record<string, AudioSessionInfoDto>>;
  onPlayPause: (tab: BrowserTab, browserId: string) => void;
  onFocusTab: (tab: BrowserTab, browserId: string, displayName: string) => void | Promise<void>;
  onReload: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onClose: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onReactivate: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onMixerVolume: (instanceId: string, volume: number) => void;
  onRefreshBrowser: (browserId: string) => void | Promise<void>;
};

function BrowserHeader({
  browser,
  profileAudio,
  onMixerVolume,
  onRefresh,
}: {
  browser: DetectedBrowser;
  profileAudio: AudioSessionInfoDto | undefined;
  onMixerVolume: (instanceId: string, volume: number) => void;
  onRefresh: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      // Keep the spinner for a moment so the user sees feedback,
      // then let the incoming event-driven update flip it off.
      setTimeout(() => setRefreshing(false), 800);
    }
  }, [onRefresh, refreshing]);

  const showOffline =
    browser.extensionInstalled && !browser.extensionConnected;

  const cacheHint =
    showOffline && browser.lastSyncSecs != null
      ? `cached ${formatAge(browser.lastSyncSecs)}`
      : null;

  return (
    <header className="pilpod-browser-profile__head">
      <span className="pilpod-browser-profile__label">
        {browser.displayName}
        {!browser.running ? (
          <span className="pilpod-browser-profile__label-offline">
            {" "}· not running
          </span>
        ) : null}
        {!browser.extensionInstalled ? (
          <span
            className="pilpod-browser-profile__badge pilpod-browser-profile__badge--warn"
            title="Companion extension not detected in this browser"
          >
            no ext
          </span>
        ) : showOffline ? (
          <span
            className="pilpod-browser-profile__badge pilpod-browser-profile__badge--offline"
            title={
              cacheHint
                ? `Extension not responding (${cacheHint}) — click Refresh`
                : "Extension not responding — click Refresh"
            }
          >
            {cacheHint ? `offline · ${cacheHint}` : "offline"}
          </span>
        ) : null}
      </span>
      <span className="pilpod-browser-profile__tab-count">
        {browser.tabCount > 0 ? `${browser.tabCount} tabs` : null}
      </span>
      {profileAudio ? (
        <AppVolumeSlider
          ariaLabel={`Volume for ${browser.displayName}`}
          audio={profileAudio}
          onVolumeChange={onMixerVolume}
        />
      ) : null}
      <button
        className={`pilpod-browser-profile__refresh${refreshing ? " pilpod-browser-profile__refresh--spinning" : ""}`}
        title={`Refresh connection to ${browser.displayName}`}
        aria-label={`Refresh ${browser.displayName} connection`}
        onClick={handleRefresh}
        disabled={refreshing}
      >
        ↺
      </button>
    </header>
  );
}

function BrowserBody({
  browser,
  pendingKeys,
  onPlayPause,
  onFocusTab,
  onReload,
  onClose,
  onReactivate,
}: {
  browser: DetectedBrowser;
  pendingKeys: ReadonlySet<string>;
  onPlayPause: (tab: BrowserTab, browserId: string) => void;
  onFocusTab: (tab: BrowserTab, browserId: string, displayName: string) => void | Promise<void>;
  onReload: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onClose: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onReactivate: (tab: BrowserTab, browserId: string) => void | Promise<void>;
}) {
  const slotBrowserId = browser.tabs[0]?.browserId ?? browser.id;
  const mediaTabs = browser.tabs.filter(tabHasMedia);
  const otherTabs = browser.tabs.filter((t) => !tabHasMedia(t));

  // Browser not running — nothing actionable to show.
  if (!browser.running) {
    return (
      <p className="pilpod-browser-panel__empty pilpod-browser-panel__empty--inline">
        {browser.extensionInstalled
          ? "Browser is closed. Open it to see tabs."
          : "Open this browser and install the companion extension to see tabs."}
      </p>
    );
  }

  // Running but extension never installed.
  if (!browser.extensionInstalled) {
    return (
      <p className="pilpod-browser-panel__empty pilpod-browser-panel__empty--inline">
        Install the PilPod companion extension to see tabs.
      </p>
    );
  }

  // Extension installed but not currently connected.
  // Still show cached tabs if available — don't go blank just because
  // the heartbeat stopped.
  if (!browser.extensionConnected && browser.tabs.length === 0) {
    return (
      <p className="pilpod-browser-panel__empty pilpod-browser-panel__empty--inline">
        {browser.lastSyncSecs != null
          ? "No cached tabs available. Click Refresh to reconnect."
          : "Extension not responding. Click Refresh to reconnect."}
      </p>
    );
  }

  // Connected with no tabs yet (or reconnecting and cache is empty).
  if (browser.extensionConnected && browser.tabs.length === 0) {
    return (
      <p className="pilpod-browser-panel__empty pilpod-browser-panel__empty--inline">
        Waiting for tab data…
      </p>
    );
  }

  const isStale = !browser.extensionConnected && browser.tabs.length > 0;

  return (
    <div className={isStale ? "pilpod-browser-profile__stale" : undefined}>
      {mediaTabs.length > 0 ? (
        <ul className="pilpod-browser-profile__list">
          {mediaTabs.map((t) => {
            const rk = tabRowKey(t);
            return (
              <UnifiedTabRow
                key={rk}
                tab={t}
                browserId={slotBrowserId}
                browserDisplayName={browser.displayName}
                busy={pendingKeys.has(rk)}
                showMediaControls
                onPlayPause={onPlayPause}
                onFocus={onFocusTab}
                onReload={onReload}
                onClose={onClose}
                onReactivate={onReactivate}
              />
            );
          })}
        </ul>
      ) : null}

      {otherTabs.length > 0 ? (
        <details className="pilpod-browser-profile__other">
          <summary className="pilpod-browser-profile__other-summary">
            {mediaTabs.length > 0 ? "Other open tabs" : "Open tabs"}
            <span className="pilpod-browser-profile__other-count">
              {otherTabs.length}
            </span>
          </summary>
          <ul className="pilpod-browser-profile__other-list">
            {otherTabs.map((t) => {
              const rk = tabRowKey(t);
              return (
                <UnifiedTabRow
                  key={rk}
                  tab={t}
                  browserId={slotBrowserId}
                  browserDisplayName={browser.displayName}
                  busy={pendingKeys.has(rk)}
                  showMediaControls={false}
                  onPlayPause={onPlayPause}
                  onFocus={onFocusTab}
                  onReload={onReload}
                  onClose={onClose}
                  onReactivate={onReactivate}
                />
              );
            })}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function BrowserSessionsPanel({
  browsers,
  pendingKeys,
  browserAudio,
  onPlayPause,
  onFocusTab,
  onReload,
  onClose,
  onReactivate,
  onMixerVolume,
  onRefreshBrowser,
}: Props) {
  if (browsers.length === 0) {
    return (
      <section role="tabpanel" id="panel-browser" aria-labelledby="tab-browser">
        <p className="pilpod-browser-panel__empty">
          No browsers detected. Install a supported browser and the PilPod
          companion extension.
        </p>
      </section>
    );
  }

  return (
    <section role="tabpanel" id="panel-browser" aria-labelledby="tab-browser">
      <div className="pilpod-browser-panel__groups">
        {browsers.map((browser) => {
          const slotId =
            browser.tabs.length > 0
              ? (browser.tabs[0].browserId ?? browser.id)
              : browser.id;
          const profileAudio = browserAudio[slotId];

          return (
            <div key={browser.id} className="pilpod-browser-profile">
              <BrowserHeader
                browser={browser}
                profileAudio={profileAudio}
                onMixerVolume={onMixerVolume}
                onRefresh={() => onRefreshBrowser(browser.id)}
              />
              <BrowserBody
                browser={browser}
                pendingKeys={pendingKeys}
                onPlayPause={onPlayPause}
                onFocusTab={onFocusTab}
                onReload={onReload}
                onClose={onClose}
                onReactivate={onReactivate}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
