import type {
  AudioSessionInfoDto,
  BrowserTabMediaDto,
  MediaSessionDto,
} from "../../../types/media";
import type { MediaMainTab } from "../model";
import { BrowserSessionsPanel } from "./BrowserSessionsPanel";
import { IconWidgetClose } from "./icons";
import { WindowsSessionsPanel } from "./WindowsSessionsPanel";

type BrowserProfileGroups = [string, BrowserTabMediaDto[]][];

type Props = {
  mainTab: MediaMainTab;
  onMainTabChange: (t: MediaMainTab) => void;
  error: string | null;
  pendingKeys: Set<string>;
  browserProfileGroups: BrowserProfileGroups;
  browserAudio: Readonly<Record<string, AudioSessionInfoDto>>;
  sessions: MediaSessionDto[];
  onPlayPauseBrowser: (t: BrowserTabMediaDto) => void;
  onFocusBrowserTab: (t: BrowserTabMediaDto) => void;
  onToggleWinSession: (s: MediaSessionDto) => void;
  onMixerVolume: (instanceId: string, volume: number) => void;
  onOpenFullWindow: () => void;
  onDismissWidget: () => void;
};

export function WidgetMediaPanel({
  mainTab,
  onMainTabChange,
  error,
  pendingKeys,
  browserProfileGroups,
  browserAudio,
  sessions,
  onPlayPauseBrowser,
  onFocusBrowserTab,
  onToggleWinSession,
  onMixerVolume,
  onOpenFullWindow,
  onDismissWidget,
}: Props) {
  return (
    <div className="relative isolate flex h-full min-h-0 w-full flex-col bg-transparent p-1.5 touch-none">
      <button
        type="button"
        className="absolute right-2 top-2 z-20 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-red-600 text-white shadow-md ring-1 ring-red-800/80 hover:bg-red-500 dark:ring-red-900/70"
        title="Turn off floating widget — minimize to taskbar"
        aria-label="Turn off floating widget and minimize to taskbar"
        onClick={() => void onDismissWidget()}
      >
        <IconWidgetClose className="shrink-0" />
      </button>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200/80 bg-zinc-100 shadow-lg dark:border-zinc-700/80 dark:bg-zinc-950">
        <div className="flex shrink-0 items-center gap-1.5 pr-8 pt-2 pl-2">
          <div className="flex flex-1 rounded-md bg-zinc-200/70 p-px dark:bg-zinc-800/90">
            <button
              type="button"
              className={`flex-1 rounded-[5px] px-2 py-0.5 text-[10px] font-medium transition-colors ${
                mainTab === "browser"
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                  : "text-zinc-500 dark:text-zinc-400"
              }`}
              onClick={() => onMainTabChange("browser")}
            >
              Browser
            </button>
            <button
              type="button"
              className={`flex-1 rounded-[5px] px-2 py-0.5 text-[10px] font-medium transition-colors ${
                mainTab === "windows"
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                  : "text-zinc-500 dark:text-zinc-400"
              }`}
              onClick={() => onMainTabChange("windows")}
            >
              Windows
            </button>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md border border-zinc-300/90 bg-white/90 px-2 py-0.5 text-[10px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800/90 dark:text-zinc-200 dark:hover:bg-zinc-800"
            title="Open full PilPod window"
            onClick={() => void onOpenFullWindow()}
          >
            Full
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {error ? (
            <div className="mb-2 border border-red-300 bg-red-50 px-2 py-1.5 text-[10px] text-red-800 dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-200">
              {error}
            </div>
          ) : null}

          {mainTab === "browser" ? (
            <BrowserSessionsPanel
              groups={browserProfileGroups}
              pendingKeys={pendingKeys}
              browserAudio={browserAudio}
              onPlayPauseBrowser={onPlayPauseBrowser}
              onFocusBrowserTab={onFocusBrowserTab}
              onMixerVolume={(id, v) => void onMixerVolume(id, v)}
            />
          ) : (
            <WindowsSessionsPanel
              sessions={sessions}
              pendingKeys={pendingKeys}
              onToggleSession={onToggleWinSession}
              onMixerVolume={(id, v) => void onMixerVolume(id, v)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
