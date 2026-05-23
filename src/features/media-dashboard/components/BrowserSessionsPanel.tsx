import { useCallback, useMemo, useState } from "react";
import "./BrowserSessionsPanel.css";
import { invoke } from "@tauri-apps/api/core";
import type { AudioSessionInfoDto, BrowserTab, DetectedBrowser } from "../../../types/media";
import {
  applySearchTagFilters,
  collectTextSearchMatches,
  deriveSearchTagOptions,
  groupSearchMatchesByBrowser,
  normalizeSearchQuery,
  tabRowKey,
  tabHasMedia,
  type SearchTagOption,
} from "../lib/browserMedia";
import { AppVolumeSlider } from "../../../shared/ui/AppVolumeSlider";
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
  onDownloadFromTab?: (url: string) => void;
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
  searching,
  onPlayPause,
  onFocusTab,
  onReload,
  onClose,
  onReactivate,
  onDownload,
}: {
  browser: DetectedBrowser;
  pendingKeys: ReadonlySet<string>;
  searching: boolean;
  onPlayPause: (tab: BrowserTab, browserId: string) => void;
  onFocusTab: (tab: BrowserTab, browserId: string, displayName: string) => void | Promise<void>;
  onReload: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onClose: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onReactivate: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onDownload: (url: string) => void;
}) {
  const slotBrowserId = browser.tabs[0]?.browserId ?? browser.id;
  const mediaTabs = browser.tabs.filter(tabHasMedia);
  const otherTabs = browser.tabs.filter((t) => !tabHasMedia(t));

  const renderTabRow = (t: BrowserTab, showMediaControls: boolean) => {
    const rk = tabRowKey(t);
    return (
      <UnifiedTabRow
        key={rk}
        tab={t}
        browserId={slotBrowserId}
        browserDisplayName={browser.displayName}
        busy={pendingKeys.has(rk)}
        showMediaControls={showMediaControls}
        onPlayPause={onPlayPause}
        onFocus={onFocusTab}
        onReload={onReload}
        onClose={onClose}
        onReactivate={onReactivate}
        onDownload={showMediaControls ? onDownload : undefined}
      />
    );
  };

  if (searching && browser.tabs.length > 0) {
    return (
      <ul className="pilpod-browser-profile__list">
        {browser.tabs.map((t) => renderTabRow(t, tabHasMedia(t)))}
      </ul>
    );
  }

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
          {mediaTabs.map((t) => renderTabRow(t, true))}
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
            {otherTabs.map((t) => renderTabRow(t, false))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function TabSearchBar({
  value,
  onChange,
  matchCount,
  searching,
}: {
  value: string;
  onChange: (value: string) => void;
  matchCount: number;
  searching: boolean;
}) {
  return (
    <div className="pilpod-browser-panel__search">
      <input
        type="search"
        className="pilpod-browser-panel__search-input"
        placeholder="Search tabs across all browsers…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Search tabs across all browsers"
      />
      {value ? (
        <button
          type="button"
          className="pilpod-browser-panel__search-clear"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          ×
        </button>
      ) : null}
      {searching ? (
        <span className="pilpod-browser-panel__search-count" aria-live="polite">
          {matchCount} {matchCount === 1 ? "tab" : "tabs"}
        </span>
      ) : null}
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
  if (sites.length === 0 && browsers.length === 0) return null;

  return (
    <div className="pilpod-browser-panel__filters">
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
  onDownloadFromTab,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [excludedSites, setExcludedSites] = useState<Set<string>>(() => new Set());
  const [excludedBrowsers, setExcludedBrowsers] = useState<Set<string>>(() => new Set());
  const [selectedSites, setSelectedSites] = useState<Set<string>>(() => new Set());
  const [selectedBrowsers, setSelectedBrowsers] = useState<Set<string>>(() => new Set());

  const normalizedQuery = normalizeSearchQuery(searchQuery);
  const searching = normalizedQuery.length > 0;

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

  const textMatches = useMemo(
    () => (searching ? collectTextSearchMatches(browsers, normalizedQuery) : []),
    [browsers, normalizedQuery, searching],
  );

  const tagOptions = useMemo(
    () =>
      searching
        ? deriveSearchTagOptions(textMatches, excludedSites, excludedBrowsers)
        : { sites: [], browsers: [] },
    [textMatches, excludedSites, excludedBrowsers, searching],
  );

  const filteredMatches = useMemo(
    () =>
      searching
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
      searching,
    ],
  );

  const displayBrowsers = useMemo(() => {
    if (!searching) return browsers;
    return groupSearchMatchesByBrowser(browsers, filteredMatches);
  }, [browsers, filteredMatches, searching]);

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

  const handleDownload = useCallback(
    (url: string) => {
      if (onDownloadFromTab) {
        onDownloadFromTab(url);
        return;
      }
      // Fallback: fire-and-forget dl_start with best quality preset.
      void invoke("dl_start", {
        url,
        formatId: "bestvideo+bestaudio/best",
        audioOnly: false,
        audioFormat: null,
      });
    },
    [onDownloadFromTab],
  );
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
      <TabSearchBar
        value={searchQuery}
        onChange={handleSearchChange}
        matchCount={matchCount}
        searching={searching}
      />

      {searching ? (
        <TabSearchFilters
          sites={tagOptions.sites}
          browsers={tagOptions.browsers}
          selectedSites={selectedSites}
          selectedBrowsers={selectedBrowsers}
          onToggleSite={handleToggleSite}
          onToggleBrowser={handleToggleBrowser}
          onExcludeSite={handleExcludeSite}
          onExcludeBrowser={handleExcludeBrowser}
        />
      ) : null}

      {searching && displayBrowsers.length === 0 ? (
        <p className="pilpod-browser-panel__empty">
          {textMatches.length === 0
            ? <>No tabs match &ldquo;{searchQuery.trim()}&rdquo;.</>
            : "No tabs match the current filters."}
        </p>
      ) : null}

      <div className="pilpod-browser-panel__groups">
        {displayBrowsers.map((browser) => {
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
                searching={searching}
                onPlayPause={onPlayPause}
                onFocusTab={onFocusTab}
                onReload={onReload}
                onClose={onClose}
                onReactivate={onReactivate}
                onDownload={handleDownload}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
