import { describe, it, expect } from "vitest";
import {
  tabHasMedia,
  tabHasMediaControls,
  tabIsLinkIdentifiedMedia,
} from "../browserMedia";
import type { BrowserTab } from "../../../../types/media";

function tab(
  media: BrowserTab["media"],
  overrides: Partial<BrowserTab> = {},
): BrowserTab {
  return {
    tabId: 1,
    windowId: 1,
    url: "https://example.com",
    title: "Example",
    media,
    ...overrides,
  };
}

describe("tabHasMedia", () => {
  it("returns false when media is null", () => {
    expect(tabHasMedia(tab(null))).toBe(false);
  });

  it("returns true when playbackState is playing", () => {
    expect(tabHasMedia(tab({ playbackState: "playing" }))).toBe(true);
  });

  it("returns false when paused even with title and duration", () => {
    expect(
      tabHasMedia(
        tab({
          playbackState: "paused",
          title: "Song",
          duration: 300,
        }),
      ),
    ).toBe(false);
  });

  it("returns false when playbackState is empty with title", () => {
    expect(
      tabHasMedia(
        tab({
          playbackState: "",
          title: "Song",
        }),
      ),
    ).toBe(false);
  });

  it("returns true for uppercase PLAYING", () => {
    expect(tabHasMedia(tab({ playbackState: "PLAYING" }))).toBe(true);
  });
});

describe("tabIsLinkIdentifiedMedia", () => {
  it("returns true for allowlisted URLs without media snapshot", () => {
    expect(
      tabIsLinkIdentifiedMedia(
        tab(null, { url: "https://www.youtube.com/watch?v=abc" }),
      ),
    ).toBe(true);
  });

  it("returns true when mediaMatchRule is present", () => {
    expect(
      tabIsLinkIdentifiedMedia(
        tab({ playbackState: "none", mediaMatchRule: "youtube-watch" }),
      ),
    ).toBe(true);
  });

  it("returns false for non-allowlisted URLs without mediaMatchRule", () => {
    expect(tabIsLinkIdentifiedMedia(tab(null, { url: "https://example.com" }))).toBe(
      false,
    );
  });

  it("returns true for inactive sleeping allowlisted tab by URL only", () => {
    expect(
      tabIsLinkIdentifiedMedia(
        tab(null, {
          url: "https://open.spotify.com/track/abc",
          tabState: "sleeping",
          active: false,
        }),
      ),
    ).toBe(true);
  });
});

describe("tabHasMediaControls", () => {
  it("returns false without media snapshot", () => {
    expect(
      tabHasMediaControls(
        tab(null, { url: "https://www.youtube.com/watch?v=abc" }),
      ),
    ).toBe(false);
  });

  it("returns true when paused on allowlisted URL", () => {
    expect(
      tabHasMediaControls(
        tab(
          { playbackState: "paused", mediaMatchRule: "youtube-watch" },
          { url: "https://www.youtube.com/watch?v=abc" },
        ),
      ),
    ).toBe(true);
  });

  it("returns false for non-allowlisted URL even when playing", () => {
    expect(
      tabHasMediaControls(
        tab({ playbackState: "playing" }, { url: "https://example.com" }),
      ),
    ).toBe(false);
  });
});
