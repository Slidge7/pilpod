import { tabRowKey, type SearchTabMatch } from "../../../../media-dashboard";
import type { TabCardActions } from "../useLiveOverview";
import { TabCard } from "./TabCard";

type Props = {
  items: SearchTabMatch[];
  pendingKeys: ReadonlySet<string>;
  playerTabKey: string | null;
  actions: TabCardActions;
};

/** Every live media session across all browsers, playing first. */
export function NowPlaying({
  items,
  pendingKeys,
  playerTabKey,
  actions,
}: Props) {
  if (items.length === 0) return null;
  return (
    <section
      className="gm-section gm-section--spotlight"
      aria-label="Now playing"
    >
      <header className="gm-section__head">
        <h3 className="gm-section__heading">Now playing</h3>
        <span className="gm-section__counts">
          {items.length} media session{items.length === 1 ? "" : "s"}
        </span>
      </header>
      <div className="gm-section__body">
        <div className="gm-grid gm-grid--wide">
          {items.map(({ browserId, browserDisplayName, tab }) => (
            <TabCard
              key={`${browserId}:${tab.tabId}`}
              tab={tab}
              browserId={browserId}
              browserName={browserDisplayName}
              showBrowser
              isPlayerTab={playerTabKey === `${browserId}:${tab.tabId}`}
              busy={pendingKeys.has(tabRowKey(tab))}
              actions={actions}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
