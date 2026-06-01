import "./WidgetMediaPanel.css";
import type { AudioSessionInfoDto, BrowserTab, DetectedBrowser } from "../../../types/media";
import { BrowserSessionsPanel } from "./BrowserSessionsPanel";
import { IconWidgetClose } from "../../../shared/ui/icons";

type Props = {
  error: string | null;
  browserPendingKeys: ReadonlySet<string>;
  browsers: DetectedBrowser[];
  browserAudio: Readonly<Record<string, AudioSessionInfoDto>>;
  onPlayPauseBrowser: (tab: BrowserTab, browserId: string) => void;
  onFocusBrowserTab: (tab: BrowserTab, browserId: string, displayName: string) => void | Promise<void>;
  onReloadBrowserTab: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onCloseBrowserTab: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onReactivateBrowserTab: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onRefreshBrowser: (browserId: string) => void | Promise<void>;
  onMixerVolume: (instanceId: string, volume: number) => void;
  onOpenFullWindow: () => void;
  onDismissWidget: () => void;
};

export function WidgetMediaPanel({
  error,
  browserPendingKeys,
  browsers,
  browserAudio,
  onPlayPauseBrowser,
  onFocusBrowserTab,
  onReloadBrowserTab,
  onCloseBrowserTab,
  onReactivateBrowserTab,
  onRefreshBrowser,
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

          <BrowserSessionsPanel
            browsers={browsers}
            pendingKeys={browserPendingKeys}
            browserAudio={browserAudio}
            onPlayPause={onPlayPauseBrowser}
            onFocusTab={onFocusBrowserTab}
            onReload={onReloadBrowserTab}
            onClose={onCloseBrowserTab}
            onReactivate={onReactivateBrowserTab}
            onRefreshBrowser={(id) => void onRefreshBrowser(id)}
            onMixerVolume={(id, v) => void onMixerVolume(id, v)}
          />
        </div>
      </div>
    </div>
  );
}
