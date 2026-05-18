import "./WidgetMediaPanel.css";
import type {
  AudioSessionInfoDto,
  BrowserTab,
  DetectedBrowser,
  MediaSessionDto,
} from "../../../types/media";
import type { MediaMainTab } from "../model";
import { BrowserSessionsPanel } from "./BrowserSessionsPanel";
import { IconWidgetClose } from "./icons";
import { WindowsSessionsPanel } from "./WindowsSessionsPanel";

type Props = {
  mainTab: MediaMainTab;
  onMainTabChange: (t: MediaMainTab) => void;
  error: string | null;
  pendingKeys: Set<string>;
  browsers: DetectedBrowser[];
  browserAudio: Readonly<Record<string, AudioSessionInfoDto>>;
  sessions: MediaSessionDto[];
  onPlayPauseBrowser: (tab: BrowserTab, browserId: string) => void;
  onFocusBrowserTab: (tab: BrowserTab, browserId: string, displayName: string) => void | Promise<void>;
  onReloadBrowserTab: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onCloseBrowserTab: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onReactivateBrowserTab: (tab: BrowserTab, browserId: string) => void | Promise<void>;
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
  browsers,
  browserAudio,
  sessions,
  onPlayPauseBrowser,
  onFocusBrowserTab,
  onReloadBrowserTab,
  onCloseBrowserTab,
  onReactivateBrowserTab,
  onToggleWinSession,
  onMixerVolume,
  onOpenFullWindow,
  onDismissWidget,
}: Props) {
  return (
    <div className="pilpod-widget-panel-root">
      <button
        type="button"
        className="pilpod-widget-panel-root__dismiss"
        title="Turn off floating widget — minimize to taskbar"
        aria-label="Turn off floating widget and minimize to taskbar"
        onClick={() => void onDismissWidget()}
      >
        <IconWidgetClose className="pilpod-widget-panel-root__dismiss-icon" />
      </button>

      <div className="pilpod-widget-panel-card">
        <div className="pilpod-widget-panel-toolbar">
          <div className="pilpod-widget-panel-tabs">
            <button
              type="button"
              className={
                mainTab === "browser"
                  ? "pilpod-widget-panel-tabs__btn pilpod-widget-panel-tabs__btn--active"
                  : "pilpod-widget-panel-tabs__btn"
              }
              onClick={() => onMainTabChange("browser")}
            >
              Browser
            </button>
            <button
              type="button"
              className={
                mainTab === "windows"
                  ? "pilpod-widget-panel-tabs__btn pilpod-widget-panel-tabs__btn--active"
                  : "pilpod-widget-panel-tabs__btn"
              }
              onClick={() => onMainTabChange("windows")}
            >
              Windows
            </button>
          </div>
          <button
            type="button"
            className="pilpod-widget-panel-full"
            title="Open full PilPod window"
            onClick={() => void onOpenFullWindow()}
          >
            Full
          </button>
        </div>

        <div className="pilpod-widget-panel-scroll">
          {error ? (
            <div className="pilpod-alert-error">{error}</div>
          ) : null}

          {mainTab === "browser" ? (
            <BrowserSessionsPanel
              browsers={browsers}
              pendingKeys={pendingKeys}
              browserAudio={browserAudio}
              onPlayPause={onPlayPauseBrowser}
              onFocusTab={onFocusBrowserTab}
              onReload={onReloadBrowserTab}
              onClose={onCloseBrowserTab}
              onReactivate={onReactivateBrowserTab}
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
