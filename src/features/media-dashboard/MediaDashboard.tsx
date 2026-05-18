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
    toggleBrowserTab,
    focusBrowserTab,
    reactivateBrowserTab,
    reloadBrowserTab,
    closeBrowserTab,
    minimizeApp,
    expandWidgetPanel,
    restoreFromWidget,
    dismissWidgetAndDisable,
    closeApp,
    widgetGestures,
    toggleWinSession,
    setMixerVolume,
    refreshBrowserConnection,
    sessions,
    browsers,
    browserAudio,
  } = useMediaDashboard();

  // Count running browsers that have tabs reported by the extension.
  const browserTabCount = browsers.reduce(
    (sum, b) => sum + (b.extensionInstalled ? b.tabCount : 0),
    0,
  );

  if (isWidget) {
    if (isWidgetExpanded) {
      return (
        <WidgetMediaPanel
          mainTab={mainTab}
          onMainTabChange={setMainTab}
          error={error}
          pendingKeys={pendingKeys}
          browsers={browsers}
          browserAudio={browserAudio}
          sessions={sessions}
          onPlayPauseBrowser={toggleBrowserTab}
          onFocusBrowserTab={focusBrowserTab}
          onReloadBrowserTab={reloadBrowserTab}
          onCloseBrowserTab={closeBrowserTab}
          onReactivateBrowserTab={reactivateBrowserTab}
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
          browserTabCount={browserTabCount}
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
          browserTabCount={browserTabCount}
          sessionCount={sessions.length}
        />

        <main className="pilpod-dashboard-shell__main">
          {error ? (
            <div className="pilpod-alert-error">{error}</div>
          ) : null}

          {mainTab === "browser" ? (
            <BrowserSessionsPanel
              browsers={browsers}
              pendingKeys={pendingKeys}
              browserAudio={browserAudio}
              onPlayPause={toggleBrowserTab}
              onFocusTab={focusBrowserTab}
              onReload={reloadBrowserTab}
              onClose={closeBrowserTab}
              onReactivate={reactivateBrowserTab}
              onMixerVolume={(id, v) => void setMixerVolume(id, v)}
              onRefreshBrowser={(id) => void refreshBrowserConnection(id)}
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
