import { describe, expect, it } from "vitest";
import type { BrowserProfileInfo, DetectedBrowser } from "../../../../types/media";
import {
  profileInitial,
  profileTooltip,
  unconnectedProfileGroups,
} from "../browserProfiles";

function profile(over: Partial<BrowserProfileInfo>): BrowserProfileInfo {
  return {
    dir: "Default",
    name: "Person 1",
    lastUsed: false,
    open: false,
    companion: "notInstalled",
    canLaunch: true,
    ...over,
  };
}

function row(id: string, os: string, name: string): DetectedBrowser {
  return {
    id,
    osBrowserId: os,
    displayName: name,
    running: true,
    extensionInstalled: true,
    activationState: "active",
    extensionConnected: true,
    tabCount: 0,
    tabs: [],
    lastSyncSecs: 0,
    iconUrl: `icon-${os}`,
  };
}

describe("profileInitial", () => {
  it("uses the first letter, uppercased, and copes with empty / emoji names", () => {
    expect(profileInitial("work")).toBe("W");
    expect(profileInitial("  salah ")).toBe("S");
    expect(profileInitial("")).toBe("?");
    expect(profileInitial("🎵 Music")).toBe("🎵");
  });
});

describe("profileTooltip", () => {
  it("prefers the email, falls back to a distinct account name", () => {
    expect(profileTooltip(profile({ name: "Work", email: "a@b.c" }))).toBe("Work — a@b.c");
    expect(profileTooltip(profile({ name: "Work", accountName: "Salah B" }))).toBe("Work — Salah B");
    expect(profileTooltip(profile({ name: "Salah", accountName: "Salah" }))).toBe("Salah");
  });
});

describe("unconnectedProfileGroups", () => {
  const rows = [row("uuid-work", "chrome", "Google Chrome"), row("edge", "msedge", "Microsoft Edge")];

  it("lists multi-profile browsers' profiles that have no row, with status and action", () => {
    const groups = unconnectedProfileGroups(
      {
        chrome: [
          profile({ dir: "Default", name: "Personal", companion: "notInstalled" }),
          profile({ dir: "Profile 2", name: "Work", companion: "installed", browserId: "uuid-work" }),
          profile({ dir: "Profile 3", name: "Kids", companion: "installed" }),
          profile({ dir: "Profile 4", name: "Old", companion: "disabled" }),
        ],
      },
      rows,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].browserName).toBe("Google Chrome");
    expect(groups[0].iconUrl).toBe("icon-chrome");
    expect(groups[0].profiles.map((p) => [p.profile.name, p.status, p.action])).toEqual([
      ["Personal", "notInstalled", "add"],
      ["Kids", "notConnected", "open"],
      ["Old", "disabled", "open"],
    ]);
  });

  it("skips single-profile browsers and fully connected ones", () => {
    const groups = unconnectedProfileGroups(
      {
        msedge: [profile({ name: "Only" })],
        chrome: [
          profile({ dir: "Default", browserId: "uuid-work", companion: "installed" }),
          profile({ dir: "Profile 2", browserId: "uuid-work", companion: "installed" }),
        ],
      },
      rows,
    );
    expect(groups).toEqual([]);
  });

  it("a stale UUID (no row) counts as not connected; profiles PilPod can't open get no action", () => {
    const groups = unconnectedProfileGroups(
      {
        firefox: [
          profile({ dir: "Profiles/a", name: "Main", companion: "installed", browserId: "gone", canLaunch: false }),
          profile({ dir: "Profiles/b", name: "Dev", canLaunch: false }),
        ],
      },
      rows,
    );
    expect(groups[0].browserName).toBe("firefox");
    expect(groups[0].profiles.map((p) => [p.status, p.action])).toEqual([
      ["notConnected", null],
      ["notInstalled", null],
    ]);
  });
});
