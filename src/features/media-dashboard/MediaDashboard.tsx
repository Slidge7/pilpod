import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserDockBar, type ViewType } from "./components/BrowserDockBar";
import { invoke } from "@tauri-apps/api/core";
import { VaultPanel, useVault, VAULT_UI_ENABLED } from "../vault";
import { PlaylistPlayerCard, usePlaylistPlayer } from "../playlist-player";
import { INAPP_BROWSER_ID } from "../playlist-player/types";
import { SaveTabMenuButton } from "../vault/components/SaveTabMenuButton";
import {
  ExtensionSetupPanel,
  OnboardingGate,
  gateDecisionFrom,
  isBrowserLocked,
  useExtensionGate,
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
  // edits its settings. Turning it on does not send this window away — it turns
  // it into a flyout (see `widget_set_enabled`), and clicking elsewhere is what
  // hands the screen over to the chip.
  const widget = useWidgetState();

  /**
   * Minimize means one of two things, and the button has always said so.
   *
   * With the widget on, "minimize to floating widget" now actually does that:
   * the window hides, PilPod stays in the tray and the chip is the way back.
   * With it off there is nothing to minimize *into*, so this is an ordinary
   * taskbar minimize.
   */
  const { enabled: widgetEnabled, hideMain: hideToWidget } = widget;
  const minimize = useCallback(() => {
    if (widgetEnabled) hideToWidget();
    else minimizeApp();
  }, [widgetEnabled, hideToWidget, minimizeApp]);

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

  // Extension setup, split in two on purpose.
  //
  // `useExtensionGate` is the always-on half: a cheap store read that tells us
  // whether the first-run gate belongs on screen and what the menu badge says.
  // `useExtensionSetup` is the expensive half — process scan, on-disk profile
  // probe, a base64 icon per browser — and it is switched on only while the
  // setup UI is actually visible.
  //
  // They used to be one always-on hook subscribed to `browsers://update`. That
  // event is the media feed (5 Hz while anything plays), so the overview
  // command ran five times a second for a screen nobody had open.
  const extensionGate = useExtensionGate();
  const gateOpen = gateDecisionFrom(extensionGate.state, extensionGate.loading).show;
  const setupBadge = extensionGate.state.attentionCount;

  const extensionSetup = useExtensionSetup({
    active: activeTab === "setup" || gateOpen,
    onChanged: extensionGate.refresh,
  });

  const openSetupSection = useCallback(() => {
    setActiveTab("setup");
    setMenuOpen(false);
  }, []);




  // Provenance lookup for anything the save menu creates. Built from the live
  // browser list so a bookmark records the real OS browser + profile rather
  // than the internal row id.
  const browserById = useMemo(
    () => new Map(browsers.map((b) => [b.id, b])),
    [browsers],
  );

  // Render accessory buttons (bookmark) for each tab row.
  const renderTabAccessories = useCallback(
    (
      tab: BrowserTab,
      browserId: string,
      browserDisplayName: string,
      isMediaTab: boolean,
    ): TabAccessories => {
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
      return { save };
    },
    [vault, browserById],
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
          onToggleWidget={widget.toggleEnabled}
          onPrevWallpaper={wallpaper.prev}
          onNextWallpaper={wallpaper.next}
          onMinimize={minimize}
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

          {activeTab === "setup" ? (
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
          vaultEnabled={VAULT_UI_ENABLED}
          playlistEnabled={VAULT_UI_ENABLED}
        />

        <div className="pilpod-dashboard-glass-edge" aria-hidden="true" />

        <OnboardingGate api={extensionSetup} show={gateOpen}>
          {null}
        </OnboardingGate>
      </div>
    </div>
  );
}
