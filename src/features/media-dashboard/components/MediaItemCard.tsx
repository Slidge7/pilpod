import "./MediaItemCard.css";
import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BrowserTab } from "../../../types/media";
import {
  isTabPlaying,
  tabHasMediaControls,
  mediaArtist,
  formatDuration,
  faviconFromUrl,
} from "../lib/browserMedia";
import {
  IconOpenInTab,
  IconPause,
  IconPip,
  IconPlay,
  IconReload,
  IconSkipBack,
  IconSkipForward,
  IconVolume,
  IconVolumeMuted,
  IconX,
  Spinner,
} from "../../../shared/ui/icons";
import { useTabCloseConfirm } from "../hooks/useTabCloseConfirm";

const TAB_VOL_MAX = 600;
/** Number of discrete steps the native range input is divided into. */
const VOL_TRACK_STEPS = 1000;

/**
 * Non-linear volume mapping (matches the new companion UI):
 * the first half of the slider width covers 0–100%,
 * the second half covers 100–TAB_VOL_MAX%.
 */
function volumeToTrackFraction(v: number): number {
  const vol = Math.min(TAB_VOL_MAX, Math.max(0, v));
  if (vol <= 100) return (vol / 100) * 0.5;
  return 0.5 + ((vol - 100) / (TAB_VOL_MAX - 100)) * 0.5;
}
function trackFractionToVolume(f: number): number {
  const t = Math.min(1, Math.max(0, f));
  const raw =
    t <= 0.5
      ? (t / 0.5) * 100
      : 100 + ((t - 0.5) / 0.5) * (TAB_VOL_MAX - 100);
  return Math.round(raw / 5) * 5;
}

