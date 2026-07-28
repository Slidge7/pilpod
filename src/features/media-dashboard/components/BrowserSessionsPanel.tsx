import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "./BrowserSessionsPanel.css";
import type { AudioSessionInfoDto, BrowserTab, DetectedBrowser } from "../../../types/media";
import {
  IconBrowserClosed,
  IconChevronRight,
  IconExtensionMissing,
  IconLaunchBrowser,
  IconMuteAll,
  IconPauseAll,
  IconRefresh,
  IconResetVolume,
  IconStatusConnected,
  IconStatusOffline,
  IconStatusReconnecting,
  IconVolumeIndicator,
} from "../../../shared/ui/icons";
import {
  groupTabsByWindow,
  windowCountForTabs,
  windowGroupLabel,
  type TabWindowGroup,
} from "../../../shared/groupTabsByWindow";
import {
  applySearchTagFilters,
  collectAllTabMatches,
  collectTextSearchMatches,
  deriveSearchTagOptions,
  groupSearchMatchesByBrowser,
  normalizeSearchQuery,
  tabRowKey,
  tabIsLinkIdentifiedMedia,
  type SearchTagOption,
} from "../lib/browserMedia";
import { browserProfileDomId } from "../lib/browserProfileScroll";
import { isBrowserLocked } from "../../extension-setup";
import { UnifiedTabRow } from "./UnifiedTabRow";
import { MediaItemCard } from "./MediaItemCard";
import { ActiveMediaStrip } from "./ActiveMediaStrip";

function browserDisplayLabel(browser: DetectedBrowser): string {
  return browser.profileLabel ?? browser.displayName;
}

/** Format an age in seconds as a compact human-readable string. */
function formatAge(secs: number): string {
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

type BrowserConnectionStatus =
  | "closed"
  | "connected"
  | "offline"
  | "reconnecting"
  | "no-ext";

function resolveBrowserStatus(browser: DetectedBrowser): BrowserConnectionStatus {
  if (!browser.running) return "closed";
  // Gated on verified activation rather than the old `extensionInstalled`
  // boolean, so a browser whose extension was removed or disabled (`revoked`)
  // reverts to the same "needs setup" treatment as one that never had it.
  if (isBrowserLocked(browser.activationState)) return "no-ext";
  if (
    browser.extensionReconnecting === true &&
    !browser.extensionConnected
  ) {
    return "reconnecting";
  }
  if (!browser.extensionConnected) return "offline";
  return "connected";
}

function browserStatusMeta(
  status: BrowserConnectionStatus,
  browser: DetectedBrowser,
): { title: string; label: string } {
  const name = browserDisplayLabel(browser);
  switch (status) {
    case "closed":
      return { title: "Browser closed", label: `${name}: closed` };
    case "connected":
      return { title: "Extension connected", label: `${name}: connected` };
    case "reconnecting":
      return {
        title: "Reconnecting to PilPod after wake…",
        label: `${name}: reconnecting`,
      };
    case "offline": {
      const cacheHint =
        browser.lastSyncSecs != null
          ? `cached ${formatAge(browser.lastSyncSecs)}`
          : null;
      return {
        title: cacheHint
          ? `Extension not responding (${cacheHint}) — click Refresh`
          : "Extension not responding — click Refresh",
        label: `${name}: offline`,
      };
    }
    case "no-ext":
      return {
        title: "Companion extension not detected in this browser",
        label: `${name}: extension not installed`,
      };
  }
}

function BrowserStatusIndicator({ browser }: { browser: DetectedBrowser }) {
  const status = resolveBrowserStatus(browser);
  const { title, label } = browserStatusMeta(status, browser);

  const icon =
    status === "closed" ? (
      <IconBrowserClosed />
    ) : status === "connected" ? (
      <IconStatusConnected />
    ) : status === "reconnecting" ? (
      <IconStatusReconnecting />
    ) : status === "offline" ? (
      <IconStatusOffline />
    ) : (
      <IconExtensionMissing />
    );

  return (
    <span
      className={`pilpod-browser-profile__status pilpod-browser-profile__status--${status}`}
      title={title}
      role="status"
      aria-label={label}
    >
      {icon}
    </span>
  );
}

/** Return value from `renderTabAccessories`. */
export type TabAccessories = {
  save?: ReactNode;
  download?: ReactNode;
};

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
  /** Jump to the extension setup section for a browser whose row is locked. */
  onOpenSetup?: (osBrowserId: string) => void;
  onSeekTab?: (tab: BrowserTab, browserId: string, seekTo: number) => void;
  onSetTabVolume?: (tab: BrowserTab, browserId: string, volume: number) => void;
  onPip?: (tab: BrowserTab, browserId: string) => void;
  onResetVolume?: (tab: BrowserTab, browserId: string) => void;
  onPauseAll?: () => void;
  onMuteAll?: () => void;
  onResetAllVolumes?: () => void;
  /** Render save/download buttons for a tab. */
  renderTabAccessories?: (
    tab: BrowserTab,
    browserId: string,
    browserDisplayName: string,
    isMediaTab: boolean,
  ) => TabAccessories;
  /**
   * Playlist player mini card, rendered under the search bar and above the
   * active-media strip. Passed as a node so this panel stays decoupled from
   * the playlist-player feature.
   */
  playerSlot?: ReactNode;
};

