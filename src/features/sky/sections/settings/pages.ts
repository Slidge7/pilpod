import type { ComponentType } from "react";
import {
  IconExtensionMissing,
  IconHistory,
  IconImage,
  IconSun,
  IconTimer,
  IconWidgetMinimize,
} from "../../../../shared/ui/icons";
import type { SettingsPageId } from "../../navigation/route";
import { AppearancePage } from "./pages/AppearancePage";
import { BrowsersPage } from "./pages/BrowsersPage";
import { DataPage } from "./pages/DataPage";
import { IdlePage } from "./pages/IdlePage";
import { WallpaperPage } from "./pages/WallpaperPage";
import { WidgetPage } from "./pages/WidgetPage";

/** Props every settings page gets. `visible`: on screen right now. */
export type SettingsPageProps = { visible: boolean };

export type SettingsPageDef = {
  id: SettingsPageId;
  label: string;
  /** One line under the title, and the sidebar hint. */
  description: string;
  Icon: ComponentType<{ className?: string }>;
  Page: ComponentType<SettingsPageProps>;
};

/**
 * Settings pages in sidebar order. Adding one is an entry here plus its id in
 * `SETTINGS_PAGE_IDS` (navigation/route.ts) — search commands and deep links
 * pick it up from there.
 */
export const SETTINGS_PAGES: readonly SettingsPageDef[] = [
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme for every window, and the dashboard’s glass and pin",
    Icon: IconSun,
    Page: AppearancePage,
  },
  {
    id: "wallpaper",
    label: "Wallpaper",
    description: "The picture behind the dashboard and how it changes",
    Icon: IconImage,
    Page: WallpaperPage,
  },
  {
    id: "idle",
    label: "Idle mode",
    description: "How the dashboard fades back while you are away",
    Icon: IconTimer,
    Page: IdlePage,
  },
  {
    id: "widget",
    label: "Floating widget",
    description: "The chip that stays on screen when PilPod is away",
    Icon: IconWidgetMinimize,
    Page: WidgetPage,
  },
  {
    id: "browsers",
    label: "Browsers",
    description: "Set up the companion extension in each browser",
    Icon: IconExtensionMissing,
    Page: BrowsersPage,
  },
  {
    id: "data",
    label: "Data & privacy",
    description: "History recording and vault backups, kept on this PC",
    Icon: IconHistory,
    Page: DataPage,
  },
];