type Props = {
  tab: BrowserTab;
  browserId: string;
  browserDisplayName: string;
  variant?: "float" | "inset";
  rootClassName?: string;
  flipId?: string;
  busy: boolean;
  onPlayPause: (tab: BrowserTab, browserId: string) => void;
  onFocus: (tab: BrowserTab, browserId: string, displayName: string) => void | Promise<void>;
  onReload: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onClose: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onSeek?: (tab: BrowserTab, browserId: string, seekTo: number) => void;
  onSetTabVolume?: (tab: BrowserTab, browserId: string, volume: number) => void;
  onPip?: (tab: BrowserTab, browserId: string) => void;
  /** Optional accessory buttons rendered right of PiP in the transport row. */
  saveButton?: ReactNode;
  downloadButton?: ReactNode;
  /**
   * Hide the in-tab previous/next (media-session) buttons. Used by the
   * playlist player card, whose wrapper owns track navigation.
   */
  hideTrackTransport?: boolean;
  /**
   * Hide the reload/close tab buttons. Used by the playlist player card —
   * the tab's lifecycle belongs to the playlist session there (stop closes it).
   */
  hideTabActions?: boolean;
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
  variant = "float",
  rootClassName,
  flipId,
  busy,
  onPlayPause,
  onFocus,
  onReload,
  onClose,
  onSeek,
  onSetTabVolume,
  onPip,
  saveButton,
  downloadButton,
  hideTrackTransport = false,
  hideTabActions = false,
}: Props) {
  const playing = isTabPlaying(tab);
  const hasMediaControls = tabHasMediaControls(tab);
  const artist = tab.media ? mediaArtist(tab.media) : null;

  const tabVolume = tab.media?.tabVolume ?? 100;
  const tabMuted = tab.media?.tabMuted ?? false;

  // Per-tab control capabilities advertised by the extension. next/prev/pip
  // default OFF (only shown when the site actually supports them); seek defaults
  // ON so tabs from any path that omits the flag keep their scrubber.
  const canNext = tab.media?.canNext ?? false;
  const canPrev = tab.media?.canPrev ?? false;
  const canPip = tab.media?.canPip ?? false;
  const canSeek = tab.media?.canSeek ?? true;

  const [reloadSpin, setReloadSpin] = useState(false);
  const [localTabVol, setLocalTabVol] = useState(tabVolume);
  const [localTabMuted, setLocalTabMuted] = useState(tabMuted);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  // Real PiP state reported by the extension — the button is a true toggle, not
  // an optimistic guess.
  const pipActive = tab.media?.inPip ?? false;

  const seekWrapRef = useRef<HTMLDivElement>(null);

  const duration = tab.media?.duration ?? 0;
  const currentTime = tab.media?.currentTime ?? 0;
  const displayTime = seekPreview !== null ? seekPreview : currentTime;
  const displayProgress = duration > 0 ? (displayTime / duration) * 100 : 0;
  const durationLabel = duration > 0 ? formatDuration(duration) : null;
  const currentTimeLabel = duration > 0 ? formatDuration(displayTime) : null;

  const art = tab.media?.artworkUrl?.trim() ?? "";
  const fav = faviconFromUrl(tab.url);
  const letter = (tab.title?.trim() || "?").slice(0, 1).toUpperCase();

  const badgeState = getStateBadgeClass(tab.tabState);
  const badgeLabel = getStateBadgeLabel(tab.tabState, playing);

  useEffect(() => {
    if (!isSeeking) {
      setLocalTabVol(tab.media?.tabVolume ?? 100);
      setLocalTabMuted(tab.media?.tabMuted ?? false);
    }
  }, [tab.media?.tabVolume, tab.media?.tabMuted, isSeeking]);

  const effectiveTabVol = localTabMuted ? 0 : localTabVol;
  const volTone = volFillTone(effectiveTabVol);
  const volFraction = volumeToTrackFraction(effectiveTabVol);
  const volTrackValue = Math.round(volFraction * VOL_TRACK_STEPS);

  const { closeConfirm, handleClose, closeTitle, resetCloseConfirm } = useTabCloseConfirm({
    onClose: () => void onClose(tab, browserId),
    onBeforeInteract: () => {},
  });

  useEffect(() => {
    return () => resetCloseConfirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Interaction Handlers ──────────────────────────────────────────────────

  const handleTabVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = parseInt(e.target.value, 10);
      const vol = trackFractionToVolume(raw / VOL_TRACK_STEPS);
      setLocalTabMuted(vol === 0);
      setLocalTabVol(vol);
      onSetTabVolume?.(tab, browserId, vol);
    },
    [onSetTabVolume, tab, browserId],
  );

  const handleToggleTabMute = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (localTabMuted) {
        setLocalTabMuted(false);
        onSetTabVolume?.(tab, browserId, localTabVol || 100);
      } else {
        setLocalTabMuted(true);
        onSetTabVolume?.(tab, browserId, 0);
      }
    },
    [localTabMuted, localTabVol, onSetTabVolume, tab, browserId],
  );

  const computeSeekTime = useCallback((clientX: number): number => {
    const zone = seekWrapRef.current;
    if (!zone || !duration) return 0;
    const rect = zone.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return pct * duration;
  }, [duration]);

  const handleSeekPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!duration || !onSeek) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsSeeking(true);
    setSeekPreview(computeSeekTime(e.clientX));
  }, [duration, onSeek, computeSeekTime]);

  const handleSeekPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isSeeking || !duration) return;
    setSeekPreview(computeSeekTime(e.clientX));
  }, [isSeeking, duration, computeSeekTime]);

  const handleSeekPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isSeeking) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ok */ }
    const t = computeSeekTime(e.clientX);
    setSeekPreview(null);
    setIsSeeking(false);
    if (duration && onSeek) onSeek(tab, browserId, t);
  }, [isSeeking, duration, onSeek, tab, browserId, computeSeekTime]);

  const handlePrevious = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void invoke("browser_media_control", { browserId, tabId: tab.tabId, action: "previous" });
  }, [browserId, tab.tabId]);

  const handleNext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void invoke("browser_media_control", { browserId, tabId: tab.tabId, action: "next" });
  }, [browserId, tab.tabId]);

  const handleReload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setReloadSpin(true);
    void onReload(tab, browserId);
    window.setTimeout(() => setReloadSpin(false), 520);
  }, [onReload, tab, browserId]);

  const handlePip = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onPip?.(tab, browserId);
  }, [onPip, tab, browserId]);

  // ── CSS Class Combinations ────────────────────────────────────────────────

  const cardClass = [
    "pilpod-media-item",
    variant === "float" ? "pilpod-media-item--float" : "pilpod-media-item--inset",
    playing ? "pilpod-media-item--playing" : "",
  ].filter(Boolean).join(" ");

  const playBtnClass = [
    "pilpod-media-item__play-btn",
    playing ? "pilpod-media-item__play-btn--playing" : "",
  ].filter(Boolean).join(" ");

  const progressClass = [
    "pilpod-media-item__seek-fill",
    playing ? "pilpod-media-item__seek-fill--playing" : "",
  ].filter(Boolean).join(" ");

  const volTrackClass = [
    "pilpod-media-item__vol-track",
    volTone !== "normal" ? `pilpod-media-item__vol-track--${volTone}` : "",
  ].filter(Boolean).join(" ");

  const volPctClass = [
    "pilpod-media-item__vol-pct",
    volTone !== "normal" ? `pilpod-media-item__vol-pct--${volTone}` : "",
  ].filter(Boolean).join(" ");

  const hasTabVol = tab.media != null && onSetTabVolume != null;
  const seekActive = duration > 0 && onSeek != null && canSeek;

  return (
    <li
      className={[
        "pilpod-media-item-wrapper",
        rootClassName || "",
      ].filter(Boolean).join(" ")}
      {...(flipId ? { "data-flip-id": flipId } : {})}
    >
      <div className={cardClass}>

        {/* ── THUMBNAIL (square) ── */}
        <div className="pilpod-media-item__thumb-wrap">
          {art ? (
            <img src={art} alt="" className="pilpod-media-item__thumb-img"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : fav ? (
            <img src={fav} alt="" className="pilpod-media-item__thumb-img pilpod-media-item__thumb-img--fav"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div className="pilpod-media-item__thumb-letter">{letter}</div>
          )}

          {/* Go-to-tab overlay (reveals on thumbnail hover) */}
          <div className="pilpod-media-item__thumb-overlay">
            <button
              type="button"
              className="pilpod-media-item__goto-btn"
              onClick={(e) => { e.stopPropagation(); void onFocus(tab, browserId, browserDisplayName); }}
              title="Go to tab"
              aria-label="Go to tab"
            >
              <IconOpenInTab className="pilpod-media-item__goto-icon" />
            </button>
          </div>

          {/* Current time + duration, split across the thumbnail bottom */}
          {durationLabel ? (
            <div className="pilpod-media-item__thumb-time">
              <span className="pilpod-media-item__thumb-time-current">
                {currentTimeLabel ?? "0:00"}
              </span>
              <span className="pilpod-media-item__thumb-time-duration">
                {durationLabel}
              </span>
            </div>
          ) : null}
        </div>

        {/* ── CONTENT ── */}
        <div className="pilpod-media-item__content">

          {/* row 1: title + state badge + reload + close */}
          <div className="pilpod-media-item__row1">
            <p className="pilpod-media-item__title" title={tab.title?.trim() || undefined}>
              {tab.title?.trim() || "Untitled"}
            </p>
            <div className="pilpod-media-item__row1-actions">
              <div
                className={`pilpod-media-item__state-badge pilpod-media-item__state-badge--${playing ? "active" : badgeState}`}
                title={`Tab state: ${badgeLabel}${artist ? ` · ${artist}` : ""}`}
              >
                <div className="pilpod-media-item__state-dot" />
                <span>{badgeLabel}</span>
              </div>
              {!hideTabActions ? (
                <>
                  <button
                    type="button"
                    className="pilpod-media-item__icon-btn"
                    onClick={handleReload}
                    title="Reload"
                    aria-label="Reload"
                  >
                    <IconReload className={reloadSpin ? "pilpod-media-item__icon--spin" : undefined} />
                  </button>
                  <button
                    type="button"
                    className={`pilpod-media-item__icon-btn pilpod-media-item__icon-btn--danger${closeConfirm ? " pilpod-media-item__icon-btn--confirm" : ""}`}
                    onClick={handleClose}
                    title={closeTitle}
                    aria-label="Close tab"
                  >
                    <IconX />
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {/* row 2: volume block + transport (prev/next/pip) + play */}
          <div className="pilpod-media-item__row2">
            {hasTabVol ? (
              <div className="pilpod-media-item__vol-block">
                <button
                  type="button"
                  className="pilpod-media-item__vol-icon-btn"
                  onClick={handleToggleTabMute}
                  title={localTabMuted || effectiveTabVol === 0 ? "Unmute tab" : "Mute tab"}
                  aria-label={localTabMuted || effectiveTabVol === 0 ? "Unmute tab" : "Mute tab"}
                >
                  {localTabMuted || effectiveTabVol === 0
                    ? <IconVolumeMuted className="pilpod-media-item__vol-icon-svg" />
                    : <IconVolume className="pilpod-media-item__vol-icon-svg" />}
                </button>
                <span className="pilpod-media-item__vol-slider-wrap">
                  <input
                    type="range"
                    className={volTrackClass}
                    min={0}
                    max={VOL_TRACK_STEPS}
                    value={volTrackValue}
                    step={1}
                    style={{ "--vol-pct": `${volFraction * 100}%` } as React.CSSProperties}
                    onChange={handleTabVolumeChange}
                    aria-label={`Tab volume: ${effectiveTabVol}%`}
                    aria-valuemin={0}
                    aria-valuemax={TAB_VOL_MAX}
                    aria-valuenow={effectiveTabVol}
                  />
                </span>
                <span className={volPctClass}>
                  {localTabMuted ? "mute" : `${effectiveTabVol}%`}
                </span>
              </div>
            ) : null}

            <div className="pilpod-media-item__transport">
              {tab.media && canPrev && !hideTrackTransport ? (
                <button
                  type="button"
                  className="pilpod-media-item__icon-btn pilpod-media-item__transport-btn"
                  onClick={handlePrevious}
                  title="Previous"
                  aria-label="Previous track"
                >
                  <IconSkipBack />
                </button>
              ) : null}
              {tab.media && canNext && !hideTrackTransport ? (
                <button
                  type="button"
                  className="pilpod-media-item__icon-btn pilpod-media-item__transport-btn"
                  onClick={handleNext}
                  title="Next"
                  aria-label="Next track"
                >
                  <IconSkipForward />
                </button>
              ) : null}
              {onPip && canPip ? (
                <button
                  type="button"
                  className={`pilpod-media-item__icon-btn pilpod-media-item__transport-btn pilpod-media-item__pip-btn${pipActive ? " pilpod-media-item__pip-btn--active" : ""}`}
                  onClick={handlePip}
                  title={pipActive ? "Exit Picture-in-Picture" : "Picture in Picture"}
                  aria-label={pipActive ? "Exit Picture-in-Picture" : "Picture in Picture"}
                  aria-pressed={pipActive}
                >
                  <IconPip />
                </button>
              ) : null}
              {saveButton}
              {downloadButton}
            </div>

            {hasMediaControls ? (
              <button
                type="button"
                className={playBtnClass}
                disabled={busy}
                onClick={(e) => { e.stopPropagation(); onPlayPause(tab, browserId); }}
                title={playing ? "Pause" : "Play"}
                aria-label={playing ? "Pause" : "Play"}
              >
                {busy ? <Spinner /> : playing
                  ? <IconPause className="pilpod-icon--sm" />
                  : <IconPlay className="pilpod-icon--sm" />}
              </button>
            ) : null}
          </div>
        </div>

        {/* ── FULL-WIDTH SEEKBAR (spans thumbnail + content) ── */}
        <div
          ref={seekWrapRef}
          className={`pilpod-media-item__seek-wrap${seekActive ? " pilpod-media-item__seek-wrap--active" : ""}${isSeeking ? " pilpod-media-item__seek-wrap--dragging" : ""}`}
          onPointerDown={seekActive ? handleSeekPointerDown : undefined}
          onPointerMove={seekActive ? handleSeekPointerMove : undefined}
          onPointerUp={seekActive ? handleSeekPointerUp : undefined}
          onPointerCancel={seekActive ? handleSeekPointerUp : undefined}
        >
          <div className="pilpod-media-item__seek-track">
            <div className={progressClass} style={{ width: `${displayProgress}%` }} />
          </div>
        </div>
      </div>
    </li>
  );
}
