import { describe, it, expect } from "vitest";
import { shouldReportMedia } from "../mediaGate.js";

const ALLOWLISTED = "https://www.youtube.com/watch?v=abc";
const NOT_ALLOWLISTED = "https://example.com/";

describe("shouldReportMedia", () => {
  const cases = [
    {
      label: "all gates pass (active)",
      url: ALLOWLISTED,
      tabActive: true,
      tabAudible: false,
      playbackState: "playing",
      pass: true,
      reason: "all-gates-passed",
    },
    {
      label: "audible override",
      url: ALLOWLISTED,
      tabActive: false,
      tabAudible: true,
      playbackState: "playing",
      pass: true,
      reason: "all-gates-passed",
    },
    {
      label: "not active or audible",
      url: ALLOWLISTED,
      tabActive: false,
      tabAudible: false,
      playbackState: "playing",
      pass: false,
      reason: "tab-not-active",
    },
    {
      label: "paused",
      url: ALLOWLISTED,
      tabActive: true,
      tabAudible: false,
      playbackState: "paused",
      pass: false,
      reason: "not-playing",
    },
    {
      label: "empty playback state",
      url: ALLOWLISTED,
      tabActive: true,
      tabAudible: false,
      playbackState: "",
      pass: false,
      reason: "not-playing",
    },
    {
      label: "url not allowlisted (playing, active)",
      url: NOT_ALLOWLISTED,
      tabActive: true,
      tabAudible: false,
      playbackState: "playing",
      pass: false,
      reason: "url-not-allowlisted",
    },
    {
      label: "url not allowlisted (paused, inactive)",
      url: NOT_ALLOWLISTED,
      tabActive: false,
      tabAudible: false,
      playbackState: "paused",
      pass: false,
      reason: "url-not-allowlisted",
    },
  ];

  it.each(cases)("$label", ({ url, tabActive, tabAudible, playbackState, pass, reason }) => {
    const result = shouldReportMedia({
      url,
      tabActive,
      tabAudible,
      snapshot: { playbackState },
    });
    expect(result.pass).toBe(pass);
    expect(result.reason).toBe(reason);
  });
});
