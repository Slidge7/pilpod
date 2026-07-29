import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserDockBar, type ViewType } from "./components/BrowserDockBar";
import { invoke } from "@tauri-apps/api/core";
import { DownloadPanel, DOWNLOADER_UI_ENABLED, useDownloader } from "../downloader";
import { downloadStatusForUrl } from "../downloader/lib";
import { TabDownloadButton } from "../downloader/components/TabDownloadButton";
import { VaultPanel, useVault, VAULT_UI_ENABLED } from "../vault";
import { PlaylistPlayerCard, usePlaylistPlayer } from "../playlist-player";
import { INAPP_BROWSER_ID } from "../playlist-player/types";
import { SaveTabMenuButton } from "../vault/components/SaveTabMenuButton";
import { DownloadDockCard } from "../downloader/components/DownloadDockCard";
import { PremiumGate } from "../premium";
import {
  ExtensionSetupPanel,
  OnboardingGate,
  isBrowserLocked,
  setupBadgeCount,
  useExtensionSetup,
} from "../extension-setup";
import type { BrowserTab } from "../../types/media";
import type { TabAccessories } from "./components/BrowserSessionsPanel";
import "./MediaDashboard.css";
import "./shell/dashboard-glass-screen.css";
import { DashboardHeader } from "./components/DashboardHeader";
import { SlideMenu } from "./components/SlideMenu";
import { BrowserSessionsPanel } from "./components/BrowserSessionsPanel";
import { useWidgetState } from "../widget";
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
  const [activeTab, setActiveTab] = useState<ViewType>("media");
  const [activeDockBrowserId, setActiveDockBrowserId] = useState<string | null>(
    null,
  );
  const {
    error,
    browserPendingKeys,
    alwaysOnTop,
    toggleAlwaysOnTop,
    refresh,
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
    closeApp,
    setMixerVolume,
    refreshBrowserConnection,
    browsers,
    browserAudio,
  } = useMediaDashboard();

  // The floating widget lives in its own window; the dashboard only reads and
  // edits its settings. Nothing here can show or hide it as a side effect —
  // the user turns it on and off from the menu, explicitly.
  const widget = useWidgetState();

  // Vault state (source of truth in Rust); mounted once, shared across views.
  const vault = useVault();

  // Playlist player session (source of truth in Rust); mounted once, shared
  // by the playlist page and the dashboard mini card.
  const playlistPlayer = usePlaylistPlayer();

  // The player tab lives ONLY in the playlist card: hide it from the browser
  // cards and the active-media strip. Identity-preserving when inactive so the
  // memoized panel tree doesn't re-render for nothing.
  const dashboardBrowsers = useMemo(() => {
    const p = playlistPlayer.player;
    if (!p.active || p.tabId == null || !p.browserId) return browsers;
    return browsers.flatMap((b) => {
      if (b.id !== p.browserId || !b.tabs.some((t) => t.tabId === p.tabId)) return [b];
      const tabs = b.tabs.filter((t) => t.tabId !== p.tabId);
      // The in-app player exists only to host this playlist — with its one tab
      // shown in the playlist card there is no source row left to render.
      if (b.id === INAPP_BROWSER_ID && tabs.length === 0) return [];
      return [{ ...b, tabs, tabCount: Math.max(0, b.tabCount - 1) }];
    });
  }, [browsers, playlistPlayer.player]);

  // Extension setup — lifted so the first-run gate, the menu badge and the
  // setup section all read one snapshot (single event listener).
  const extensionSetup = useExtensionSetup();
  const setupBadge = setupBadgeCount(extensionSetup.overview.browsers);

  const openSetupSection = useCallback(() => {
    setActiveTab("setup");
    setMenuOpen(false);
  }, []);

  // Downloader state — lifted so the floating card + in-tab buttons share one
  // snapshot with the full Download panel (single event listener).
  const dl = useDownloader();

  // Seed URL for prefilling the Download panel from an in-tab download button.
  const [downloadSeed, setDownloadSeed] = useState<string | null>(null);

  // Provenance lookup for anything the save menu creates. Built from the live
  // browser list so a bookmark records the real OS browser + profile rather
  // than the internal row id.
  const browserById = useMemo(
    () => new Map(browsers.map((b) => [b.id, b])),
    [browsers],
  );

  // Render accessory buttons (bookmark + download) for each tab row.
  const renderTabAccessories = useCallback(
    (
      tab: BrowserTab,
      browserId: string,
      browserDisplayName: string,
      isMediaTab: boolean,
    ): TabAccessories => {
      const url = tab.url ?? "";
      const b = browserById.get(browserId);
      const save = (
        <SaveTabMenuButton
          api={vault}
          tab={tab}
          isMediaTab={isMediaTab}
          browser={{
            osBrowserId: b?.osBrowserId ?? browserId,
            profileLabel: b?.profileLabel ?? null,
            displayName: b?.displayName ?? browserDisplayName,
          }}
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
    [vault, browserById, dl.tasks, setActiveTab],
  );

  // Only verified browsers contribute: a locked row shows no tabs, so counting
  // its cached tab total would put a number in the menu that nothing on screen
  // adds up to.
  const browserTabCount = browsers.reduce(
    (sum, b) => sum + (isBrowserLocked(b.activationState) ? 0 : b.tabCount),
    0,
  );

  const idleConfig = useIdleConfig();
  const isUserIdle = useDashboardIdleMode({
    enabled: idleConfig.enabled,
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

  // No widget branch: this component renders the dashboard window and only the
  // dashboard window. The widget is a separate document (`widget.html`) in a
  // separate OS window, so nothing that happens here can resize, hide or
  // otherwise disturb it.
  const shellClass = "pilpod-shell-dim pilpod-dashboard-shell";

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
          widgetEnabled={widget.enabled}
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
          widget={widget}
          wallpaper={wallpaper}
          idleConfig={idleConfig}
          browserTabCount={browserTabCount}
          glassStrength={glassStrength}
          onGlassStrengthChange={setGlassStrength}
          onClose={() => setMenuOpen(false)}
          onToggleAlwaysOnTop={toggleAlwaysOnTop}
          onToggleAppearance={toggle}
          onRefresh={refresh}
          onOpenDevLab={openDevLab}
          onOpenExtensionSetup={openSetupSection}
          extensionSetupBadge={setupBadge}
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
          ) : activeTab === "setup" ? (
            <ExtensionSetupPanel api={extensionSetup} />
          ) : activeTab === "vault" && VAULT_UI_ENABLED ? (
            <VaultPanel api={vault} browsers={browsers} forceSub="bookmarks" />
          ) : activeTab === "playlist" && VAULT_UI_ENABLED ? (
            <VaultPanel
              api={vault}
              browsers={browsers}
              forceSub="playlists"
              player={playlistPlayer}
            />
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
                browsers={dashboardBrowsers}
                pendingKeys={browserPendingKeys}
                browserAudio={browserAudio}
                onPlayPause={toggleBrowserTab}
                onFocusTab={focusBrowserTab}
                onReload={reloadBrowserTab}
                onClose={closeBrowserTab}
                onReactivate={reactivateBrowserTab}
                onMixerVolume={(id, v) => void setMixerVolume(id, v)}
                onRefreshBrowser={(id) => void refreshBrowserConnection(id)}
                onOpenSetup={openSetupSection}
                onSeekTab={seekBrowserTab}
                onSetTabVolume={setTabVolumeBrowserTab}
                onPip={pipBrowserTab}
                onResetVolume={resetTabVolumeBrowserTab}
                onPauseAll={() => void pauseAllBrowserTabs()}
                onMuteAll={() => void muteAllBrowserTabs()}
                onResetAllVolumes={() => void resetAllBrowserTabVolumes()}
                renderTabAccessories={renderTabAccessories}
                playerSlot={
                  <PlaylistPlayerCard
                    api={playlistPlayer}
                    browsers={browsers}
                    playlists={vault.vault.playlists}
                    pendingKeys={browserPendingKeys}
                    onPlayPause={toggleBrowserTab}
                    onFocusTab={focusBrowserTab}
                    onReload={reloadBrowserTab}
                    onClose={closeBrowserTab}
                    onSeekTab={seekBrowserTab}
                    onSetTabVolume={setTabVolumeBrowserTab}
                    onPip={pipBrowserTab}
                    renderTabAccessories={renderTabAccessories}
                  />
                }
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

        <OnboardingGate api={extensionSetup}>{null}</OnboardingGate>
      </div>
    </div>
  );
}
