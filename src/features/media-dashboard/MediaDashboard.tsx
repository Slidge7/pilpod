import "./MediaDashboard.css";
import { DashboardFooter } from "./components/DashboardFooter";
import { DashboardHeader } from "./components/DashboardHeader";
import { BrowserSessionsPanel } from "./components/BrowserSessionsPanel";
import { SourceTabBar } from "./components/SourceTabBar";
import { WidgetMediaPanel } from "./components/WidgetMediaPanel";
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
    widgetEnabled,
    toggleWidgetEnabled,
    isWidget,
    isWidgetExpanded,
    dimmingToWidget,
    fullEnterActive,
    fullEnterVisible,
    toggleBrowser,
    focusBrowserTab,
    minimizeApp,
    expandWidgetPanel,
    restoreFromWidget,
    dismissWidgetAndDisable,
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
    if (isWidgetExpanded) {
      return (
        <WidgetMediaPanel
          mainTab={mainTab}
          onMainTabChange={setMainTab}
          error={error}
          pendingKeys={pendingKeys}
          browserProfileGroups={browserProfileGroups}
          browserAudio={browserAudio}
          sessions={sessions}
          onPlayPauseBrowser={toggleBrowser}
          onFocusBrowserTab={focusBrowserTab}
          onToggleWinSession={toggleWinSession}
          onMixerVolume={(id, v) => void setMixerVolume(id, v)}
          onOpenFullWindow={() => void restoreFromWidget()}
          onDismissWidget={() => void dismissWidgetAndDisable()}
        />
      );
    }
    return (
      <WidgetView
        onExpand={() => void expandWidgetPanel()}
        onDismissWidget={() => void dismissWidgetAndDisable()}
        gestures={widgetGestures}
      />
    );
  }

  const shellClass = [
    "pilpod-shell-dim",
    "pilpod-dashboard-shell",
    dimmingToWidget ? "is-dimming" : "",
    fullEnterActive ? "is-entering" : "",
    fullEnterVisible ? "is-entered" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass}>
      <div className="pilpod-dashboard-shell__inner">
        <DashboardHeader
          browserTabCount={browserTabs.length}
          sessionCount={sessions.length}
          alwaysOnTop={alwaysOnTop}
          widgetEnabled={widgetEnabled}
          onToggleAlwaysOnTop={toggleAlwaysOnTop}
          onMinimize={minimizeApp}
          onClose={closeApp}
        />

        <SourceTabBar
          mainTab={mainTab}
          onMainTabChange={setMainTab}
          browserTabCount={browserTabs.length}
          sessionCount={sessions.length}
        />

        <main className="pilpod-dashboard-shell__main">
          {error ? (
            <div className="pilpod-alert-error">{error}</div>
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

        <DashboardFooter
          appearance={appearance}
          widgetEnabled={widgetEnabled}
          onToggleAppearance={toggle}
          onRefresh={refresh}
          onToggleWidgetEnabled={toggleWidgetEnabled}
        />
      </div>
    </div>
  );
}
