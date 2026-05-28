import "./DevLabBrowserRow.css";
import type { BrowserTab } from "../../../types/media";
import {
  groupTabsByWindow,
  windowCountForTabs,
  windowGroupLabel,
  type TabWindowGroup,
} from "../../../shared/groupTabsByWindow";
import type {
  DevBrowserProcessState,
  DevBrowserTabScan,
  DevOsBrowserRow,
  DevWakeAndSyncResult,
} from "../hooks/useDevLabScans";

type Props = {
  browser: DevOsBrowserRow;
  tabScan: DevBrowserTabScan | undefined;
  wakeResult: DevWakeAndSyncResult | undefined;
  scanning: boolean;
  waking: boolean;
  onScanTabs: () => void;
  onWakeAndSync: () => void;
};

function processStateLabel(state: DevBrowserProcessState): string {
  switch (state) {
    case "notInstalled":
      return "not installed";
    case "notRunning":
      return "installed · not running";
    case "portable":
      return "running (portable)";
    case "active":
      return "active";
    case "inactive":
      return "inactive";
    case "notResponding":
      return "not responding";
    case "running":
      return "running";
    default:
      return state;
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function profileStatus(profile: DevBrowserTabScan["profiles"][number]): string {
  if (!profile.extensionInstalled) return "extension not installed";
  const windows = windowCountForTabs(profile.tabs);
  const windowHint = windows > 1 ? ` · ${windows} windows` : "";
  if (profile.extensionConnected) {
    return `connected · ${profile.tabCount} tabs${windowHint}`;
  }
  return `offline · ${profile.tabCount} cached tabs${windowHint}`;
}

function windowLabel(group: TabWindowGroup, index: number): string {
  return `${windowGroupLabel(group, index)} · id ${group.windowId}`;
}

function TabRow({ tab }: { tab: BrowserTab }) {
  return (
    <li
      className={`dev-lab-browser-row__tab-item${tab.active ? " dev-lab-browser-row__tab-item--active" : ""}`}
    >
      <span className="dev-lab-browser-row__tab-title">
        {tab.title || tab.url || `Tab ${tab.tabId}`}
      </span>
      {tab.active ? (
        <span className="dev-lab-browser-row__tab-badge">active</span>
      ) : null}
      {tab.media?.playbackState ? (
        <span className="dev-lab-browser-row__tab-media">
          {" "}
          · {tab.media.playbackState}
        </span>
      ) : null}
      {tab.url ? (
        <span className="dev-lab-browser-row__tab-url"> — {tab.url}</span>
      ) : null}
    </li>
  );
}

function ProfileTabList({
  tabs,
  profileId,
}: {
  tabs: BrowserTab[];
  profileId: string;
}) {
  const windowGroups = groupTabsByWindow(tabs);

  if (windowGroups.length <= 1) {
    return (
      <ul className="dev-lab-browser-row__tab-list">
        {tabs.map((tab) => (
          <TabRow key={`${profileId}-${tab.tabId}`} tab={tab} />
        ))}
      </ul>
    );
  }

  return (
    <div className="dev-lab-browser-row__windows">
      {windowGroups.map((group, index) => (
        <section
          key={`${profileId}-win-${group.windowId}`}
          className={`dev-lab-browser-row__window${group.focused ? " dev-lab-browser-row__window--focused" : ""}`}
        >
          <p className="dev-lab-browser-row__window-label">{windowLabel(group, index)}</p>
          <ul className="dev-lab-browser-row__tab-list">
            {group.tabs.map((tab) => (
              <TabRow key={`${profileId}-${tab.tabId}`} tab={tab} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function DevLabBrowserRow({
  browser,
  tabScan,
  wakeResult,
  scanning,
  waking,
  onScanTabs,
  onWakeAndSync,
}: Props) {
  const osActionsEnabled = browser.installed || browser.running;

  return (
    <li
      className={`dev-lab-browser-row${browser.installed ? "" : " dev-lab-browser-row--absent"}`}
    >
      <div className="dev-lab-browser-row__header">
        <div className="dev-lab-browser-row__info">
          <div className="dev-lab-browser-row__title">
            {browser.iconUrl ? (
              <img
                src={browser.iconUrl}
                alt=""
                className="dev-lab-browser-row__icon"
                width={20}
                height={20}
              />
            ) : (
              <span className="dev-lab-browser-row__icon dev-lab-browser-row__icon--fallback" aria-hidden />
            )}
            <span className="dev-lab-browser-row__name">{browser.displayName}</span>
          </div>
          <span className="dev-lab-browser-row__status">
            {processStateLabel(browser.processState)}
            {browser.processCount > 0
              ? ` · ${browser.processCount} window${browser.processCount !== 1 ? "s" : ""}`
              : ""}
            {" · "}
            {browser.extensionInstalledOs
              ? "PilPod extension on disk"
              : "no PilPod extension on disk"}
          </span>
        </div>
        <div className="dev-lab-browser-row__actions">
          <button
            type="button"
            className="dev-lab-browser-row__wake-btn"
            onClick={() => void onWakeAndSync()}
            disabled={!osActionsEnabled || waking || scanning}
            title={
              osActionsEnabled
                ? undefined
                : "Install or launch this browser first"
            }
          >
            {waking ? "Waking…" : "Wake & Sync"}
          </button>
          <button
            type="button"
            className="dev-lab-browser-row__scan-btn"
            onClick={() => void onScanTabs()}
            disabled={!osActionsEnabled || scanning || waking}
            title={
              osActionsEnabled
                ? undefined
                : "Install or launch this browser first"
            }
          >
            {scanning ? "Scanning…" : "Scan tabs"}
          </button>
        </div>
      </div>

      {wakeResult ? (
        <div className="dev-lab-browser-row__wake-result">
          <span
            className={`dev-lab-browser-row__wake-pill dev-lab-browser-row__wake-pill--${
              wakeResult.connected
                ? "ok"
                : wakeResult.timedOut
                  ? "timeout"
                  : "err"
            }`}
          >
            {wakeResult.connected
              ? `Connected (${wakeResult.waitMs}ms)`
              : wakeResult.timedOut
                ? `Timed out (${wakeResult.waitMs}ms)`
                : (wakeResult.error ?? "Error")}
          </span>
          {wakeResult.launched ? (
            <span className="dev-lab-browser-row__wake-pill dev-lab-browser-row__wake-pill--info">
              Launched
            </span>
          ) : null}
          {wakeResult.profiles.map((profile) => (
            <span
              key={profile.browserId}
              className="dev-lab-browser-row__wake-pill dev-lab-browser-row__wake-pill--tabs"
            >
              {profile.tabCount} tab{profile.tabCount !== 1 ? "s" : ""}
            </span>
          ))}
        </div>
      ) : null}

      {tabScan ? (
        <div className="dev-lab-browser-row__tabs">
          <p className="dev-lab-browser-row__tabs-meta">
            Tab scan · {formatTime(tabScan.scannedAt)}
          </p>
          {tabScan.profiles.length === 0 ? (
            <p className="dev-lab-browser-row__empty">No extension profiles found.</p>
          ) : (
            tabScan.profiles.map((profile) => (
              <div key={profile.browserId} className="dev-lab-browser-row__profile">
                <p className="dev-lab-browser-row__profile-label">
                  {profile.profileLabel ?? profile.browserId.slice(0, 8)}
                  {" · "}
                  {profileStatus(profile)}
                </p>
                {profile.tabs.length === 0 ? (
                  <p className="dev-lab-browser-row__empty">No tabs reported.</p>
                ) : (
                  <ProfileTabList tabs={profile.tabs} profileId={profile.browserId} />
                )}
              </div>
            ))
          )}
        </div>
      ) : null}
    </li>
  );
}
