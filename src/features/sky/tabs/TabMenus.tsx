import type { BrowserTab } from "../../../types/media";
import { IconBookmark, IconBookmarkFilled, IconSliders } from "../../../shared/ui/icons";
import { Popover, usePopover } from "../ui/Popover";
import { SaveTargetsPanel } from "./SaveTargetsPanel";
import { TabControlPanel } from "./TabControlPanel";
import "./Tabs.css";

const SAVE_SIZE = { width: 280, height: 440 };
const CONTROLS_SIZE = { width: 400, height: 300 };

/**
 * The save button on a tab: filled when the tab is bookmarked, and the way
 * into "save to a collection / add to a playlist".
 */
export function SaveTabButton({
  tab,
  browserId,
  saved,
  isMedia,
}: {
  tab: BrowserTab;
  browserId: string;
  saved: boolean;
  isMedia: boolean;
}) {
  const p = usePopover(SAVE_SIZE);
  const label = saved ? "Saved — file it somewhere else" : isMedia ? "Save or add to a playlist" : "Save to bookmarks";
  return (
    <>
      <button
        ref={p.anchorRef}
        type="button"
        className={`sky-icon-btn${saved ? " sky-icon-btn--saved" : ""}`}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={p.open}
        onClick={p.toggle}
      >
        {saved ? <IconBookmarkFilled /> : <IconBookmark />}
      </button>
      <Popover {...p} width={SAVE_SIZE.width} label="Save this tab">
        <SaveTargetsPanel tab={tab} browserId={browserId} isMedia={isMedia} />
      </Popover>
    </>
  );
}

/** Opens the full control panel for one tab. */
export function TabControlsButton({
  tab,
  browserId,
  browserName,
}: {
  tab: BrowserTab;
  browserId: string;
  browserName: string;
}) {
  const p = usePopover(CONTROLS_SIZE);
  return (
    <>
      <button
        ref={p.anchorRef}
        type="button"
        className="sky-icon-btn"
        title="All controls for this tab"
        aria-label="All controls for this tab"
        aria-haspopup="dialog"
        aria-expanded={p.open}
        onClick={p.toggle}
      >
        <IconSliders />
      </button>
      <Popover {...p} width={CONTROLS_SIZE.width} label={`Controls for ${tab.title || "tab"}`}>
        <TabControlPanel tab={tab} browserId={browserId} browserName={browserName} onDone={p.close} />
      </Popover>
    </>
  );
}
