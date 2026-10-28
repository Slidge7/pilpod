import { memo, useState } from "react";
import type { AudioSessionInfoDto } from "../../../types/media";
import { windowGroupLabel } from "../../../shared/groupTabsByWindow";
import { IconChevronDown, IconVolumeMuted } from "../../../shared/ui/icons";
import { formatAge, tabRowKey } from "../../media-dashboard";
import type { TabCardActions } from "../hooks/useGodMode";
import type { BrowserSection as Section } from "../types";
import { BrowserIcon, StatusBadge } from "./StatusBadge";
import { TabCard } from "./TabCard";

type Props = {
  section: Section;
  audio: AudioSessionInfoDto | undefined;
  pendingKeys: ReadonlySet<string>;
  playerTabKey: string | null;
  actions: TabCardActions;
};

/** Why a section has no cards, in words the user can act on. */
function emptyMessage(section: Section): string {
  const { browser, status } = section;
  switch (status) {
    case "closed":
      return "This browser is closed. Open it and its tabs appear here.";
    case "no-ext":
      return browser.activationState === "revoked"
        ? "The companion extension stopped responding — reconnect it from Browser setup in the dashboard."
        : "The companion extension is not set up in this browser, so its tabs stay hidden.";
    case "offline":
    case "reconnecting":
      return browser.lastSyncSecs != null
        ? `Not responding (last seen ${formatAge(browser.lastSyncSecs)}). Press Sync to reconnect.`
        : "Not responding. Press Sync to reconnect.";
    case "connected":
      return "No open tabs.";
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function BrowserSectionView({
  section,
  audio,
  pendingKeys,
  playerTabKey,
  actions,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const { browser, label, status, windows, shownTabs } = section;
  const bodyId = `gm-section-${browser.id}`;

  return (
    <section className="gm-section" aria-label={label}>
      <header className="gm-section__head">
        <button
          type="button"
          className="gm-section__toggle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed((c) => !c)}
        >
          <IconChevronDown className="gm-section__chevron" />
          <BrowserIcon iconUrl={browser.iconUrl ?? null} label={label} />
          <span className="gm-section__title">
            <h3>{label}</h3>
            {label !== browser.displayName ? (
              <span className="gm-section__browser">{browser.displayName}</span>
            ) : null}
          </span>
        </button>
        <StatusBadge status={status} />
        {shownTabs > 0 ? (
          <span className="gm-section__counts">
            {plural(windows.length, "window")} · {plural(shownTabs, "tab")}
          </span>
        ) : null}
        {audio ? (
          <span
            className="gm-section__audio"
            title="Volume of this browser in the Windows mixer"
          >
            {audio.muted ? <IconVolumeMuted /> : null}
            {Math.round(audio.volume * 100)}%
          </span>
        ) : null}
      </header>

      {collapsed ? null : (
        <div id={bodyId} className="gm-section__body">
          {shownTabs === 0 ? (
            <p className="gm-section__empty">{emptyMessage(section)}</p>
          ) : (
            windows.map((group, i) => (
              <div key={group.windowId} className="gm-window">
                {windows.length > 1 || group.focused ? (
                  <h4 className="gm-window__label">
                    {group.focused ? (
                      <span className="gm-window__focus" aria-hidden="true" />
                    ) : null}
                    {windowGroupLabel(group, i)}
                  </h4>
                ) : null}
                <div className="gm-grid">
                  {group.tabs.map((tab) => (
                    <TabCard
                      key={tab.tabId}
                      tab={tab}
                      browserId={browser.id}
                      browserName={label}
                      isPlayerTab={
                        playerTabKey === `${browser.id}:${tab.tabId}`
                      }
                      busy={pendingKeys.has(tabRowKey(tab))}
                      actions={actions}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

/** One browser profile: header with its status, then its windows as card grids. */
export const BrowserSection = memo(BrowserSectionView);
