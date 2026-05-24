import { describe, it, expect } from "vitest";
import { tabHasMedia } from "../browserMedia";
import type { BrowserTab } from "../../../../types/media";

function tab(media: BrowserTab["media"]): BrowserTab {
  return {
    tabId: 1,
    windowId: 1,
    url: "https://example.com",
    title: "Example",
    media,
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
