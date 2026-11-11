import { useLiveBrowsers, useVaultData } from "../data/GodModeData";
import { useNavigation } from "../navigation/Navigation";
import type { SectionId } from "../navigation/route";
import { SidebarSlotTarget } from "../navigation/SidebarSlot";
import { SECTIONS } from "./sectionRegistry";
import { StatusPanel } from "./StatusPanel";

/**
 * Sections on top, the visible section's own controls in the middle (its
 * browsers, collections or playlists), PilPod's status at the foot.
 */
export function Sidebar() {
  const { route, navigate } = useNavigation();
  const { stats } = useLiveBrowsers();
  const { vault } = useVaultData();

  const counts: Record<SectionId, number | null> = {
    live: stats.tabs,
    history: null,
    bookmarks: vault.bookmarks.length,
    playlists: vault.playlists.length,
  };

  return (
    <aside className="gm-sidebar">
      <nav className="gm-nav" aria-label="God Mode sections">
        <ul>
          {SECTIONS.map((s, i) => {
            const current = route.section === s.id;
            const count = counts[s.id];
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="gm-nav__item"
                  aria-current={current ? "page" : undefined}
                  title={`${s.description} (Ctrl+${i + 1})`}
                  onClick={() => navigate(s.id)}
                  onMouseEnter={() => void s.load()}
                >
                  <s.Icon className="gm-nav__icon" />
                  <span className="gm-nav__label">{s.label}</span>
                  {s.id === "live" && stats.playing > 0 ? (
                    <span className="gm-nav__live" title={`${stats.playing} playing`}>
                      <span className="gm-eq" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      {stats.playing}
                    </span>
                  ) : null}
                  {count !== null ? <span className="gm-nav__count">{count}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <SidebarSlotTarget className="gm-sidebar__slot" />

      <StatusPanel />
    </aside>
  );
}
