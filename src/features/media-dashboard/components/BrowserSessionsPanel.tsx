import "./BrowserSessionsPanel.css";
import type { BrowserTabMediaDto, AudioSessionInfoDto } from "../../../types/media";
import { browserGroupLabel, browserRowKey } from "../lib/browserMedia";
import { AppVolumeSlider } from "./AppVolumeSlider";
import { BrowserTabRow } from "./BrowserTabRow";

type Props = {
  groups: readonly (readonly [string, BrowserTabMediaDto[]])[];
  pendingKeys: ReadonlySet<string>;
  browserAudio: Readonly<Record<string, AudioSessionInfoDto>>;
  onPlayPauseBrowser: (t: BrowserTabMediaDto) => void;
  onFocusBrowserTab: (t: BrowserTabMediaDto) => void;
  onMixerVolume: (instanceId: string, volume: number) => void;
};

export function BrowserSessionsPanel({
  groups,
  pendingKeys,
  browserAudio,
  onPlayPauseBrowser,
  onFocusBrowserTab,
  onMixerVolume,
}: Props) {
  return (
    <section role="tabpanel" id="panel-browser" aria-labelledby="tab-browser">
      {groups.length === 0 ? (
        <p className="pilpod-browser-panel__empty">
          No browser tabs. Install the companion extension and play media in
          Chromium.
        </p>
      ) : (
        <div className="pilpod-browser-panel__groups">
          {groups.map(([browserId, tabs]) => {
            const profileAudio = browserAudio[browserId];
            return (
              <div key={browserId} className="pilpod-browser-profile">
                <header className="pilpod-browser-profile__head">
                  <span className="pilpod-browser-profile__label">
                    {browserGroupLabel(browserId, tabs)}
                  </span>
                  {profileAudio ? (
                    <AppVolumeSlider
                      ariaLabel={`Volume for ${browserGroupLabel(browserId, tabs)}`}
                      audio={profileAudio}
                      onVolumeChange={onMixerVolume}
                    />
                  ) : null}
                </header>
                <ul className="pilpod-browser-profile__list">
                  {tabs.map((t) => {
                    const rk = browserRowKey(t);
                    return (
                      <BrowserTabRow
                        key={rk}
                        tab={t}
                        busy={pendingKeys.has(rk)}
                        onPlayPause={onPlayPauseBrowser}
                        onFocusTab={onFocusBrowserTab}
                      />
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
