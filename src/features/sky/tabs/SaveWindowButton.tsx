import { useState } from "react";
import type { BrowserTab, DetectedBrowser } from "../../../types/media";
import { captureBookmark, findCollectionByName } from "../../vault";
import { IconBookmark, Spinner } from "../../../shared/ui/icons";
import { useVaultData } from "../data/SkyData";
import { useNavigation } from "../navigation/Navigation";
import { isSavableUrl, windowCollectionName } from "./lib/controls";

type Result = { count: number; collectionId: string; name: string };

/**
 * "Save these tabs" for one browser window: every web page in it becomes a
 * bookmark in a new collection named after the window and the day — the
 * quickest way to park a research session before closing it.
 */
export function SaveWindowButton({
  tabs,
  browser,
  browserLabel,
  windowLabel,
}: {
  tabs: readonly BrowserTab[];
  browser: DetectedBrowser;
  browserLabel: string;
  windowLabel: string;
}) {
  const vault = useVaultData();
  const { navigate } = useNavigation();
  const [state, setState] = useState<"idle" | "saving" | Result | "failed">("idle");
  const savable = tabs.filter((t) => isSavableUrl(t.url));

  const save = async () => {
    if (savable.length === 0) return;
    setState("saving");
    const name = windowCollectionName(browserLabel, windowLabel, new Date());
    const existing = findCollectionByName(vault.vault.collections, name);
    const id = existing?.id ?? (await vault.createCollection(name));
    if (!id) {
      setState("failed");
      return;
    }
    const provenance = {
      osBrowserId: browser.osBrowserId,
      displayName: browser.displayName,
      profileLabel: browser.profileLabel ?? null,
    };
    const results = await Promise.all(
      savable.map((tab) => vault.saveToCollection(captureBookmark(tab, provenance), id)),
    );
    setState({ count: results.filter((r) => "id" in r).length, collectionId: id, name });
  };

  if (typeof state === "object") {
    return (
      <span className="sky-window__saved" role="status">
        Saved {state.count} tab{state.count === 1 ? "" : "s"} to “{state.name}”
        <button
          type="button"
          className="sky-link"
          onClick={() => navigate("bookmarks", { collectionId: state.collectionId, search: "" })}
        >
          View
        </button>
        <button type="button" className="sky-textbtn" onClick={() => setState("idle")} aria-label="Dismiss">
          ✕
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className="sky-window__save"
      disabled={savable.length === 0 || state === "saving"}
      title={`Bookmark the ${savable.length} page${savable.length === 1 ? "" : "s"} in this window as a new collection`}
      onClick={() => void save()}
    >
      {state === "saving" ? <Spinner /> : <IconBookmark />}
      {state === "failed" ? "Could not save — try again" : "Save tabs as collection"}
    </button>
  );
}
