import { Suspense, lazy, useCallback, useEffect, useMemo, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { BrowserTab } from "../../../types/media";
import { MediaItemCard } from "../../media-dashboard/components/MediaItemCard";
import { collectActiveMediaTabs, tabRowKey } from "../../media-dashboard/lib/browserMedia";
import { useBrowsers } from "../../media-dashboard/hooks/useBrowsers";
import { useBrowserControls } from "../../media-dashboard/hooks/useBrowserControls";
import { IconChevronDown, Spinner } from "../../../shared/ui/icons";
import { useWidgetState, widgetApi } from "../api";

/**
 * The expanded widget: what is playing, and a way to reach everything else.
 *
 * The panel opens on the now-playing list alone. That is the answer to "what
 * is making noise and how do I stop it", which is the question a floating
 * widget exists to answer — and it keeps the mounted tree to a handful of
 * cards instead of the dashboard's full browser hierarchy.
 *
 * The full browser list lives behind the footer button and is a separate
 * chunk, so a session that never asks for it never loads it. Opening it also
 * grows the window (Rust owns that), which is why the button reports to the
 * backend rather than flipping local state.
 */
const BrowserSessionsPanel = lazy(() =>
  import("../../media-dashboard/components/BrowserSessionsPanel").then((m) => ({
    default: m.BrowserSessionsPanel,
  })),
);

export function WidgetPanel() {
  const { browsers, browserAudio } = useBrowsers();
  // No `onBeforeExternalFocus`: the dashboard drops its always-on-top before
  // raising a browser, but the widget must stay on top — un-pinning it here
  // would hide it behind the very window it just focused.
  const controls = useBrowserControls(browsers);
  const widget = useWidgetState();
  const browsersOpen = widget.browsersOpen;

  const nowPlaying = useMemo(() => collectActiveMediaTabs(browsers), [browsers]);

  /**
   * Focusing a tab raises another application, which blurs the widget — and a
   * blurred widget collapses. Ask Rust to collapse first so the panel closes
   * deliberately rather than as a side effect that races the focus change.
   */
  const focusTab = useCallback(
    async (tab: BrowserTab, browserId: string, displayName: string) => {
      void widgetApi.setExpanded(false);
      await controls.focusTab(tab, browserId, displayName);
    },
    [controls],
  );

  const toggleBrowsers = useCallback(() => {
    void widgetApi.setBrowsersOpen(!browsersOpen);
  }, [browsersOpen]);

  // Scroll the newly revealed list into view once the window has finished
  // growing, so the footer button doesn't leave the user looking at a gap.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!browsersOpen) return;
    const id = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [browsersOpen]);

  return (
    <div className="pilpod-wpanel">
      <div className="pilpod-wpanel__card">
        {/*
          The panel is a frameless window, so the grip is both its handle and
          its only route back to the app. Double-click rather than a button:
          at this width a "Full" button would eat space the media rows need,
          and the widget is meant to be the place you *don't* open the app.
        */}
        <header
          className="pilpod-wpanel__grip"
          title="Drag to move — double-click to open PilPod"
          onPointerDown={(e) => {
            if (e.button !== 0 || e.detail > 1) return;
            void getCurrentWindow().startDragging();
          }}
          onDoubleClick={() => {
            void widgetApi.openMain();
            void widgetApi.setExpanded(false);
          }}
        >
          <span className="pilpod-wpanel__grip-bar" aria-hidden="true" />
        </header>

        <div className="pilpod-wpanel__scroll" ref={scrollRef}>
          {controls.error ? (
            <div className="pilpod-wpanel__error">{controls.error}</div>
          ) : null}

          <section className="pilpod-wpanel__section" aria-label="Playing now">
            {nowPlaying.length === 0 ? (
              <p className="pilpod-wpanel__empty">Nothing playing right now</p>
            ) : (
              <ul className="pilpod-wpanel__list">
                {nowPlaying.map(({ browserId, browserDisplayName, tab }) => {
                  const key = tabRowKey(tab);
                  return (
                    <MediaItemCard
                      key={key}
                      tab={tab}
                      browserId={browserId}
                      browserDisplayName={browserDisplayName}
                      variant="inset"
                      rootClassName="pilpod-wpanel__item"
                      busy={controls.pendingKeys.has(key)}
                      onPlayPause={controls.toggleTab}
                      onFocus={focusTab}
                      onReload={controls.reloadTab}
                      onClose={controls.closeTab}
                      onSeek={controls.seekTab}
                      onSetTabVolume={controls.setTabVolume}
                      onPip={controls.pip}
                    />
                  );
                })}
              </ul>
            )}
          </section>

          {browsersOpen ? (
            <section className="pilpod-wpanel__section" aria-label="All browsers">
              <Suspense
                fallback={
                  <div className="pilpod-wpanel__loading" role="status">
                    <Spinner />
                  </div>
                }
              >
                <BrowserSessionsPanel
                  browsers={browsers}
                  pendingKeys={controls.pendingKeys}
                  browserAudio={browserAudio}
                  onPlayPause={controls.toggleTab}
                  onFocusTab={focusTab}
                  onReload={controls.reloadTab}
                  onClose={controls.closeTab}
                  onReactivate={controls.reactivateTab}
                  onRefreshBrowser={(id) => void controls.refreshConnection(id)}
                  onMixerVolume={(id, v) => void controls.setMixerVolume(id, v)}
                  onSeekTab={controls.seekTab}
                  onSetTabVolume={controls.setTabVolume}
                  onPip={controls.pip}
                />
              </Suspense>
            </section>
          ) : null}
        </div>

        {/*
          Icon-only, full-width, glass on hover. No label because the chevron
          already says which way the panel is going, and a word here would
          compete with the media titles above it for a strip 24px tall.
        */}
        <button
          type="button"
          className="pilpod-wpanel__footer"
          data-open={browsersOpen ? "true" : undefined}
          onClick={toggleBrowsers}
          aria-expanded={browsersOpen}
          aria-label={browsersOpen ? "Hide other browsers" : "Show other browsers"}
          title={browsersOpen ? "Hide other browsers" : "Show other browsers"}
        >
          <span className="pilpod-wpanel__footer-glow" aria-hidden="true" />
          <IconChevronDown className="pilpod-wpanel__footer-icon" />
        </button>
      </div>
    </div>
  );
}
