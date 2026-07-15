import { useCallback, useEffect, useState } from "react";
import { BrowserDockBar } from "./components/BrowserDockBar";
import { invoke } from "@tauri-apps/api/core";
import { DownloadPanel, DOWNLOADER_UI_ENABLED, useDownloader } from "../downloader";
import { downloadStatusForUrl } from "../downloader/lib";
import { TabDownloadButton } from "../downloader/components/TabDownloadButton";
import { VaultPanel, useVault, VAULT_UI_ENABLED } from "../vault";
import { normalizeUrl } from "../vault/lib/normalizeUrl";
import { SaveTabButton } from "../vault/components/SaveTabButton";
import { DownloadDockCard } from "../downloader/components/DownloadDockCard";
import { PremiumGate } from "../premium";
import type { BrowserTab } from "../../types/media";
import type { TabAccessories } from "./components/BrowserSessionsPanel";
import "./MediaDashboard.css";
import "./shell/dashboard-glass-screen.css";
import { DashboardHeader } from "./components/DashboardHeader";
import { SlideMenu } from "./components/SlideMenu";
import { BrowserSessionsPanel } from "./components/BrowserSessionsPanel";
import { WidgetMediaPanel } from "./components/WidgetMediaPanel";
import { WidgetView } from "./components/WidgetView";
import { useAppearance } from "./hooks/useAppearance";
import { useGlassAppearance } from "./hooks/useGlassAppearance";
import { useMediaDashboard } from "./hooks/useMediaDashboard";
import { useWallpaper } from "./hooks/useWallpaper";
import { useStaticGlassWallpaper } from "./hooks/useStaticGlassWallpaper";
import {
  DASHBOARD_IDLE_BROWSER_OPACITY,
  DASHBOARD_IDLE_SHELL_CLASS,
  useDashboardIdleMode,
  useIdleConfig,
} from "./idle";
import "./idle/dashboard-idle-mode.css";

