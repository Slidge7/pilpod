import { useMemo } from "react";
import { BrowserSessionsPanel } from "../../media-dashboard/components/BrowserSessionsPanel";
import { useBrowsers } from "../../media-dashboard/hooks/useBrowsers";
import { useBrowserControls } from "../../media-dashboard/hooks/useBrowserControls";
import { IconWidgetClose } from "../../../shared/ui/icons";
import { widgetApi } from "../api";
import "./WidgetPanel.css";

type Props = {
  onCollapse: () => void;
  onDismiss: () => void;
};

/**
 * The expanded widget: the live media list, nothing else.
 *
 * This module is **code-split** ({@link ../WidgetApp} loads it with
 * `React.lazy`). The widget's whole value is being cheap enough to leave
 * running all day, and the tab list drags in the browser-session tree, the
 * media rows and their icons. Loading that on first expand rather than on
 * window creation keeps the idle widget to the chip and its state hook.
 *
 * The browser subscription lives here for the same reason: `useBrowsers`
 * attaches an event listener and pulls a snapshot, and a collapsed widget has
 * nothing to render it into.
 */
export function WidgetPanel({ onCollapse, onDismiss }: Props) {
  const { browsers, browserAudio } = useBrowsers();
  // No `onBeforeExternalFocus`: the dashboard drops its always-on-top before
  // raising a browser, but the widget must stay on top — un-pinning it here
  // would hide it behind the very window it just focused.
  const controls = useBrowserControls(browsers);

  const openFullWindow = useMemo(
    () => () => {
      void widgetApi.openMain();
      // Going to the full window is not the same as dismissing the widget:
      // collapse to the chip and leave it on screen.
      onCollapse();
    },
    [onCollapse],
  );

  return (
    <div className="pilpod-widget-panel-root">
      <button
        type="button"
        className="pilpod-widget-panel-root__dismiss"
        title="Turn off the floating widget"
        aria-label="Turn off the floating widget"
        onClick={onDismiss}
      >
        <IconWidgetClose className="pilpod-widget-panel-root__dismiss-icon" />
      </button>

      <div className="pilpod-widget-panel-card">
        <div className="pilpod-widget-panel-toolbar">
          <button
            type="button"
            className="pilpod-widget-panel-full"
            title="Open the full PilPod window"
            onClick={openFullWindow}
          >
            Full
          </button>
          <button
            type="button"
            className="pilpod-widget-panel-full"
            title="Back to the widget"
            aria-label="Collapse the widget"
            onClick={onCollapse}
          >
            Collapse
          </button>
        </div>

        <div className="pilpod-widget-panel-scroll">
          {controls.error ? (
            <div className="pilpod-alert-error">{controls.error}</div>
          ) : null}

          <BrowserSessionsPanel
            browsers={browsers}
            pendingKeys={controls.pendingKeys}
            browserAudio={browserAudio}
            onPlayPause={controls.toggleTab}
            onFocusTab={controls.focusTab}
            onReload={controls.reloadTab}
            onClose={controls.closeTab}
            onReactivate={controls.reactivateTab}
            onRefreshBrowser={(id) => void controls.refreshConnection(id)}
            onMixerVolume={(id, v) => void controls.setMixerVolume(id, v)}
            onSeekTab={controls.seekTab}
            onSetTabVolume={controls.setTabVolume}
            onPip={controls.pip}
          />
        </div>
      </div>
    </div>
  );
}

export default WidgetPanel;
