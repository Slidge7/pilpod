import { describe, it, expect } from "vitest";
import {
  ALL_GUIDES,
  CHROMIUM_GUIDE,
  EDGE_GUIDE,
  OPERA_GUIDE,
  UNSUPPORTED_GUIDE,
  guideFor,
  interpolate,
  resolveGuide,
  resolveStep,
  varsFor,
} from "..";
import type { GuideVars } from "../types";
import type { BrowserSetupInfo } from "../../types";

function browser(over: Partial<BrowserSetupInfo> = {}): BrowserSetupInfo {
  return {
    id: "chrome",
    displayName: "Google Chrome",
    engine: "chromium",
    storeSupport: "native",
    extensionsPage: "chrome://extensions",
    activationState: "inactive",
    launchable: true,
    running: true,
    extensionOnDisk: false,
    ...over,
  };
}

const VARS: GuideVars = {
  browser: "Microsoft Edge",
  storeUrl: "https://chromewebstore.google.com/detail/abc",
  extensionsPage: "edge://extensions",
};

describe("guideFor", () => {
  it("gives Chromium browsers the default guide", () => {
    for (const id of ["chrome", "brave", "vivaldi", "chromium", "arc", "yandex"]) {
      expect(guideFor(browser({ id })).id).toBe("chromium");
    }
  });

  it("gives Edge its own guide", () => {
    expect(guideFor(browser({ id: "msedge" })).id).toBe("edge");
  });

  it("gives both Opera editions the Opera guide", () => {
    expect(guideFor(browser({ id: "opera", storeSupport: "needsOptIn" })).id).toBe("opera");
    expect(guideFor(browser({ id: "operagx", storeSupport: "needsOptIn" })).id).toBe("opera");
  });

  it("routes Gecko browsers to the dead-end guide", () => {
    expect(
      guideFor(browser({ id: "firefox", engine: "gecko", storeSupport: "unsupported" })).id,
    ).toBe("unsupported");
  });

  it("falls back to the dead-end guide for a browser it has never heard of", () => {
    expect(
      guideFor(browser({ id: "netscape", engine: "chromium", storeSupport: "unsupported" })).id,
    ).toBe("unsupported");
  });

  it("lets capability override identity", () => {
    // If Edge ever stopped accepting CWS items, flipping the Rust engine table
    // must be enough — no guide edits.
    expect(guideFor(browser({ id: "msedge", storeSupport: "unsupported" })).id).toBe(
      "unsupported",
    );
  });

  it("never returns undefined for an unknown engine", () => {
    const guide = guideFor({
      id: "weird",
      engine: "gecko",
      storeSupport: "native",
    } as BrowserSetupInfo);
    expect(guide).toBeDefined();
    expect(guide.id).toBe("unsupported");
  });
});

describe("guide content invariants", () => {
  it("every guide has at least one step", () => {
    for (const g of ALL_GUIDES) expect(g.steps.length).toBeGreaterThan(0);
  });

  it("step ids are unique within a guide", () => {
    for (const g of ALL_GUIDES) {
      const ids = g.steps.map((s) => s.id);
      expect(new Set(ids).size, `duplicate step id in ${g.id}`).toBe(ids.length);
    }
  });

  it("installable guides have exactly one live step, and it is last", () => {
    for (const g of [CHROMIUM_GUIDE, EDGE_GUIDE, OPERA_GUIDE]) {
      const live = g.steps.filter((s) => s.live);
      expect(live.length, `${g.id} should have one live step`).toBe(1);
      expect(g.steps[g.steps.length - 1].live, `${g.id} live step must be last`).toBe(true);
    }
  });

  it("the dead-end guide has no live step to wait on", () => {
    expect(UNSUPPORTED_GUIDE.steps.some((s) => s.live)).toBe(false);
  });

  it("installable guides open the store exactly once", () => {
    for (const g of [CHROMIUM_GUIDE, EDGE_GUIDE, OPERA_GUIDE]) {
      const opens = g.steps.filter((s) => s.action.kind === "openStore");
      expect(opens.length, `${g.id}`).toBe(1);
    }
  });

  it("Edge warns about other stores before asking for the install", () => {
    const ids = EDGE_GUIDE.steps.map((s) => s.id);
    expect(ids.indexOf("allow-other-stores")).toBeLessThan(ids.indexOf("add-extension"));
  });

  it("Opera installs its helper add-on before opening the store", () => {
    const ids = OPERA_GUIDE.steps.map((s) => s.id);
    expect(ids.indexOf("install-helper")).toBeLessThan(ids.indexOf("open-listing"));
  });

  it("uses no placeholder the interpolator cannot resolve", () => {
    const known = /\{(browser|storeUrl|extensionsPage)\}/g;
    const anyPlaceholder = /\{[a-zA-Z]+\}/g;
    for (const g of ALL_GUIDES) {
      const text = [
        g.intro,
        ...g.steps.flatMap((s) => [s.title, s.body, s.action.label ?? ""]),
      ].join(" ");
      const used = text.match(anyPlaceholder) ?? [];
      const resolvable = text.match(known) ?? [];
      expect(used.sort(), `unknown placeholder in ${g.id}`).toEqual(resolvable.sort());
    }
  });
});

