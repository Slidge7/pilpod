import { useEffect, useState } from "react";
import "./Settings.css";
import { useSectionIntent } from "../../navigation/Navigation";
import { isSettingsPageId, type SettingsPageId } from "../../navigation/route";
import { SectionSidebar, useSectionActive } from "../../navigation/SidebarSlot";
import { SectionLayout } from "../../ui/SectionLayout";
import { SETTINGS_PAGES } from "./pages";

const STORAGE_KEY = "pilpod-sky-settings-page";

function readStoredPage(): SettingsPageId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isSettingsPageId(raw) ? raw : "appearance";
  } catch {
    return "appearance";
  }
}

/**
 * Settings — every PilPod preference in one place: the theme, the dashboard's
 * wallpaper (set up here, shown only in the dashboard), idle mode, the
 * floating widget, browser setup and what is stored on this PC.
 *
 * Each page edits the same preferences the dashboard uses, through the same
 * hooks, and the dashboard follows changes live.
 */
export default function SettingsSection() {
  const [pageId, setPageId] = useState<SettingsPageId>(readStoredPage);
  const sectionVisible = useSectionActive();

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, pageId);
    } catch {
      /* storage unavailable */
    }
  }, [pageId]);

  useSectionIntent("settings", (intent) => {
    if (intent.settingsPage) setPageId(intent.settingsPage);
  });

  const page = SETTINGS_PAGES.find((p) => p.id === pageId) ?? SETTINGS_PAGES[0];

  return (
    <>
      <SectionSidebar>
        <nav className="sky-subnav" aria-label="Settings pages">
          <h2 className="sky-sidebar__heading">Settings</h2>
          <ul>
            {SETTINGS_PAGES.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="sky-subnav__item"
                  aria-current={p.id === page.id ? "true" : undefined}
                  title={p.description}
                  onClick={() => setPageId(p.id)}
                >
                  <p.Icon className="sky-subnav__icon" />
                  <span className="sky-subnav__label">{p.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </SectionSidebar>

      <SectionLayout label="Settings" title={page.label} meta={page.description}>
        <div className="sky-settings" key={page.id}>
          <page.Page visible={sectionVisible} />
        </div>
      </SectionLayout>
    </>
  );
}
