import { useEffect, useState } from "react";
import type { BrowserTab } from "../../../types/media";
import {
  isTabPlaying,
  mediaArtist,
  tabHasMediaControls,
} from "../../media-dashboard";
import {
  TAB_VOL_MAX,
  VOL_TRACK_STEPS,
  trackFractionToVolume,
  volFillTone,
  volumeToTrackFraction,
} from "../../../shared/ui/volumeScale";
import {
  IconCheck,
  IconOpenInTab,
  IconPause,
  IconPip,
  IconPlay,
  IconReload,
  IconSeekBack10,
  IconSeekForward10,
  IconSkipBack,
  IconSkipForward,
  IconVolume,
  IconVolumeMuted,
  IconX,
} from "../../../shared/ui/icons";
import { useLiveBrowsers } from "../data/SkyData";
import { hostOf } from "../search/lib/text";
import { Thumb } from "../ui/Thumb";
import { useConfirm } from "../ui/useConfirm";
import { useThrottled } from "../ui/useThrottled";
import { clock, isSeekable, seekBy } from "./lib/controls";
import { useLiveTab } from "./useCaptureBrowser";

const SKIP_SECONDS = 10;
/** Volume commands while dragging: at most one per this many ms. */
const VOLUME_THROTTLE_MS = 60;

/**
 * Everything PilPod can do to one tab, in one panel: position, transport,
 * volume (to 150%), picture-in-picture, and the tab itself (show, reload,
 * wake, copy, close). Reads the tab live from the browser stream, so values
 * move while it is open.
 */
