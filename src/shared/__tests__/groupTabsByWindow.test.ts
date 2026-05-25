import { describe, expect, it } from "vitest";
import type { BrowserTab } from "../../types/media";
import { groupTabsByWindow, windowCountForTabs } from "../groupTabsByWindow";

function tab(overrides: Partial<BrowserTab> & { tabId: number; windowId: number }): BrowserTab {
  return {
    tabId: overrides.tabId,
    windowId: overrides.windowId,
    url: overrides.url ?? "",
    title: overrides.title ?? "",
    index: overrides.index ?? 0,
    active: overrides.active,
    windowFocused: overrides.windowFocused,
  };
}

describe("groupTabsByWindow", () => {
  it("groups tabs by windowId", () => {
    const groups = groupTabsByWindow([
      tab({ tabId: 1, windowId: 10, index: 0, title: "A" }),
      tab({ tabId: 2, windowId: 20, index: 0, title: "B" }),
      tab({ tabId: 3, windowId: 10, index: 1, title: "C" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.windowId === 10)?.tabs.map((t) => t.tabId)).toEqual([1, 3]);
    expect(groups.find((g) => g.windowId === 20)?.tabs.map((t) => t.tabId)).toEqual([2]);
  });

  it("puts focused window first", () => {
    const groups = groupTabsByWindow([
      tab({ tabId: 1, windowId: 10, windowFocused: false }),
      tab({ tabId: 2, windowId: 20, windowFocused: true }),
    ]);

    expect(groups[0]?.windowId).toBe(20);
    expect(groups[0]?.focused).toBe(true);
  });

  it("counts distinct windows", () => {
    expect(
      windowCountForTabs([
        tab({ tabId: 1, windowId: 10 }),
        tab({ tabId: 2, windowId: 20 }),
        tab({ tabId: 3, windowId: 10 }),
      ]),
    ).toBe(2);
  });
});
