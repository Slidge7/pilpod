import { describe, it, expect } from "vitest";
import { buildRegisteredScript } from "../../background/dynamicInjection.js";
import { ruleIdForDomain, normalizeDomain } from "../pilpodConfig.js";
import { originPatternsForDomain } from "../staticMediaPatterns.js";

describe("dynamicInjection", () => {
  it("ruleIdForDomain produces stable ids", () => {
    expect(ruleIdForDomain("MyCustomPlayer.com")).toBe("pilpod-custom-mycustomplayer-com");
  });

  it("normalizeDomain strips www", () => {
    expect(normalizeDomain("www.example.com")).toBe("example.com");
  });

  it("buildRegisteredScript mirrors manifest settings", () => {
    const script = buildRegisteredScript({
      id: ruleIdForDomain("example.com"),
      domain: "example.com",
      enabled: true,
      dateAdded: 0,
    });

    expect(script.matches).toEqual(originPatternsForDomain("example.com"));
    expect(script.js).toEqual(["dist/content.js"]);
    expect(script.runAt).toBe("document_start");
    expect(script.allFrames).toBe(true);
    expect(script.matchOriginAsFallback).toBe(true);
    expect(script.matchAboutBlank).toBe(true);
    expect(script.persistAcrossSessions).toBe(true);
  });
});