export function TabControlPanel({
  tab: initialTab,
  browserId,
  browserName,
  onDone,
}: {
  tab: BrowserTab;
  browserId: string;
  browserName: string;
  /** Called after an action that leaves the panel pointless (show, close). */
  onDone: () => void;
}) {
  const live = useLiveTab(browserId, initialTab.tabId);
  const tab = live ?? initialTab;
  const gone = live === null;
  const { controls } = useLiveBrowsers();

  const media = tab.media ?? null;
  const controllable = tabHasMediaControls(tab);
  const playing = isTabPlaying(tab);
  const muted = tab.muted === true || media?.tabMuted === true;
  const duration = media?.duration ?? 0;
  const seekable = controllable && isSeekable(duration, media?.canSeek);
  const host = hostOf(tab.url) ?? tab.url;
  const title = tab.title?.trim() || media?.title?.trim() || host;
  const artist = media ? mediaArtist(media) : null;
  const sleeping = (tab.tabState ?? "").toLowerCase() === "sleeping";

  // ── Position: follow the tab, except while the user drags. ───────────
  const [scrub, setScrub] = useState<number | null>(null);
  const position = scrub ?? media?.currentTime ?? 0;
  const commitSeek = (to: number) => {
    setScrub(null);
    controls.seekTab(tab, browserId, to);
  };

  // ── Volume: local while dragging, throttled commands. ────────────────
  const reported = media?.tabVolume ?? 100;
  const [volDraft, setVolDraft] = useState<number | null>(null);
  const volume = volDraft ?? reported;
  useEffect(() => {
    if (volDraft !== null && reported === volDraft) setVolDraft(null);
  }, [reported, volDraft]);
  const pushVolume = useThrottled(
    (v: number) => controls.setTabVolume(tab, browserId, v),
    VOLUME_THROTTLE_MS,
  );
  const sendVolume = (v: number) => {
    setVolDraft(v);
    pushVolume(v);
  };

  const [copied, setCopied] = useState(false);
  const close = useConfirm(() => {
    void controls.closeTab(tab, browserId);
    onDone();
  });

  return (
    <div className="sky-tabpanel">
      <header className="sky-tabpanel__head">
        <Thumb
          src={media?.artworkUrl}
          glyph={host.charAt(0).toUpperCase()}
          hueKey={host}
          kind="art"
          className="sky-tabpanel__art"
        />
        <div className="sky-tabpanel__titles">
          <p className="sky-tabpanel__title" title={title}>
            {title}
          </p>
          <p className="sky-tabpanel__meta">
            {[artist, host, browserName].filter(Boolean).join(" · ")}
          </p>
        </div>
      </header>

      {gone ? <p className="sky-tabpanel__gone">This tab was closed.</p> : null}

      {controllable && !gone ? (
        <section className="sky-tabpanel__player" aria-label="Playback">
          {seekable ? (
            <div className="sky-seek">
              <span className="sky-seek__time">{clock(position)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.floor(duration))}
                step={1}
                value={Math.min(position, duration)}
                aria-label="Position"
                aria-valuetext={`${clock(position)} of ${clock(duration)}`}
                onChange={(e) => setScrub(Number(e.target.value))}
                onPointerUp={(e) => commitSeek(Number(e.currentTarget.value))}
                onKeyUp={(e) => commitSeek(Number(e.currentTarget.value))}
              />
              <span className="sky-seek__time">{clock(duration)}</span>
            </div>
          ) : (
            <p className="sky-tabpanel__live-note">{duration ? null : "Live — no fixed length"}</p>
          )}

          <div className="sky-transport">
            <button
              type="button"
              className="sky-icon-btn sky-icon-btn--lg"
              disabled={!media?.canPrev}
              title="Previous track"
              aria-label="Previous track"
              onClick={() => controls.previousTrack(tab, browserId)}
            >
              <IconSkipBack />
            </button>
            <button
              type="button"
              className="sky-icon-btn sky-icon-btn--lg"
              disabled={!seekable}
              title={`Back ${SKIP_SECONDS} seconds`}
              aria-label={`Back ${SKIP_SECONDS} seconds`}
              onClick={() => commitSeek(seekBy(position, -SKIP_SECONDS, duration))}
            >
              <IconSeekBack10 />
            </button>
            <button
              type="button"
              className="sky-transport__play"
              title={playing ? "Pause" : "Play"}
              aria-label={playing ? "Pause" : "Play"}
              onClick={() => controls.toggleTab(tab, browserId)}
            >
              {playing ? <IconPause /> : <IconPlay />}
            </button>
            <button
              type="button"
              className="sky-icon-btn sky-icon-btn--lg"
              disabled={!seekable}
              title={`Forward ${SKIP_SECONDS} seconds`}
              aria-label={`Forward ${SKIP_SECONDS} seconds`}
              onClick={() => commitSeek(seekBy(position, SKIP_SECONDS, duration))}
            >
              <IconSeekForward10 />
            </button>
            <button
              type="button"
              className="sky-icon-btn sky-icon-btn--lg"
              disabled={!media?.canNext}
              title="Next track"
              aria-label="Next track"
              onClick={() => controls.nextTrack(tab, browserId)}
            >
              <IconSkipForward />
            </button>
            <button
              type="button"
              className="sky-icon-btn sky-icon-btn--lg"
              disabled={media?.canPip === false}
              aria-pressed={media?.inPip === true}
              title={media?.inPip ? "Leave picture-in-picture" : "Picture-in-picture"}
              aria-label="Picture-in-picture"
              onClick={() => controls.pip(tab, browserId)}
            >
              <IconPip />
            </button>
          </div>

          <div className="sky-volume" data-tone={muted ? "muted" : volFillTone(volume)}>
            <button
              type="button"
              className="sky-icon-btn"
              aria-pressed={muted}
              title={muted ? "Unmute tab" : "Mute tab"}
              aria-label={muted ? "Unmute tab" : "Mute tab"}
              onClick={() => controls.setTabMuted(tab, browserId, !muted)}
            >
              {muted ? <IconVolumeMuted /> : <IconVolume />}
            </button>
            <input
              type="range"
              min={0}
              max={VOL_TRACK_STEPS}
              step={1}
              value={Math.round(volumeToTrackFraction(volume) * VOL_TRACK_STEPS)}
              aria-label="Tab volume"
              aria-valuetext={`${volume}%`}
              style={{ "--sky-vol": `${volumeToTrackFraction(volume) * 100}%` } as React.CSSProperties}
              onChange={(e) => sendVolume(trackFractionToVolume(Number(e.target.value) / VOL_TRACK_STEPS))}
            />
            <output className="sky-volume__value">{volume}%</output>
            <button
              type="button"
              className="sky-textbtn"
              disabled={volume === 100}
              title={`Back to 100% (boost goes to ${TAB_VOL_MAX}%)`}
              onClick={() => {
                setVolDraft(100);
                controls.resetTabVolume(tab, browserId);
              }}
            >
              Reset
            </button>
          </div>
        </section>
      ) : null}

      <footer className="sky-tabpanel__actions">
        <button
          type="button"
          className="sky-btn"
          disabled={gone}
          onClick={() => {
            void controls.focusTab(tab, browserId, browserName);
            onDone();
          }}
        >
          <IconOpenInTab />
          Show tab
        </button>
        <button type="button" className="sky-btn" disabled={gone} onClick={() => void controls.reloadTab(tab, browserId)}>
          <IconReload />
          Reload
        </button>
        {sleeping ? (
          <button type="button" className="sky-btn" onClick={() => void controls.reactivateTab(tab, browserId)}>
            Wake
          </button>
        ) : null}
        <button
          type="button"
          className="sky-btn"
          onClick={() =>
            void navigator.clipboard
              .writeText(tab.url)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {copied ? <IconCheck /> : null}
          {copied ? "Copied" : "Copy link"}
        </button>
        <span className="sky-tabpanel__spacer" />
        <button
          type="button"
          className={`sky-btn sky-btn--danger${close.armed ? " is-armed" : ""}`}
          disabled={gone}
          onClick={close.press}
        >
          <IconX />
          {close.armed ? "Close it?" : "Close tab"}
        </button>
      </footer>
    </div>
  );
}
