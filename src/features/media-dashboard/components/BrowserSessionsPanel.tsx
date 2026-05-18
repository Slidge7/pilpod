import "./BrowserSessionsPanel.css";
import type { AudioSessionInfoDto, BrowserTab, DetectedBrowser } from "../../../types/media";
import { tabRowKey, isTabPlaying, tabHasMedia } from "../lib/browserMedia";
import { AppVolumeSlider } from "./AppVolumeSlider";
import { UnifiedTabRow } from "./UnifiedTabRow";

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
};

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
}: Props) {
  // Show browsers that are running OR have the extension installed.
  const visibleBrowsers = browsers.filter(
    (b) => b.running || b.extensionInstalled,
  );

  if (visibleBrowsers.length === 0) {
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
        {visibleBrowsers.map((browser) => {
          // keyed by extension's browserId UUID (slot key) for audio matching
          const slotId =
            browser.tabs.length > 0
              ? (browser.tabs[0].browserId ?? browser.id)
              : browser.id;
          const profileAudio = browserAudio[slotId];

          const mediaTabs = browser.tabs.filter(tabHasMedia);
          const otherTabs = browser.tabs.filter((t) => !tabHasMedia(t));

          return (
            <div key={browser.id} className="pilpod-browser-profile">
              <header className="pilpod-browser-profile__head">
                <span className="pilpod-browser-profile__label">
                  {browser.displayName}
                  {browser.running ? null : (
                    <span className="pilpod-browser-profile__label-offline">
                      {" "}· not running
                    </span>
                  )}
                  {!browser.extensionInstalled ? (
                    <span
                      className="pilpod-browser-profile__badge pilpod-browser-profile__badge--warn"
                      title="Companion extension not detected in this browser"
                    >
                      no ext
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
              </header>

              {/* Media tabs */}
              {mediaTabs.length > 0 ? (
                <ul className="pilpod-browser-profile__list">
                  {mediaTabs.map((t) => {
                    const rk = tabRowKey(t);
                    return (
                      <UnifiedTabRow
                        key={rk}
                        tab={t}
                        browserId={browser.tabs[0]?.browserId ?? browser.id}
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

              {/* Non-media tabs (collapsible) */}
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
                          browserId={browser.tabs[0]?.browserId ?? browser.id}
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

              {/* Empty state for extension-detected browser with no tabs yet */}
              {browser.extensionInstalled && browser.tabs.length === 0 ? (
                <p className="pilpod-browser-panel__empty pilpod-browser-panel__empty--inline">
                  Waiting for tab data…
                </p>
              ) : null}

              {/* Not-installed nudge */}
              {!browser.extensionInstalled && browser.running ? (
                <p className="pilpod-browser-panel__empty pilpod-browser-panel__empty--inline">
                  Install the PilPod companion extension to see tabs.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