export function MediaDashboard() {
  const { appearance, toggle } = useAppearance();
  const { glassStrength, setGlassStrength } = useGlassAppearance();
  const wallpaper = useWallpaper(appearance);
  const hasWallpaper = wallpaper.dataUrl != null;
  // Pre-blurred wallpaper textures — replace live backdrop-filter blurs with
  // identical static slices (see useStaticGlassWallpaper.ts for the why).
  const staticGlass = useStaticGlassWallpaper(wallpaper.dataUrl, glassStrength);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"media" | "download" | "vault" | "playlist">("media");
  const [activeDockBrowserId, setActiveDockBrowserId] = useState<string | null>(
    null,
  );
  const {
    error,
    browserPendingKeys,
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
    seekBrowserTab,
    setTabVolumeBrowserTab,
    pipBrowserTab,
    resetTabVolumeBrowserTab,
    resetAllBrowserTabVolumes,
    pauseAllBrowserTabs,
    muteAllBrowserTabs,
    minimizeApp,
    expandWidgetPanel,
    restoreFromWidget,
    dismissWidgetAndDisable,
    closeApp,
    widgetGestures,
    setMixerVolume,
    refreshBrowserConnection,
    browsers,
    browserAudio,
  } = useMediaDashboard();

  // Vault state (source of truth in Rust); mounted once, shared across views.
  const vault = useVault();

  // Downloader state — lifted so the floating card + in-tab buttons share one
  // snapshot with the full Download panel (single event listener).
  const dl = useDownloader();

  // Seed URL for prefilling the Download panel from an in-tab download button.
  const [downloadSeed, setDownloadSeed] = useState<string | null>(null);

  // Render accessory buttons (bookmark + download) for each tab row.
  const renderTabAccessories = useCallback(
    (
      tab: BrowserTab,
      browserId: string,
      browserDisplayName: string,
      isMediaTab: boolean,
    ): TabAccessories => {
      const url = tab.url ?? "";
      const save = (
        <SaveTabButton
          saved={vault.savedUrlSet.has(normalizeUrl(url))}
          onToggle={() =>
            void vault.toggleBookmark({
              url,
              title: tab.title?.trim() || null,
              faviconUrl: tab.favIconUrl ?? tab.faviconUrl ?? null,
              sourceOsBrowserId: browserId,
              sourceProfileLabel: browserDisplayName,
            })
          }
        />
      );
      const download =
        isMediaTab && DOWNLOADER_UI_ENABLED ? (
          <TabDownloadButton
            status={downloadStatusForUrl(dl.tasks, url)}
            onClick={() => {
              setDownloadSeed(url);
              setActiveTab("download");
            }}
          />
        ) : undefined;
      return { save, download };
    },
    [vault, dl.tasks, setActiveTab],
  );

  const browserTabCount = browsers.reduce(
    (sum, b) => sum + (b.extensionInstalled ? b.tabCount : 0),
    0,
  );

  const idleConfig = useIdleConfig();
  const isUserIdle = useDashboardIdleMode({
    enabled: idleConfig.enabled && !isWidget,
    idleMs: idleConfig.ms,
  });

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
          error={error}
          browserPendingKeys={browserPendingKeys}
          browsers={browsers}
          browserAudio={browserAudio}
          onPlayPauseBrowser={toggleBrowserTab}
          onFocusBrowserTab={focusBrowserTab}
          onReloadBrowserTab={reloadBrowserTab}
          onCloseBrowserTab={closeBrowserTab}
          onReactivateBrowserTab={reactivateBrowserTab}
          onRefreshBrowser={(id) => void refreshBrowserConnection(id)}
          onMixerVolume={(id, v) => void setMixerVolume(id, v)}
          onSeekBrowserTab={seekBrowserTab}
          onSetTabVolume={setTabVolumeBrowserTab}
          onPip={pipBrowserTab}
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

  const openDevLab = () => {
    void invoke("open_dev_lab_window").catch((err: unknown) => {
      console.error("[dev-lab] open_dev_lab_window failed:", err);
    });
  };

  return (
    <div className={shellClass}>
      <div
        className={[
          "pilpod-dashboard-shell__inner",
          hasWallpaper ? "pilpod-dashboard-shell__inner--wallpaper" : "",
          hasWallpaper && staticGlass.ready
            ? "pilpod-dashboard-shell__inner--glass-static"
            : "",
          isUserIdle ? DASHBOARD_IDLE_SHELL_CLASS : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{
          ...(wallpaper.dataUrl
            ? { backgroundImage: `url("${wallpaper.dataUrl}")` }
            : undefined),
          ...staticGlass.styleVars,
          ...(isUserIdle
            ? {
                ["--pilpod-idle-browser-opacity" as string]:
                  String(DASHBOARD_IDLE_BROWSER_OPACITY),
              }
            : undefined),
        }}
      >
        <DashboardHeader
          menuOpen={menuOpen}
          widgetEnabled={widgetEnabled}
          alwaysOnTop={alwaysOnTop}
          onToggleMenu={() => setMenuOpen((o) => !o)}
          onToggleAlwaysOnTop={toggleAlwaysOnTop}
          onPrevWallpaper={wallpaper.prev}
          onNextWallpaper={wallpaper.next}
          onMinimize={minimizeApp}
          onClose={closeApp}
        />

        <SlideMenu
          open={menuOpen}
          appearance={appearance}
          alwaysOnTop={alwaysOnTop}
          widgetEnabled={widgetEnabled}
          wallpaper={wallpaper}
          idleConfig={idleConfig}
          browserTabCount={browserTabCount}
          glassStrength={glassStrength}
          onGlassStrengthChange={setGlassStrength}
          onClose={() => setMenuOpen(false)}
          onToggleAlwaysOnTop={toggleAlwaysOnTop}
          onToggleAppearance={toggle}
          onRefresh={refresh}
          onToggleWidgetEnabled={toggleWidgetEnabled}
          onOpenDevLab={openDevLab}
        />

        <main className="pilpod-dashboard-shell__main">
          {error ? (
            <div className="pilpod-alert-error">{error}</div>
          ) : null}

          {activeTab === "download" && DOWNLOADER_UI_ENABLED ? (
            <PremiumGate
              feature="downloader"
              featureTitle="Universal Downloader"
              featureBlurb="Download video and audio from thousands of sites in the format and quality you choose — a PilPod Premium feature."
            >
              <DownloadPanel
                dl={dl}
                seedUrl={downloadSeed}
                onSeedConsumed={() => setDownloadSeed(null)}
              />
            </PremiumGate>
          ) : activeTab === "vault" && VAULT_UI_ENABLED ? (
            <VaultPanel api={vault} browsers={browsers} forceSub="bookmarks" />
          ) : activeTab === "playlist" && VAULT_UI_ENABLED ? (
            <VaultPanel api={vault} browsers={browsers} forceSub="playlists" />
          ) : (
            <>
              <DownloadDockCard
                tasks={dl.tasks}
                onCancel={dl.cancelDownload}
                onRetry={(id) => void dl.retryDownload(id)}
                onOpenFolder={dl.openOutputDir}
                onClear={dl.clearDone}
              />
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
                onSeekTab={seekBrowserTab}
                onSetTabVolume={setTabVolumeBrowserTab}
                onPip={pipBrowserTab}
                onResetVolume={resetTabVolumeBrowserTab}
                onPauseAll={() => void pauseAllBrowserTabs()}
                onMuteAll={() => void muteAllBrowserTabs()}
                onResetAllVolumes={() => void resetAllBrowserTabVolumes()}
                renderTabAccessories={renderTabAccessories}
              />
            </>
          )}
        </main>

        <BrowserDockBar
          browsers={browsers}
          activeBrowserId={activeDockBrowserId}
          onActiveBrowserChange={setActiveDockBrowserId}
          view={activeTab}
          onSelectView={setActiveTab}
          downloaderEnabled={DOWNLOADER_UI_ENABLED}
          vaultEnabled={VAULT_UI_ENABLED}
          playlistEnabled={VAULT_UI_ENABLED}
        />

        <div className="pilpod-dashboard-glass-edge" aria-hidden="true" />
      </div>
    </div>
  );
}
