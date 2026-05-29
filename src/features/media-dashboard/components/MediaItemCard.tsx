import "./MediaItemCard.css";
import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
} from "react";
import type { AudioSessionInfoDto, BrowserTab } from "../../../types/media";
import type { DownloadTask } from "../../downloader/types";
import {
  downloadProgressLabel,
  downloadProgressTitle,
} from "../../downloader/lib/activeDownload";
import {
  isTabPlaying,
  tabHasMediaControls,
  mediaArtist,
  formatDuration,
  faviconFromUrl,
} from "../lib/browserMedia";
import {
  IconChevronsRight,
  IconDownload,
  IconOpenInTab,
  IconPause,
  IconPlay,
  IconReload,
  IconVolume,
  IconVolumeMuted,
  IconX,
  Spinner,
} from "../../../shared/ui/icons";

const VOL_SLIDER_MAX = 600;
const MENU_CLOSE_DELAY_MS = 1500;
const CONFIRM_RESET_MS = 2800;

type Props = {
  tab: BrowserTab;
  browserId: string;
  browserDisplayName: string;
  busy: boolean;
  profileAudio?: AudioSessionInfoDto;
  onMixerVolume?: (instanceId: string, volume: number) => void;
  onPlayPause: (tab: BrowserTab, browserId: string) => void;
  onFocus: (tab: BrowserTab, browserId: string, displayName: string) => void | Promise<void>;
  onReload: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onClose: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onDownload?: (url: string) => void;
  activeDownload?: DownloadTask;
};

function getStateBadgeClass(tabState?: string): string {
  const ts = (tabState ?? "").toLowerCase();
  if (ts === "sleeping" || ts === "crashed") return "sleep";
  if (ts === "inactive") return "inactive";
  if (ts === "loading") return "inactive";
  return "active";
}

function getStateBadgeLabel(tabState?: string, playing?: boolean): string {
  const ts = (tabState ?? "").toLowerCase();
  if (playing) return "playing";
  if (ts === "sleeping") return "sleep";
  if (ts === "crashed") return "crashed";
  if (ts === "inactive") return "inactive";
  if (ts === "loading") return "loading";
  return "active";
}

function volumeSliderValue(audio: AudioSessionInfoDto | undefined, muted: boolean): number {
  if (!audio || muted || audio.muted) return 0;
  return Math.round(audio.volume * 100);
}

function volFillTone(value: number): "muted" | "normal" | "boost" | "high" {
  if (value === 0) return "muted";
  if (value > 200) return "high";
  if (value > 100) return "boost";
  return "normal";
}

