import { DashboardHeader } from "./components/DashboardHeader";
import { BrowserSessionsPanel } from "./components/BrowserSessionsPanel";
import { SourceTabBar } from "./components/SourceTabBar";
import { WidgetView } from "./components/WidgetView";
import { WindowsSessionsPanel } from "./components/WindowsSessionsPanel";
import { useAppearance } from "./hooks/useAppearance";
import { useMediaDashboard } from "./hooks/useMediaDashboard";

export function MediaDashboard() {
  const { appearance, toggle } = useAppearance();
  const {
    error,
    mainTab,
    setMainTab,
    pendingKeys,
    alwaysOnTop,
    toggleAlwaysOnTop,
    refresh,
    isWidget,
    dimmingToWidget,
    fullEnterActive,
    fullEnterVisible,
    toggleBrowser,
    focusBrowserTab,
    minimizeToWidgetMode,
    restoreFromWidget,
    closeApp,
    widgetGestures,
    toggleWinSession,
    setMixerVolume,
    sessions,
    browserTabs,
    browserAudio,
    browserProfileGroups,
  } = useMediaDashboard();

  if (isWidget) {
    return (
      <WidgetView onRestore={() => void restoreFromWidget()} gestures={widgetGestures} />
    );
  }

  return (
    <div
      className={`pilpod-shell-dim flex h-screen min-h-0 flex-col bg-transparent text-zinc-900 dark:text-zinc-100 ${
        dimmingToWidget ? "is-dimming" : ""
      } ${fullEnterActive ? "is-entering" : ""} ${
        fullEnterVisible ? "is-entered" : ""
      }`}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-100 dark:bg-zinc-950">
        <DashboardHeader
          appearance={appearance}
          browserTabCount={browserTabs.length}
          sessionCount={sessions.length}
          alwaysOnTop={alwaysOnTop}
          onToggleAlwaysOnTop={toggleAlwaysOnTop}
          onToggleAppearance={toggle}
          onRefresh={refresh}
          onMinimizeToWidget={minimizeToWidgetMode}
          onClose={closeApp}
        />

        <SourceTabBar
          mainTab={mainTab}
          onMainTabChange={setMainTab}
          browserTabCount={browserTabs.length}
          sessionCount={sessions.length}
        />

        <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 py-2">
          {error ? (
            <div className="mb-2 border border-red-300 bg-red-50 px-2 py-1.5 text-[11px] text-red-800 dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-200">
              {error}
            </div>
          ) : null}

          {mainTab === "browser" ? (
            <BrowserSessionsPanel
              groups={browserProfileGroups}
              pendingKeys={pendingKeys}
              browserAudio={browserAudio}
              onPlayPauseBrowser={toggleBrowser}
              onFocusBrowserTab={focusBrowserTab}
              onMixerVolume={(id, v) => void setMixerVolume(id, v)}
            />
          ) : (
            <WindowsSessionsPanel
              sessions={sessions}
              pendingKeys={pendingKeys}
              onToggleSession={toggleWinSession}
              onMixerVolume={(id, v) => void setMixerVolume(id, v)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
