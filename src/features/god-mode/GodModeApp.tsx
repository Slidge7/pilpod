import { useEffect } from "react";
import "./GodMode.css";
import { followStoredAppearance } from "../../theme/appearance";
import { BrowserRail } from "./components/BrowserRail";
import { BrowserSection } from "./components/BrowserSection";
import { GodModeHeader } from "./components/GodModeHeader";
import { NowPlaying } from "./components/NowPlaying";
import { RuntimePanel } from "./components/RuntimePanel";
import { StatsBar } from "./components/StatsBar";
import { useGodMode } from "./hooks/useGodMode";

/**
 * God Mode — one large window that shows everything PilPod sees and runs:
 * every browser profile and its connection, every window and tab as a
 * thumbnail card, the media playing across all of them, and PilPod's own
 * runtime (bridge, playlist player, widget).
 */
export function GodModeApp() {
  const gm = useGodMode();

  // The theme is chosen in the dashboard; follow it live.
  useEffect(() => followStoredAppearance(), []);

  const nothingKnown = gm.rail.length === 0;

  return (
    <div className="gm-shell">
      <GodModeHeader
        search={gm.query.search}
        onSearch={gm.setSearch}
        onSync={gm.syncAll}
      />
      <StatsBar
        stats={gm.stats}
        filter={gm.query.filter}
        onFilter={gm.setFilter}
      />

      {gm.error ? (
        <div className="gm-alert" role="alert">
          <span>{gm.error}</span>
          <button
            type="button"
            className="gm-btn gm-btn--ghost"
            onClick={gm.clearError}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="gm-body">
        <aside className="gm-rail">
          <BrowserRail
            entries={gm.rail}
            stats={gm.stats}
            selectedId={gm.query.browserId}
            onSelect={gm.selectBrowser}
          />
          <RuntimePanel
            player={gm.player}
            widget={gm.widget}
            stats={gm.stats}
          />
        </aside>

        <main className="gm-main">
          {nothingKnown ? (
            <div className="gm-empty">
              <h2>No browsers yet</h2>
              <p>
                PilPod has not detected a browser. Open one with the companion
                extension and it appears here, live.
              </p>
            </div>
          ) : gm.sections.length === 0 ? (
            <div className="gm-empty">
              <h2>Nothing matches</h2>
              <p>No tab fits the current search and filter.</p>
              <button
                type="button"
                className="gm-btn"
                onClick={() => {
                  gm.setSearch("");
                  gm.setFilter("all");
                }}
              >
                Show everything
              </button>
            </div>
          ) : (
            <>
              <NowPlaying
                items={gm.nowPlaying}
                pendingKeys={gm.pendingKeys}
                playerTabKey={gm.playerTabKey}
                actions={gm.actions}
              />
              {gm.sections.map((section) => (
                <BrowserSection
                  key={section.browser.id}
                  section={section}
                  audio={gm.browserAudio[section.browser.id]}
                  pendingKeys={gm.pendingKeys}
                  playerTabKey={gm.playerTabKey}
                  actions={gm.actions}
                />
              ))}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
