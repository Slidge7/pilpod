import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./MediaDashboard.css";
import { DashboardHeader } from "./components/DashboardHeader";
import { SlideMenu } from "./components/SlideMenu";
import { BrowserSessionsPanel } from "./components/BrowserSessionsPanel";
import { SourceTabBar } from "./components/SourceTabBar";
import { WidgetMediaPanel } from "./components/WidgetMediaPanel";
import { WidgetView } from "./components/WidgetView";
import { useAppearance } from "./hooks/useAppearance";
import { useMediaDashboard } from "./hooks/useMediaDashboard";
import { useWallpaper } from "./hooks/useWallpaper";
import { WindowsSessionsPanel } from "../windows-media";
import { DownloadPanel } from "../downloader";

export function MediaDashboard() {
  const { appearance, toggle } = useAppearance();
  const { wallpaper, hasWallpaper, pickWallpaper, clearWallpaper } =
    useWallpaper();
  const [menuOpen, setMenuOpen] = useState(false);
  const {
    error,
    mainTab,
    setMainTab,
    pendingDownloadUrl,
    clearPendingDownloadUrl,
    downloadFromBrowserTab,
    downloader,
    browserPendingKeys,
    winPendingKeys,
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

  const browserTabCount = browsers.reduce(
    (sum, b) => sum + (b.extensionInstalled ? b.tabCount : 0),
    0,
  );

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  if (isWidget) {
    if (isWidgetExpanded) {
      return (
        <WidgetMediaPanel
          mainTab={mainTab}
          onMainTabChange={setMainTab}
          error={error}
          browserPendingKeys={browserPendingKeys}
          winPendingKeys={winPendingKeys}
          browsers={browsers}
          browserAudio={browserAudio}
          sessions={sessions}
          onPlayPauseBrowser={toggleBrowserTab}
          onFocusBrowserTab={focusBrowserTab}
          onReloadBrowserTab={reloadBrowserTab}
          onCloseBrowserTab={closeBrowserTab}
          onReactivateBrowserTab={reactivateBrowserTab}
          onRefreshBrowser={(id) => void refreshBrowserConnection(id)}
          onToggleWinSession={toggleWinSession}
          onMixerVolume={(id, v) => void setMixerVolume(id, v)}
          onOpenFullWindow={() => void restoreFromWidget()}
          onDismissWidget={() => void dismissWidgetAndDisable()}
          onDownloadFromTab={(url) => void downloadFromBrowserTab(url)}
          downloadTasks={downloader.tasks}
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

  const openDevLab = () => {
    void invoke("open_dev_lab_window").catch((err: unknown) => {
      console.error("[dev-lab] open_dev_lab_window failed:", err);
    });
  };

  return (
    <div className={shellClass}>
      <div className="pilpod-dashboard-shell__inner">
        <DashboardHeader
          menuOpen={menuOpen}
          widgetEnabled={widgetEnabled}
          onToggleMenu={() => setMenuOpen((o) => !o)}
          onMinimize={minimizeApp}
          onClose={closeApp}
        />

        <SlideMenu
          open={menuOpen}
          appearance={appearance}
          alwaysOnTop={alwaysOnTop}
          widgetEnabled={widgetEnabled}
          hasWallpaper={hasWallpaper}
          browserTabCount={browserTabCount}
          sessionCount={sessions.length}
          onClose={() => setMenuOpen(false)}
          onToggleAlwaysOnTop={toggleAlwaysOnTop}
          onToggleAppearance={toggle}
          onRefresh={refresh}
          onToggleWidgetEnabled={toggleWidgetEnabled}
          onPickWallpaper={() => void pickWallpaper()}
          onClearWallpaper={clearWallpaper}
          onOpenDevLab={openDevLab}
        />

        <SourceTabBar
          mainTab={mainTab}
          onMainTabChange={setMainTab}
          browserTabCount={browserTabCount}
          sessionCount={sessions.length}
        />

        <main
          className={[
            "pilpod-dashboard-shell__main",
            hasWallpaper ? "pilpod-dashboard-shell__main--wallpaper" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={
            wallpaper
              ? { backgroundImage: `url("${wallpaper}")` }
              : undefined
          }
        >
          {error ? (
            <div className="pilpod-alert-error">{error}</div>
          ) : null}

          {mainTab === "browser" ? (
            <BrowserSessionsPanel
              browsers={browsers}
              pendingKeys={browserPendingKeys}
              browserAudio={browserAudio}
              onPlayPause={toggleBrowserTab}
              onFocusTab={focusBrowserTab}
              onReload={reloadBrowserTab}
              onClose={closeBrowserTab}
              onReactivate={reactivateBrowserTab}
              onMixerVolume={(id, v) => void setMixerVolume(id, v)}
              onRefreshBrowser={(id) => void refreshBrowserConnection(id)}
              onDownloadFromTab={(url) => void downloadFromBrowserTab(url)}
              downloadTasks={downloader.tasks}
            />
          ) : mainTab === "windows" ? (
            <WindowsSessionsPanel
              sessions={sessions}
              pendingKeys={winPendingKeys}
              onToggleSession={toggleWinSession}
              onMixerVolume={(id, v) => void setMixerVolume(id, v)}
            />
          ) : (
            <DownloadPanel
              pendingUrl={pendingDownloadUrl}
              onPendingUrlConsumed={clearPendingDownloadUrl}
              downloader={downloader}
            />
          )}
        </main>
      </div>
    </div>
  );
}
