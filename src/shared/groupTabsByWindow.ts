import type { BrowserTab } from "../types/media";

export type TabWindowGroup = {
  windowId: number;
  focused: boolean;
  tabs: BrowserTab[];
};

/** Group tabs by `windowId`, focused window first, tabs sorted by index. */
export function groupTabsByWindow(tabs: BrowserTab[]): TabWindowGroup[] {
  const byWindow = new Map<number, BrowserTab[]>();

  for (const tab of tabs) {
    const windowId = tab.windowId ?? 0;
    const list = byWindow.get(windowId);
    if (list) list.push(tab);
    else byWindow.set(windowId, [tab]);
  }

  const groups: TabWindowGroup[] = [];

  for (const [windowId, windowTabs] of byWindow) {
    windowTabs.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    groups.push({
      windowId,
      focused: windowTabs.some((t) => t.windowFocused),
      tabs: windowTabs,
    });
  }

  groups.sort((a, b) => {
    if (a.focused !== b.focused) return a.focused ? -1 : 1;
    return a.windowId - b.windowId;
  });

  return groups;
}

export function windowCountForTabs(tabs: BrowserTab[]): number {
  return new Set(tabs.map((t) => t.windowId ?? 0)).size;
}

export function windowGroupLabel(
  group: TabWindowGroup,
  index: number,
): string {
  const parts = [`Window ${index + 1}`];
  if (group.focused) parts.push("focused");
  parts.push(`${group.tabs.length} tab${group.tabs.length !== 1 ? "s" : ""}`);
  return parts.join(" · ");
}
