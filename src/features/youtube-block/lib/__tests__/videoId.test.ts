import { describe, expect, it } from "vitest";
import { isBlockableUrl, youtubeVideoId } from "../videoId";

const ID = "dQw4w9WgXcQ";

describe("youtubeVideoId", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://www.youtube.com/watch?list=PL123&v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}&list=RDAMVM`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}#frag`,
  ])("extracts the id from %s", (url) => {
    expect(youtubeVideoId(url)).toBe(ID);
  });

  it.each([
    "",
    "https://www.youtube.com/",
    "https://www.youtube.com/results?search_query=x",
    "https://www.youtube.com/@channel",
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch?v=short",
    `https://example.com/watch?v=${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    `https://youtube.com.evil.com/watch?v=${ID}`,
    `ftp://youtube.com/watch?v=${ID}`,
    "about:blank",
    "not a url",
  ])("rejects %s", (url) => {
    expect(youtubeVideoId(url)).toBeNull();
  });

  it("handles null and undefined", () => {
    expect(youtubeVideoId(null)).toBeNull();
    expect(youtubeVideoId(undefined)).toBeNull();
  });

  it("isBlockableUrl mirrors it", () => {
    expect(isBlockableUrl(`https://youtu.be/${ID}`)).toBe(true);
    expect(isBlockableUrl("https://youtube.com/")).toBe(false);
  });
});
