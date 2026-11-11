import { useEffect } from "react";
import "./GodMode.css";
import "./ui/ui.css";
import { followStoredAppearance } from "../../theme/appearance";
import { GodModeDataProvider, useLiveBrowsers } from "./data/GodModeData";
import { NavigationProvider, useNavigation } from "./navigation/Navigation";
import { SidebarSlotProvider } from "./navigation/SidebarSlot";
import { GodModeHeader } from "./shell/GodModeHeader";
import { SectionHost } from "./shell/SectionHost";
import { preloadSections, SECTIONS } from "./shell/sectionRegistry";
import { Sidebar } from "./shell/Sidebar";

/**
 * God Mode — one large window over everything PilPod sees and keeps: every
 * browser, window and tab live; history; the vault's bookmarks and
 * playlists; and one search across all of it.
 *
 * Structure (see the folders):
 *   data/        one subscription per live source, one context each
 *   navigation/  where the page is, as plain data, plus intents
 *   search/      the universal search — pure engine in lib/, UI in components/
 *   sections/    one folder per section, each self-contained
 *   shell/       header, sidebar, section host
 *   ui/          primitives shared by the sections
 */
export function GodModeApp() {
  // The theme is chosen in the dashboard; follow it live.
  useEffect(() => followStoredAppearance(), []);

  // Once the first section has painted, fetch the others in the background.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 300));
    idle(() => preloadSections());
  }, []);

  return (
    <GodModeDataProvider>
      <NavigationProvider>
        <SidebarSlotProvider>
          <Shell />
        </SidebarSlotProvider>
      </NavigationProvider>
    </GodModeDataProvider>
  );
}

function Shell() {
  useSectionShortcuts();
  return (
    <div className="gm-shell">
      <GodModeHeader />
      <ErrorBanner />
      <div className="gm-body">
        <Sidebar />
        <SectionHost />
      </div>
    </div>
  );
}

/** Ctrl+1…Ctrl+4 switch sections. */
function useSectionShortcuts() {
  const { navigate } = useNavigation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const index = Number(e.key) - 1;
      const target = SECTIONS[index];
      if (!target) return;
      e.preventDefault();
      navigate(target.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}

/** Failures of tab actions (focus, close, …) from anywhere on the page. */
function ErrorBanner() {
  const { controls } = useLiveBrowsers();
  if (!controls.error) return null;
  return (
    <div className="gm-alert" role="alert">
      <span>{controls.error}</span>
      <button type="button" className="gm-btn gm-btn--ghost" onClick={() => controls.setError(null)}>
        Dismiss
      </button>
    </div>
  );
}