describe("interpolate", () => {
  it("replaces every known placeholder", () => {
    expect(interpolate("Add to {browser} via {storeUrl}", VARS)).toBe(
      "Add to Microsoft Edge via https://chromewebstore.google.com/detail/abc",
    );
  });

  it("replaces repeated placeholders", () => {
    expect(interpolate("{browser} and {browser}", VARS)).toBe(
      "Microsoft Edge and Microsoft Edge",
    );
  });

  it("leaves a null-valued placeholder visible rather than printing 'null'", () => {
    const out = interpolate("Open {extensionsPage}", { ...VARS, extensionsPage: null });
    expect(out).toBe("Open {extensionsPage}");
    expect(out).not.toContain("null");
  });

  it("leaves an empty-valued placeholder visible", () => {
    expect(interpolate("Go to {storeUrl}", { ...VARS, storeUrl: "" })).toBe(
      "Go to {storeUrl}",
    );
  });

  it("ignores placeholders it does not know", () => {
    expect(interpolate("Hello {unknown}", VARS)).toBe("Hello {unknown}");
  });

  it("passes plain text through untouched", () => {
    expect(interpolate("no placeholders here", VARS)).toBe("no placeholders here");
  });
});

describe("resolveStep / resolveGuide", () => {
  it("interpolates title, body and button label", () => {
    const step = resolveStep(
      {
        id: "x",
        title: "Add to {browser}",
        body: "Visit {storeUrl}",
        action: { kind: "openStore", label: "Open in {browser}" },
      },
      VARS,
    );
    expect(step.title).toBe("Add to Microsoft Edge");
    expect(step.body).toBe("Visit https://chromewebstore.google.com/detail/abc");
    expect(step.action.label).toBe("Open in Microsoft Edge");
  });

  it("leaves an action without a label alone", () => {
    const step = resolveStep(
      { id: "x", title: "t", body: "b", action: { kind: "none" } },
      VARS,
    );
    expect(step.action).toEqual({ kind: "none" });
  });

  it("preserves structural fields", () => {
    const guide = resolveGuide(EDGE_GUIDE, VARS);
    expect(guide.id).toBe(EDGE_GUIDE.id);
    expect(guide.steps.map((s) => s.id)).toEqual(EDGE_GUIDE.steps.map((s) => s.id));
    expect(guide.steps.map((s) => s.live)).toEqual(EDGE_GUIDE.steps.map((s) => s.live));
    expect(guide.steps.map((s) => s.diagram)).toEqual(
      EDGE_GUIDE.steps.map((s) => s.diagram),
    );
  });

  it("does not mutate the source guide", () => {
    const before = JSON.stringify(EDGE_GUIDE);
    resolveGuide(EDGE_GUIDE, VARS);
    expect(JSON.stringify(EDGE_GUIDE)).toBe(before);
  });

  it("leaves no placeholder behind for a fully-specified browser", () => {
    const guide = resolveGuide(CHROMIUM_GUIDE, VARS);
    const text = [guide.intro, ...guide.steps.flatMap((s) => [s.title, s.body])].join(" ");
    expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
  });
});

describe("varsFor", () => {
  it("takes the display name and deep link from the browser", () => {
    const vars = varsFor(browser({ displayName: "Brave", extensionsPage: "brave://extensions" }), "https://x");
    expect(vars).toEqual({
      browser: "Brave",
      storeUrl: "https://x",
      extensionsPage: "brave://extensions",
    });
  });

  it("carries a null extensions page through", () => {
    expect(varsFor(browser({ extensionsPage: null }), "https://x").extensionsPage).toBeNull();
  });
});
