import "./Live.css";
import { SectionSidebar } from "../../navigation/SidebarSlot";
import { IconMuteAll, IconPauseAll, IconResetVolume } from "../../../../shared/ui/icons";
import { EmptyState } from "../../ui/EmptyState";
import { FilterInput } from "../../ui/FilterInput";
import { plural } from "../../ui/format";
import { SectionLayout } from "../../ui/SectionLayout";
import { BrowserRail } from "./components/BrowserRail";
import { BrowserSection } from "./components/BrowserSection";
import { NowPlaying } from "./components/NowPlaying";
import { StatsBar } from "./components/StatsBar";
import { useLiveOverview } from "./useLiveOverview";

/**
 * Live — every browser profile, window and tab as it is right now, with the
 * media playing across all of them on top.
 */
export default function LiveSection() {
  const live = useLiveOverview();
  const { stats, query } = live;

  const meta = !live.hasBrowsers
    ? "No browser detected yet"
    : live.narrowing || query.browserId
      ? `${plural(live.shownTabs, "tab")} shown of ${stats.tabs}`
      : `${plural(stats.tabs, "tab")} in ${plural(stats.windows, "window")} across ${plural(stats.connected, "browser")}`;

  return (
    <>
      <SectionSidebar>
        <BrowserRail
          entries={live.rail}
          stats={stats}
          selectedId={query.browserId}
          onSelect={live.selectBrowser}
        />
      </SectionSidebar>

      <SectionLayout
        label="Live tabs"
        title="Live"
        meta={meta}
        actions={
          <>
            <div className="sky-quick" role="group" aria-label="Every tab at once">
              <button
                type="button"
                className="sky-btn"
                disabled={stats.playing === 0}
                onClick={() => void live.pauseAll()}
                title="Pause everything that is playing, in every browser"
              >
                <IconPauseAll />
                Pause all
              </button>
              <button
                type="button"
                className="sky-btn"
                disabled={stats.media === 0 && stats.audible === 0}
                onClick={() => void live.muteAll()}
                title="Mute every media tab"
              >
                <IconMuteAll />
                Mute all
              </button>
              <button
                type="button"
                className="sky-btn"
                disabled={stats.media === 0}
                onClick={() => void live.resetAllVolumes()}
                title="Set every media tab back to 100% volume"
              >
                <IconResetVolume />
                Reset volumes
              </button>
            </div>
            <FilterInput
              value={query.search}
              onChange={live.setSearch}
              placeholder="Filter tabs"
              label="Filter tabs"
            />
          </>
        }
        toolbar={<StatsBar stats={stats} filter={query.filter} onFilter={live.setFilter} />}
      >
        {!live.hasBrowsers ? (
          <EmptyState title="No browsers yet">
            Open a browser with the PilPod companion extension and it appears here, live.
          </EmptyState>
        ) : live.sections.length === 0 ? (
          <EmptyState
            title="No tab matches"
            action={
              <button type="button" className="sky-btn" onClick={live.reset}>
                Show every tab
              </button>
            }
          >
            Nothing open fits this filter{query.browserId ? " in this browser" : ""}.
          </EmptyState>
        ) : (
          <div className="sky-live-stack">
            <NowPlaying
              items={live.nowPlaying}
              pendingKeys={live.pendingKeys}
              playerTabKey={live.playerTabKey}
              actions={live.actions}
              isSaved={live.isSaved}
            />
            {live.sections.map((section) => (
              <BrowserSection
                key={section.browser.id}
                section={section}
                audio={live.browserAudio[section.browser.id]}
                pendingKeys={live.pendingKeys}
                playerTabKey={live.playerTabKey}
                actions={live.actions}
                isSaved={live.isSaved}
                onMixerVolume={live.setMixerVolume}
              />
            ))}
          </div>
        )}
      </SectionLayout>
    </>
  );
}