export function MediaItemCard({
  tab,
  browserId,
  browserDisplayName,
  busy,
  profileAudio,
  onMixerVolume,
  onPlayPause,
  onFocus,
  onReload,
  onClose,
  onDownload,
  activeDownload,
}: Props) {
  const playing = isTabPlaying(tab);
  const hasMediaControls = tabHasMediaControls(tab);
  const artist = tab.media ? mediaArtist(tab.media) : null;

  const [menuOpen, setMenuOpen] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [muted, setMuted] = useState(false);
  const [reloadSpin, setReloadSpin] = useState(false);
  const [volLayout, setVolLayout] = useState({ fillPx: 0, thumbPx: 0 });

  const prevVolRef = useRef(1);
  const menuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volTrackRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const expandRef = useRef<HTMLDivElement>(null);

  const volumeValue = volumeSliderValue(profileAudio, muted);

  const duration = tab.media?.duration ?? 0;
  const currentTime = tab.media?.currentTime ?? 0;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const durationLabel = duration > 0 ? formatDuration(duration) : null;

  const art = tab.media?.artworkUrl?.trim() ?? "";
  const fav = faviconFromUrl(tab.url);
  const letter = (tab.title?.trim() || "?").slice(0, 1).toUpperCase();

  const badgeState = getStateBadgeClass(tab.tabState);
  const badgeLabel = getStateBadgeLabel(tab.tabState, playing);
  const volTone = volFillTone(volumeValue);

  const updateVolLayout = useCallback(() => {
    const track = volTrackRef.current;
    if (!track) return;
    const w = track.offsetWidth;
    const pct = volumeValue / VOL_SLIDER_MAX;
    const px = pct * w;
    setVolLayout({ fillPx: px, thumbPx: px });
  }, [volumeValue]);

  useLayoutEffect(() => {
    updateVolLayout();
  }, [updateVolLayout]);

  useEffect(() => {
    const track = volTrackRef.current;
    if (!track) return;
    const ro = new ResizeObserver(() => updateVolLayout());
    ro.observe(track);
    return () => ro.disconnect();
  }, [updateVolLayout]);

  useEffect(() => {
    if (profileAudio && !profileAudio.muted) {
      setMuted(false);
    }
  }, [profileAudio?.muted, profileAudio?.volume]);

  useEffect(() => {
    return () => {
      if (menuCloseTimerRef.current) clearTimeout(menuCloseTimerRef.current);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const cancelMenuClose = useCallback(() => {
    if (menuCloseTimerRef.current) {
      clearTimeout(menuCloseTimerRef.current);
      menuCloseTimerRef.current = null;
    }
  }, []);

  const closeMenu = useCallback(() => {
    cancelMenuClose();
    setMenuOpen(false);
    setCloseConfirm(false);
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, [cancelMenuClose]);

  const scheduleMenuClose = useCallback(() => {
    cancelMenuClose();
    menuCloseTimerRef.current = setTimeout(() => {
      menuCloseTimerRef.current = null;
      setMenuOpen(false);
      setCloseConfirm(false);
    }, MENU_CLOSE_DELAY_MS);
  }, [cancelMenuClose]);

  const openMenu = useCallback(() => {
    cancelMenuClose();
    setMenuOpen(true);
  }, [cancelMenuClose]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (expandRef.current?.contains(target)) return;
      cancelMenuClose();
      setMenuOpen(false);
      setCloseConfirm(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [menuOpen, cancelMenuClose]);

  const handleToggleMenu = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      cancelMenuClose();
      if (menuOpen) {
        closeMenu();
      } else {
        openMenu();
      }
    },
    [menuOpen, cancelMenuClose, closeMenu, openMenu],
  );

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!onMixerVolume || !profileAudio) return;
      const val = parseInt(e.target.value, 10);
      setMuted(false);
      onMixerVolume(profileAudio.instanceId, val / 100);
    },
    [onMixerVolume, profileAudio],
  );

  const handleToggleMute = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!onMixerVolume || !profileAudio) return;
      if (!muted && !profileAudio.muted) {
        prevVolRef.current = profileAudio.volume;
        onMixerVolume(profileAudio.instanceId, 0);
        setMuted(true);
      } else {
        onMixerVolume(profileAudio.instanceId, prevVolRef.current);
        setMuted(false);
      }
    },
    [muted, onMixerVolume, profileAudio],
  );

  const handleDownload = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      cancelMenuClose();
      if (onDownload && tab.url) {
        onDownload(tab.url);
      }
    },
    [onDownload, tab.url, cancelMenuClose],
  );

  const handleReload = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      cancelMenuClose();
      setReloadSpin(true);
      void onReload(tab, browserId);
      window.setTimeout(() => setReloadSpin(false), 520);
    },
    [onReload, tab, browserId, cancelMenuClose],
  );

  const resetCloseConfirm = useCallback(() => {
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    setCloseConfirm(false);
  }, []);

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      cancelMenuClose();
      if (!closeConfirm) {
        setCloseConfirm(true);
        confirmTimerRef.current = setTimeout(() => {
          confirmTimerRef.current = null;
          setCloseConfirm(false);
        }, CONFIRM_RESET_MS);
      } else {
        resetCloseConfirm();
        void onClose(tab, browserId);
      }
    },
    [closeConfirm, onClose, tab, browserId, cancelMenuClose, resetCloseConfirm],
  );

  const volFillClass = [
    "pilpod-media-item__vol-fill",
    volTone !== "normal" ? `pilpod-media-item__vol-fill--${volTone}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const volPctClass = [
    "pilpod-media-item__vol-pct",
    volTone !== "normal" ? `pilpod-media-item__vol-pct--${volTone}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const cardClass = [
    "pilpod-media-item",
    playing ? "pilpod-media-item--playing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const bodyClass = [
    "pilpod-media-item__body",
    menuOpen ? "pilpod-media-item__body--menu-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const expandClass = [
    "pilpod-media-item__expand-strip",
    menuOpen ? "pilpod-media-item__expand-strip--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const playBtnClass = [
    "pilpod-media-item__play-btn",
    playing ? "pilpod-media-item__play-btn--playing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const progressClass = [
    "pilpod-media-item__progress-fill",
    playing ? "pilpod-media-item__progress-fill--playing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={cardClass}>
      <div className="pilpod-media-item__thumb-wrap">
        {art ? (
          <img
            src={art}
            alt=""
            className="pilpod-media-item__thumb-img"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : fav ? (
          <img
            src={fav}
            alt=""
            className="pilpod-media-item__thumb-img pilpod-media-item__thumb-img--fav"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="pilpod-media-item__thumb-letter">{letter}</div>
        )}

        <div className="pilpod-media-item__thumb-overlay">
          <div
            className="pilpod-media-item__goto-area"
            onClick={(e) => {
              e.stopPropagation();
              void onFocus(tab, browserId, browserDisplayName);
            }}
          >
            <div className="pilpod-media-item__thumb-goto">
              <IconOpenInTab className="pilpod-media-item__thumb-goto-icon" />
            </div>
          </div>
          <div
            ref={expandRef}
            className={expandClass}
            onClick={handleToggleMenu}
            onMouseLeave={() => {
              if (menuOpen) scheduleMenuClose();
            }}
          >
            <IconChevronsRight className="pilpod-media-item__expand-icon" />
          </div>
        </div>

        {durationLabel ? (
          <div className="pilpod-media-item__thumb-duration">{durationLabel}</div>
        ) : null}
      </div>

      <div className={bodyClass}>
        <div className="pilpod-media-item__content">
          <div className="pilpod-media-item__title-row">
            <div className="pilpod-media-item__meta">
              <p className="pilpod-media-item__title" title={tab.title?.trim() || undefined}>
                {tab.title?.trim() || "Untitled"}
              </p>
              {artist ? (
                <p className="pilpod-media-item__channel">{artist}</p>
              ) : null}
            </div>
            <div
              className={`pilpod-media-item__state-badge pilpod-media-item__state-badge--${playing ? "active" : badgeState}`}
              title={`Tab state: ${badgeLabel}`}
            >
              <div className="pilpod-media-item__state-dot" />
              <span>{badgeLabel}</span>
            </div>
          </div>

          {profileAudio && onMixerVolume ? (
            <div className="pilpod-media-item__vol-row">
              <button
                type="button"
                className="pilpod-media-item__vol-icon-btn"
                onClick={handleToggleMute}
                title={muted || volumeValue === 0 ? "Unmute" : "Mute"}
                aria-label={muted || volumeValue === 0 ? "Unmute" : "Mute"}
              >
                {muted || volumeValue === 0 ? (
                  <IconVolumeMuted className="pilpod-media-item__vol-icon-svg" />
                ) : (
                  <IconVolume className="pilpod-media-item__vol-icon-svg" />
                )}
              </button>
              <div className="pilpod-media-item__vol-track" ref={volTrackRef}>
                <div className="pilpod-media-item__vol-rail" />
                <div
                  className={volFillClass}
                  style={{ width: `${volLayout.fillPx}px` }}
                />
                <div
                  className="pilpod-media-item__vol-thumb"
                  style={{ left: `${volLayout.thumbPx}px` }}
                />
                <input
                  type="range"
                  className="pilpod-media-item__vol-input"
                  min="0"
                  max={VOL_SLIDER_MAX}
                  value={volumeValue}
                  step="5"
                  onChange={handleVolumeChange}
                  aria-label={`Volume: ${volumeValue}%`}
                />
              </div>
              <span className={volPctClass}>{volumeValue}%</span>
            </div>
          ) : null}
        </div>

        <div
          ref={menuRef}
          className={`pilpod-media-item__body-menu${menuOpen ? " pilpod-media-item__body-menu--open" : ""}`}
          onMouseEnter={cancelMenuClose}
          onMouseLeave={scheduleMenuClose}
        >
          {activeDownload ? (
            <span
              className="pilpod-media-item__menu-act pilpod-media-item__menu-act--dl-status"
              title={downloadProgressTitle(activeDownload)}
            >
              {(activeDownload.status.type === "Queued" ||
                activeDownload.status.type === "Muxing" ||
                activeDownload.status.type === "FetchingInfo") && (
                <Spinner className="pilpod-icon--sm" />
              )}
              <span className="pilpod-media-item__dl-label">
                {downloadProgressLabel(activeDownload)}
              </span>
            </span>
          ) : onDownload && tab.url ? (
            <button
              type="button"
              className="pilpod-media-item__menu-act pilpod-media-item__menu-act--dl"
              onClick={handleDownload}
              title="Download"
              aria-label="Download"
            >
              <IconDownload />
            </button>
          ) : null}
          <button
            type="button"
            className="pilpod-media-item__menu-act pilpod-media-item__menu-act--rl"
            onClick={handleReload}
            title="Reload"
            aria-label="Reload"
          >
            <IconReload
              className={reloadSpin ? "pilpod-media-item__menu-act-icon--spin" : undefined}
            />
          </button>
          <button
            type="button"
            className={`pilpod-media-item__menu-act pilpod-media-item__menu-act--cl${closeConfirm ? " pilpod-media-item__menu-act--cl-confirm" : ""}`}
            onClick={handleClose}
            title={closeConfirm ? "Click again to close" : "Close tab"}
            aria-label="Close tab"
          >
            <IconX />
          </button>
        </div>
      </div>

      {hasMediaControls ? (
        <button
          type="button"
          className={playBtnClass}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onPlayPause(tab, browserId);
          }}
          title={playing ? "Pause" : "Play"}
          aria-label={playing ? "Pause" : "Play"}
        >
          {busy ? (
            <Spinner />
          ) : playing ? (
            <IconPause className="pilpod-icon--sm" />
          ) : (
            <IconPlay className="pilpod-icon--sm" />
          )}
        </button>
      ) : null}

      <div className="pilpod-media-item__progress-bar">
        <div className={progressClass} style={{ width: `${progress}%` }} />
      </div>
    </li>
  );
}
