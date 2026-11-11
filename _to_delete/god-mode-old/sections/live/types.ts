import type { BrowserTab, DetectedBrowser } from "../../../../types/media";
import type { BrowserConnectionStatus } from "../../../media-dashboard";

export type { OverviewStats } from "../../data/browserStats";

/** Which tabs the overview shows. */
export type TabFilter = "all" | "media" | "playing" | "audible";

/** Everything that narrows the overview, in one value. */
export type OverviewQuery = {
  filter: TabFilter;
  search: string;
  /** Restrict to one browser profile (row id); `null` = every browser. */
  browserId: string | null;
};

export const DEFAULT_QUERY: OverviewQuery = {
  filter: "all",
  search: "",
  browserId: null,
};

/** One browser profile as the side rail lists it. */
export type BrowserRailEntry = {
  id: string;
  label: string;
  /** The browser's own name when `label` is a profile name, else `null`. */
  browserName: string | null;
  iconUrl: string | null;
  status: BrowserConnectionStatus;
  windows: number;
  tabs: number;
  playing: number;
};

export type WindowGroup = {
  windowId: number;
  focused: boolean;
  tabs: BrowserTab[];
};

/** One browser profile in the main area: its windows, each a grid of cards. */
export type BrowserSection = {
  browser: DetectedBrowser;
  label: string;
  status: BrowserConnectionStatus;
  windows: WindowGroup[];
  /** Tabs after filtering — what the section actually shows. */
  shownTabs: number;
};