function BrowserHeader({
  browser,
  profileAudio,
  onRefresh,
  onMixerVolume,
  onPauseAll,
  onMuteAll,
  onResetAllVolumes,
}: {
  browser: DetectedBrowser;
  profileAudio?: AudioSessionInfoDto;
  onRefresh: () => void;
  onMixerVolume?: (instanceId: string, volume: number) => void;
  onPauseAll?: () => void;
  onMuteAll?: () => void;
  onResetAllVolumes?: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [volSliderOpen, setVolSliderOpen] = useState(false);
  const volContainerRef = useRef<HTMLDivElement>(null);
  const volHoverTimerRef = useRef<number | null>(null);

  const clearVolTimer = () => {
    if (volHoverTimerRef.current !== null) {
      window.clearTimeout(volHoverTimerRef.current);
      volHoverTimerRef.current = null;
    }
  };

  const closeVolSlider = useCallback(() => {
    setVolSliderOpen(false);
    clearVolTimer();
  }, []);

  useEffect(() => {
    if (!volSliderOpen) return;
    const onClick = (e: MouseEvent) => {
      if (volContainerRef.current && !volContainerRef.current.contains(e.target as Node)) {
        closeVolSlider();
      }
    };
    window.addEventListener("pointerdown", onClick);
    return () => {
      window.removeEventListener("pointerdown", onClick);
      clearVolTimer();
    };
  }, [volSliderOpen, closeVolSlider]);

  const handleVolPointerEnter = () => {
    if (volSliderOpen) clearVolTimer();
  };

  const handleVolPointerLeave = () => {
    if (volSliderOpen) {
      clearVolTimer();
      volHoverTimerRef.current = window.setTimeout(closeVolSlider, 1500);
    }
  };

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

  const wasapiVolPct = profileAudio
    ? (profileAudio.muted ? 0 : Math.round(profileAudio.volume * 100))
    : null;

  const isOpen = browser.running;
  const hasMediaTabs = browser.tabs.some(tabIsLinkIdentifiedMedia);
  const windowCount = windowCountForTabs(browser.tabs);
  const displayName = browserDisplayLabel(browser);

  const headClass = [
    "pilpod-browser-profile__head",
    !isOpen ? "pilpod-browser-profile__head--solo" : "",
    hasMediaTabs ? "pilpod-browser-profile__head--media" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={headClass}>
      <span className="pilpod-browser-profile__identity">
        {browser.iconUrl ? (
          <img
            src={browser.iconUrl}
            alt=""
            className="pilpod-browser-profile__icon"
            width={16}
            height={16}
          />
        ) : (
          <span
            className="pilpod-browser-profile__icon pilpod-browser-profile__icon--fallback"
            aria-hidden
          />
        )}
        {!hasMediaTabs && (
          <span className="pilpod-browser-profile__label-text">
            {displayName}
          </span>
        )}
        <BrowserStatusIndicator browser={browser} />
      </span>

      {hasMediaTabs && wasapiVolPct !== null && profileAudio && onMixerVolume ? (
        <div
          ref={volContainerRef}
          onPointerEnter={handleVolPointerEnter}
          onPointerLeave={handleVolPointerLeave}
          className={[
            "pilpod-browser-profile__vol-unified",
            volSliderOpen ? "pilpod-browser-profile__vol-unified--open" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div
            className="pilpod-browser-profile__vol-unified-icon"
            title={`Browser volume: ${wasapiVolPct}% (click to adjust)`}
            onClick={() => {
              if (volSliderOpen) closeVolSlider();
              else setVolSliderOpen(true);
            }}
          >
            <IconVolumeIndicator />
          </div>
          <div className="pilpod-browser-profile__vol-unified-track">
            <input
              type="range"
              className="pilpod-browser-profile__vol-slider"
              min="0"
              max="100"
              step="5"
              value={Math.min(wasapiVolPct, 100)}
              aria-label={`Browser volume: ${wasapiVolPct}%`}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10) / 100;
                onMixerVolume(profileAudio.instanceId, v);
              }}
            />
            <span className="pilpod-browser-profile__vol-unified-pct">
              {wasapiVolPct}%
            </span>
          </div>
        </div>
      ) : null}

      {hasMediaTabs && <span className="pilpod-browser-profile__head-spacer" />}

      {isOpen ? (
        <>
          {!hasMediaTabs && (
            <span className="pilpod-browser-profile__tab-count">
              {browser.tabCount > 0 ? (
                <>
                  {browser.tabCount} tabs
                  {windowCount > 1 ? <> · {windowCount} windows</> : null}
                </>
              ) : null}
            </span>
          )}

          {hasMediaTabs && onResetAllVolumes ? (
            <button
              type="button"
              className="pilpod-browser-profile__header-btn pilpod-browser-profile__header-btn--reset-vol"
              onClick={onResetAllVolumes}
              data-action-tooltip="Reset Volume"
              aria-label="Reset all tab volumes"
            >
              <IconResetVolume />
            </button>
          ) : null}

          {hasMediaTabs && onPauseAll ? (
            <button
              type="button"
              className="pilpod-browser-profile__header-btn pilpod-browser-profile__header-btn--pause-all"
              onClick={onPauseAll}
              data-action-tooltip="Pause All"
              aria-label="Pause all media tabs"
            >
              <IconPauseAll />
            </button>
          ) : null}

          {hasMediaTabs && onMuteAll ? (
            <button
              type="button"
              className="pilpod-browser-profile__header-btn pilpod-browser-profile__header-btn--mute-all"
              onClick={onMuteAll}
              data-action-tooltip="Mute All"
              aria-label="Mute all media tabs"
            >
              <IconMuteAll />
            </button>
          ) : null}

          <button
            type="button"
            className={[
              "pilpod-browser-profile__header-btn",
              "pilpod-browser-profile__refresh",
              refreshing ? "pilpod-browser-profile__refresh--spinning" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            title={`Wake & sync ${displayName}`}
            aria-label={`Wake and sync ${displayName}`}
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <IconRefresh />
          </button>
        </>
      ) : (
        <button
          type="button"
          className={[
            "pilpod-browser-profile__header-btn",
            "pilpod-browser-profile__open-browser",
            refreshing ? "pilpod-browser-profile__refresh--spinning" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          title={`Open ${displayName}`}
          aria-label={`Open ${displayName}`}
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <IconLaunchBrowser />
        </button>
      )}
    </header>
  );
}

function OpenTabsCollapsible({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div
      className={[
        "pilpod-browser-profile__other",
        open ? "pilpod-browser-profile__other--open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="pilpod-browser-profile__other-summary"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconChevronRight className="pilpod-browser-profile__other-chevron" />
        <span className="pilpod-browser-profile__other-summary-label">{label}</span>
        <span className="pilpod-browser-profile__other-count">{count}</span>
      </button>
      <div className="pilpod-browser-profile__other-panel">
        <div className="pilpod-browser-profile__other-panel-inner">{children}</div>
      </div>
    </div>
  );
}

function MediaAndOtherTabLists({
  tabs,
  renderTabRow,
}: {
  tabs: BrowserTab[];
  renderTabRow: (t: BrowserTab, showMediaControls: boolean) => ReactNode;
}) {
  const mediaTabs = tabs.filter(tabIsLinkIdentifiedMedia);
  const otherTabs = tabs.filter((t) => !tabIsLinkIdentifiedMedia(t));

  return (
    <>
      {mediaTabs.length > 0 ? (
        <ul className="pilpod-control-grid pilpod-browser-profile__media-grid">
          {mediaTabs.map((t) => renderTabRow(t, true))}
        </ul>
      ) : null}

      {otherTabs.length > 0 ? (
        <OpenTabsCollapsible
          label={mediaTabs.length > 0 ? "Other open tabs" : "Open tabs"}
          count={otherTabs.length}
        >
          <ul className="pilpod-control-grid pilpod-control-grid--compact pilpod-browser-profile__other-list">
            {otherTabs.map((t) => renderTabRow(t, false))}
          </ul>
        </OpenTabsCollapsible>
      ) : null}
    </>
  );
}

function WindowTabGroup({
  group,
  index,
  searching,
  renderTabRow,
}: {
  group: TabWindowGroup;
  index: number;
  searching: boolean;
  renderTabRow: (t: BrowserTab, showMediaControls: boolean) => ReactNode;
}) {
  return (
    <section
      className={[
        "pilpod-browser-profile__window",
        group.focused ? "pilpod-browser-profile__window--focused" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <header className="pilpod-browser-profile__window-head">
        {windowGroupLabel(group, index)}
      </header>
      {searching ? (
        <ul className="pilpod-control-grid pilpod-browser-profile__media-grid">
          {group.tabs.map((t) => renderTabRow(t, tabIsLinkIdentifiedMedia(t)))}
        </ul>
      ) : (
        <MediaAndOtherTabLists tabs={group.tabs} renderTabRow={renderTabRow} />
      )}
    </section>
  );
}

function GroupedTabContent({
  tabs,
  searching,
  renderTabRow,
  staleClassName,
}: {
  tabs: BrowserTab[];
  searching: boolean;
  renderTabRow: (t: BrowserTab, showMediaControls: boolean) => ReactNode;
  staleClassName?: string;
}) {
  const windowGroups = groupTabsByWindow(tabs);

  if (windowGroups.length <= 1) {
    if (searching) {
      return (
        <ul className="pilpod-control-grid pilpod-browser-profile__media-grid">
          {tabs.map((t) => renderTabRow(t, tabIsLinkIdentifiedMedia(t)))}
        </ul>
      );
    }

    return (
      <div className={staleClassName}>
        <MediaAndOtherTabLists tabs={tabs} renderTabRow={renderTabRow} />
      </div>
    );
  }

  return (
    <div className={staleClassName}>
      <div className="pilpod-browser-profile__windows">
        {windowGroups.map((group, index) => (
          <WindowTabGroup
            key={group.windowId}
            group={group}
            index={index}
            searching={searching}
            renderTabRow={renderTabRow}
          />
        ))}
      </div>
    </div>
  );
}

function BrowserBody({
  browser,
  pendingKeys,
  searching,
  onPlayPause,
  onFocusTab,
  onReload,
  onClose,
  onReactivate,
  onMixerVolume,
  profileAudio,
  onSeekTab,
  onSetTabVolume,
  onPip,
  renderTabAccessories,
  onOpenSetup,
}: {
  browser: DetectedBrowser;
  pendingKeys: ReadonlySet<string>;
  searching: boolean;
  /** Opens the extension setup section for this browser. */
  onOpenSetup?: (osBrowserId: string) => void;
  profileAudio: AudioSessionInfoDto | undefined;
  onPlayPause: (tab: BrowserTab, browserId: string) => void;
  onFocusTab: (tab: BrowserTab, browserId: string, displayName: string) => void | Promise<void>;
  onReload: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onClose: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onReactivate: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onMixerVolume: (instanceId: string, volume: number) => void;
  onSeekTab?: (tab: BrowserTab, browserId: string, seekTo: number) => void;
  onSetTabVolume?: (tab: BrowserTab, browserId: string, volume: number) => void;
  onPip?: (tab: BrowserTab, browserId: string) => void;
  renderTabAccessories?: Props["renderTabAccessories"];
}) {
  const slotBrowserId = browser.id;
  const isStale = !browser.extensionConnected && browser.tabs.length > 0;
  const displayTabs = isStale
    ? browser.tabs.map((t) => ({ ...t, media: undefined }))
    : browser.tabs;

  const renderTabRow = (t: BrowserTab, showMediaControls: boolean) => {
    const rk = tabRowKey(t);
    const isMediaTab = tabIsLinkIdentifiedMedia(t);
    const accessories = renderTabAccessories?.(
      t,
      slotBrowserId,
      browserDisplayLabel(browser),
      isMediaTab,
    );

    if (isMediaTab && showMediaControls) {
      return (
        <MediaItemCard
          key={rk}
          tab={t}
          browserId={slotBrowserId}
          browserDisplayName={browserDisplayLabel(browser)}
          variant="inset"
          busy={pendingKeys.has(rk)}
          onPlayPause={onPlayPause}
          onFocus={onFocusTab}
          onReload={onReload}
          onClose={onClose}
          onSeek={onSeekTab}
          onSetTabVolume={onSetTabVolume}
          onPip={onPip}
          saveButton={accessories?.save}
          downloadButton={accessories?.download}
        />
      );
    }

    return (
      <UnifiedTabRow
        key={rk}
        tab={t}
        browserId={slotBrowserId}
        browserDisplayName={browserDisplayLabel(browser)}
        busy={pendingKeys.has(rk)}
        showMediaControls={showMediaControls}
        profileAudio={showMediaControls ? profileAudio : undefined}
        onMixerVolume={showMediaControls ? onMixerVolume : undefined}
        onPlayPause={onPlayPause}
        onFocus={onFocusTab}
        onReload={onReload}
        onClose={onClose}
        onReactivate={onReactivate}
        saveButton={accessories?.save}
      />
    );
  };

  if (searching && browser.tabs.length > 0) {
    return (
      <GroupedTabContent
        tabs={displayTabs}
        searching
        renderTabRow={renderTabRow}
      />
    );
  }

  const locked = isBrowserLocked(browser.activationState);

  // Browser not running — nothing actionable to show.
  if (!browser.running) {
    return (
      <p className="pilpod-browser-panel__empty pilpod-browser-panel__empty--inline">
        {locked
          ? "Open this browser and set up the companion extension to see tabs."
          : "Browser is closed. Open it to see tabs."}
      </p>
    );
  }

  // Running but not verified — never set up, skipped, or the extension is gone.
  if (locked) {
    return (
      <div className="pilpod-browser-panel__empty pilpod-browser-panel__empty--inline">
        <span>
          {browser.activationState === "revoked"
            ? "The companion extension is no longer responding in this browser."
            : "Set up the companion extension to see tabs."}
        </span>
        {onOpenSetup && (
          <button
            type="button"
            className="pilpod-browser-panel__setup-btn"
            onClick={() => onOpenSetup(browser.osBrowserId)}
          >
            {browser.activationState === "revoked" ? "Reconnect" : "Set up"}
          </button>
        )}
      </div>
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

  return (
    <GroupedTabContent
      tabs={displayTabs}
      searching={false}
      renderTabRow={renderTabRow}
      staleClassName={isStale ? "pilpod-browser-profile__stale" : undefined}
    />
  );
}

function TabSearchHub({
  value,
  onChange,
  matchCount,
  searching,
  filterActive,
  expanded,
  onExpandedChange,
  sites,
  browsers: browserTags,
  selectedSites,
  selectedBrowsers,
  onToggleSite,
  onToggleBrowser,
  onExcludeSite,
  onExcludeBrowser,
}: {
  value: string;
  onChange: (value: string) => void;
  matchCount: number;
  searching: boolean;
  filterActive: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  sites: SearchTagOption[];
  browsers: SearchTagOption[];
  selectedSites: ReadonlySet<string>;
  selectedBrowsers: ReadonlySet<string>;
  onToggleSite: (key: string) => void;
  onToggleBrowser: (key: string) => void;
  onExcludeSite: (key: string) => void;
  onExcludeBrowser: (key: string) => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);

  const launcherClass = [
    "pilpod-launcher",
    expanded ? "pilpod-launcher--expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const handleShellPointerDown = () => {
    onExpandedChange(true);
  };

  const handleShellBlur = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && shellRef.current?.contains(next)) return;
    if (value.trim() || filterActive) return;
    onExpandedChange(false);
  };

  const showMatchCount = searching || filterActive;

  return (
    <div className={launcherClass}>
      <div
        ref={shellRef}
        className="pilpod-launcher__shell"
        onPointerDown={handleShellPointerDown}
        onBlur={handleShellBlur}
      >
        <div className="pilpod-launcher__bar">
          <span className="pilpod-launcher__icon" aria-hidden>
            ⌕
          </span>
          <input
            type="search"
            className="pilpod-launcher__input"
            placeholder="Find a tab…"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => onExpandedChange(true)}
            aria-label="Search tabs across all browsers"
            aria-expanded={expanded}
          />
          {value ? (
            <button
              type="button"
              className="pilpod-launcher__clear"
              aria-label="Clear search"
              onClick={() => onChange("")}
            >
              ×
            </button>
          ) : null}
        </div>

        <div className="pilpod-launcher__panel" aria-hidden={!expanded}>
          <div className="pilpod-launcher__panel-inner">
            <TabSearchFilters
              sites={sites}
              browsers={browserTags}
              selectedSites={selectedSites}
              selectedBrowsers={selectedBrowsers}
              onToggleSite={onToggleSite}
              onToggleBrowser={onToggleBrowser}
              onExcludeSite={onExcludeSite}
              onExcludeBrowser={onExcludeBrowser}
            />
            {showMatchCount ? (
              <div className="pilpod-launcher__results" aria-live="polite">
                <span className="pilpod-launcher__count">
                  {matchCount} {matchCount === 1 ? "match" : "matches"}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchFilterTag({
  tag,
  selected,
  onToggleSelect,
  onExclude,
}: {
  tag: SearchTagOption;
  selected: boolean;
  onToggleSelect: () => void;
  onExclude: () => void;
}) {
  return (
    <span
      className={[
        "pilpod-search-tag",
        selected ? "pilpod-search-tag--selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="pilpod-search-tag__label"
        aria-pressed={selected}
        title={selected ? "Show only selected tags" : "Filter to this tag"}
        onClick={onToggleSelect}
      >
        {tag.label}
        <span className="pilpod-search-tag__count">{tag.count}</span>
      </button>
      <button
        type="button"
        className="pilpod-search-tag__exclude"
        aria-label={`Exclude ${tag.label} from results`}
        title={`Exclude ${tag.label}`}
        onClick={onExclude}
      >
        ×
      </button>
    </span>
  );
}

function TabSearchFilters({
  sites,
  browsers,
  selectedSites,
  selectedBrowsers,
  onToggleSite,
  onToggleBrowser,
  onExcludeSite,
  onExcludeBrowser,
}: {
  sites: SearchTagOption[];
  browsers: SearchTagOption[];
  selectedSites: ReadonlySet<string>;
  selectedBrowsers: ReadonlySet<string>;
  onToggleSite: (key: string) => void;
  onToggleBrowser: (key: string) => void;
  onExcludeSite: (key: string) => void;
  onExcludeBrowser: (key: string) => void;
}) {
  return (
    <div className="pilpod-browser-panel__filters">
      {sites.length === 0 && browsers.length === 0 ? (
        <p className="pilpod-browser-panel__filters-empty">No tabs to filter yet.</p>
      ) : null}
      {sites.length > 0 ? (
        <div className="pilpod-browser-panel__filter-row">
          <span className="pilpod-browser-panel__filter-label">Sites</span>
          <div className="pilpod-browser-panel__filter-tags">
            {sites.map((tag) => (
              <SearchFilterTag
                key={tag.key}
                tag={tag}
                selected={selectedSites.has(tag.key)}
                onToggleSelect={() => onToggleSite(tag.key)}
                onExclude={() => onExcludeSite(tag.key)}
              />
            ))}
          </div>
        </div>
      ) : null}
      {browsers.length > 0 ? (
        <div className="pilpod-browser-panel__filter-row">
          <span className="pilpod-browser-panel__filter-label">Browsers</span>
          <div className="pilpod-browser-panel__filter-tags">
            {browsers.map((tag) => (
              <SearchFilterTag
                key={tag.key}
                tag={tag}
                selected={selectedBrowsers.has(tag.key)}
                onToggleSelect={() => onToggleBrowser(tag.key)}
                onExclude={() => onExcludeBrowser(tag.key)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function toggleSetValue(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function excludeSetValue(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  next.add(key);
  return next;
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
  onOpenSetup,
  onSeekTab,
  onSetTabVolume,
  onPip,
  onPauseAll,
  onMuteAll,
  onResetAllVolumes,
  renderTabAccessories,
  playerSlot,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [excludedSites, setExcludedSites] = useState<Set<string>>(() => new Set());
  const [excludedBrowsers, setExcludedBrowsers] = useState<Set<string>>(() => new Set());
  const [selectedSites, setSelectedSites] = useState<Set<string>>(() => new Set());
  const [selectedBrowsers, setSelectedBrowsers] = useState<Set<string>>(() => new Set());
  const [searchExpanded, setSearchExpanded] = useState(false);

  const normalizedQuery = normalizeSearchQuery(searchQuery);
  const searching = normalizedQuery.length > 0;

  const filterActive =
    selectedSites.size > 0 ||
    selectedBrowsers.size > 0 ||
    excludedSites.size > 0 ||
    excludedBrowsers.size > 0;

  const narrowResults = searching || filterActive;
  const searchExpandedEffective = searchExpanded || searching || filterActive;

  const resetTagFilters = useCallback(() => {
    setExcludedSites(new Set());
    setExcludedBrowsers(new Set());
    setSelectedSites(new Set());
    setSelectedBrowsers(new Set());
  }, []);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      resetTagFilters();
    },
    [resetTagFilters],
  );

  const allTabMatches = useMemo(() => collectAllTabMatches(browsers), [browsers]);

  const textMatches = useMemo(
    () =>
      searching
        ? collectTextSearchMatches(browsers, normalizedQuery)
        : allTabMatches,
    [browsers, normalizedQuery, searching, allTabMatches],
  );

  const tagOptions = useMemo(
    () => deriveSearchTagOptions(textMatches, excludedSites, excludedBrowsers),
    [textMatches, excludedSites, excludedBrowsers],
  );

  const filteredMatches = useMemo(
    () =>
      narrowResults
        ? applySearchTagFilters(
            textMatches,
            excludedSites,
            excludedBrowsers,
            selectedSites,
            selectedBrowsers,
          )
        : [],
    [
      textMatches,
      excludedSites,
      excludedBrowsers,
      selectedSites,
      selectedBrowsers,
      narrowResults,
    ],
  );

  const displayBrowsers = useMemo(() => {
    if (!narrowResults) return browsers;
    return groupSearchMatchesByBrowser(browsers, filteredMatches);
  }, [browsers, filteredMatches, narrowResults]);

  const matchCount = useMemo(
    () => displayBrowsers.reduce((sum, browser) => sum + browser.tabs.length, 0),
    [displayBrowsers],
  );

  const handleToggleSite = useCallback((key: string) => {
    setSelectedSites((prev) => toggleSetValue(prev, key));
  }, []);

  const handleToggleBrowser = useCallback((key: string) => {
    setSelectedBrowsers((prev) => toggleSetValue(prev, key));
  }, []);

  const handleExcludeSite = useCallback((key: string) => {
    setExcludedSites((prev) => excludeSetValue(prev, key));
    setSelectedSites((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const handleExcludeBrowser = useCallback((key: string) => {
    setExcludedBrowsers((prev) => excludeSetValue(prev, key));
    setSelectedBrowsers((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

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
      <TabSearchHub
        value={searchQuery}
        onChange={handleSearchChange}
        matchCount={matchCount}
        searching={searching}
        filterActive={filterActive}
        expanded={searchExpandedEffective}
        onExpandedChange={setSearchExpanded}
        sites={tagOptions.sites}
        browsers={tagOptions.browsers}
        selectedSites={selectedSites}
        selectedBrowsers={selectedBrowsers}
        onToggleSite={handleToggleSite}
        onToggleBrowser={handleToggleBrowser}
        onExcludeSite={handleExcludeSite}
        onExcludeBrowser={handleExcludeBrowser}
      />

      {playerSlot}

      <ActiveMediaStrip
        browsers={browsers}
        pendingKeys={pendingKeys}
        searchModeActive={searchExpandedEffective}
        onPlayPause={onPlayPause}
        onFocusTab={onFocusTab}
        onReload={onReload}
        onClose={onClose}
        onSeekTab={onSeekTab}
        onSetTabVolume={onSetTabVolume}
        onPip={onPip}
        renderTabAccessories={renderTabAccessories}
      />

      {narrowResults && displayBrowsers.length === 0 ? (
        <p className="pilpod-browser-panel__empty">
          {textMatches.length === 0
            ? <>No tabs match &ldquo;{searchQuery.trim()}&rdquo;.</>
            : "No tabs match the current filters."}
        </p>
      ) : null}

      <div className="pilpod-browser-panel__groups">
        {displayBrowsers.map((browser) => {
          const profileAudio = browserAudio[browser.id];

          const profileClass = [
            "pilpod-browser-profile",
            !browser.running ? "pilpod-browser-profile--header-only" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div
              key={browser.id}
              id={browserProfileDomId(browser.id)}
              className={profileClass}
            >
              <BrowserHeader
                browser={browser}
                profileAudio={profileAudio}
                onMixerVolume={onMixerVolume}
                onRefresh={() => onRefreshBrowser(browser.id)}
                onPauseAll={onPauseAll}
                onMuteAll={onMuteAll}
                onResetAllVolumes={onResetAllVolumes}
              />
            
              <BrowserBody
                browser={browser}
                pendingKeys={pendingKeys}
                searching={narrowResults}
                profileAudio={profileAudio}
                onOpenSetup={onOpenSetup}
                onPlayPause={onPlayPause}
                onFocusTab={onFocusTab}
                onReload={onReload}
                onClose={onClose}
                onReactivate={onReactivate}
                onMixerVolume={onMixerVolume}
                onSeekTab={onSeekTab}
                onSetTabVolume={onSetTabVolume}
                onPip={onPip}
                renderTabAccessories={renderTabAccessories}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
