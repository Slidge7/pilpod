import type { BrowserTabMediaDto } from "../../../types/media";
import { formatMediaSeconds } from "../lib/format";
import { channelBrowser, isBrowserPlaying } from "../lib/browserMedia";
import { BrowserMediaThumb } from "./BrowserMediaThumb";
import {
  IconOpenInTab,
  IconPause,
  IconPlay,
  Spinner,
} from "./icons";

type Props = {
  tab: BrowserTabMediaDto;
  busy: boolean;
  onPlayPause: (tab: BrowserTabMediaDto) => void;
  onFocusTab: (tab: BrowserTabMediaDto) => void;
};

const iconSm = "h-3 w-3";

export function BrowserTabRow({
  tab,
  busy,
  onPlayPause,
  onFocusTab,
}: Props) {
  const playing = isBrowserPlaying(tab);
  const ch = channelBrowser(tab);
  const dur = tab.duration != null && tab.duration > 0 ? tab.duration : null;
  const pos =
    tab.currentTime != null && tab.currentTime >= 0 ? tab.currentTime : 0;
  const timeLabel =
    dur != null
      ? `${formatMediaSeconds(pos)} / ${formatMediaSeconds(dur)}`
      : null;

  return (
    <li
      className={`flex items-center gap-2 px-2 py-1 transition-colors ${
        playing
          ? "bg-emerald-50/85 dark:bg-emerald-950/18"
          : "bg-transparent hover:bg-zinc-50/90 dark:hover:bg-zinc-900/55"
      }`}
    >
      <div className="group/thumb relative h-8 w-8 shrink-0 overflow-hidden rounded-sm bg-zinc-100 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
        <BrowserMediaThumb tab={tab} />
        <button
          type="button"
          title="Open this tab in browser"
          aria-label="Open this tab in browser"
          onClick={(e) => {
            e.stopPropagation();
            void onFocusTab(tab);
          }}
          className="absolute inset-0 z-[3] inline-flex cursor-pointer items-center justify-center rounded-sm bg-zinc-100/93 text-zinc-600 opacity-0 ring-1 ring-zinc-300 transition-opacity hover:bg-zinc-200 hover:text-zinc-900 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:bg-zinc-900/93 dark:text-zinc-400 dark:ring-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:focus-visible:ring-emerald-500 group-hover/thumb:opacity-100 hover:opacity-100 [@media(hover:none)_and_(pointer:coarse)]:opacity-100"
        >
          <IconOpenInTab className={`shrink-0 ${iconSm}`} />
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <p
          className="truncate font-medium leading-none text-[12px] text-zinc-900 dark:text-zinc-50"
          title={tab.title?.trim() || undefined}
        >
          {tab.title?.trim() || "Untitled"}
        </p>
        {ch || timeLabel ? (
          <p className="truncate pt-px text-[10px] leading-snug text-zinc-600 dark:text-zinc-500">
            {ch}
            {ch && timeLabel ? (
              <span className="mx-1 text-zinc-400 dark:text-zinc-600" aria-hidden>
                |
              </span>
            ) : null}
            {timeLabel ?? ""}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        disabled={busy}
        title={playing ? "Pause" : "Play"}
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => void onPlayPause(tab)}
        className={`inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-sm border disabled:cursor-not-allowed disabled:opacity-45 ${
          playing
            ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:border-emerald-700 dark:border-emerald-500 dark:bg-emerald-600 dark:text-white dark:hover:bg-emerald-500"
            : "border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        }`}
      >
        {busy ? (
          <Spinner />
        ) : playing ? (
          <IconPause className={iconSm} />
        ) : (
          <IconPlay className={iconSm} />
        )}
      </button>
    </li>
  );
}
