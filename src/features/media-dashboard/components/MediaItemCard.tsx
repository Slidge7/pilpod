import "./MediaItemCard.css";
import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BrowserTab } from "../../../types/media";
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
  IconDownload,
  IconOpenInTab,
  IconPause,
  IconPip,
  IconPlay,
  IconReload,
  IconSkipAd,
  IconSkipBack,
  IconSkipForward,
  IconVolume,
  IconVolumeMuted,
  IconX,
  Spinner,
} from "../../../shared/ui/icons";
import { useTabCloseConfirm } from "../hooks/useTabCloseConfirm";

function IconPin({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  );
}

function IconPinOff({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="2" x2="22" y2="22" />
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h12" />
      <path d="M15 9.34V6h1a2 2 0 0 0 0-4H7.89" />
    </svg>
  );
}

const TAB_VOL_MAX = 600;

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
  onSkipAd?: (tab: BrowserTab, browserId: string) => void;
  onPip?: (tab: BrowserTab, browserId: string) => void;
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
  onSkipAd,
  onPip,
  onDownload,
  activeDownload,
}: Props) {
  const playing = isTabPlaying(tab);
  const hasMediaControls = tabHasMediaControls(tab);
  const artist = tab.media ? mediaArtist(tab.media) : null;

  const tabVolume = tab.media?.tabVolume ?? 100;
  const tabMuted  = tab.media?.tabMuted ?? false;

  const [reloadSpin, setReloadSpin] = useState(false);
  const [localTabVol, setLocalTabVol] = useState(tabVolume);
  const [localTabMuted, setLocalTabMuted] = useState(tabMuted);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [volLayout, setVolLayout] = useState({ fillPx: 0, thumbPx: 0 });

  const [menuOpen, setMenuOpen] = useState(false);
  const [pinned, setPinned] = useState(false);

  const volTrackRef  = useRef<HTMLDivElement>(null);
  const seekZoneRef  = useRef<HTMLDivElement>(null);
  const thumbHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const pinnedRef = useRef(pinned);

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

  useEffect(() => {
    pinnedRef.current = pinned;
  }, [pinned]);

  useEffect(() => {
    return () => {
      if (thumbHoverTimer.current) clearTimeout(thumbHoverTimer.current);
    };
  }, []);

  const effectiveTabVol = localTabMuted ? 0 : localTabVol;
  const volTone = volFillTone(effectiveTabVol);

  const updateVolLayout = useCallback(() => {
    const track = volTrackRef.current;
    if (!track) return;
    const w = track.offsetWidth;
    const pct = effectiveTabVol / TAB_VOL_MAX;
    const px = pct * w;
    setVolLayout({ fillPx: px, thumbPx: px });
  }, [effectiveTabVol]);

  useLayoutEffect(() => { updateVolLayout(); }, [updateVolLayout]);

  useEffect(() => {
    const track = volTrackRef.current;
    if (!track) return;
    const ro = new ResizeObserver(() => updateVolLayout());
    ro.observe(track);
    return () => ro.disconnect();
  }, [updateVolLayout]);

  const { closeConfirm, handleClose, closeTitle, resetCloseConfirm } = useTabCloseConfirm({
    onClose: () => void onClose(tab, browserId),
    onBeforeInteract: () => {},
  });

  // ── Interaction Handlers ──────────────────────────────────────────────────

  const handleThumbEnter = useCallback(() => {
    if (pinnedRef.current) return;
    if (thumbHoverTimer.current) clearTimeout(thumbHoverTimer.current);
    setMenuOpen(true);
  }, []);

  const handleThumbLeave = useCallback(() => {
    if (pinnedRef.current) return; 
    thumbHoverTimer.current = setTimeout(() => {
      if (!pinnedRef.current) {
        setMenuOpen(false);
        resetCloseConfirm();
      }
    }, 800);
  }, [resetCloseConfirm]);

  const handleBodyMenuEnter = useCallback(() => {
    if (thumbHoverTimer.current) clearTimeout(thumbHoverTimer.current);
  }, []);

  const handleBodyMenuLeave = useCallback(() => {
    if (pinnedRef.current) return;
    thumbHoverTimer.current = setTimeout(() => {
      if (!pinnedRef.current) {
        setMenuOpen(false);
        resetCloseConfirm();
      }
    }, 800);
  }, [resetCloseConfirm]);

  const handleTogglePin = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setPinned(prev => {
      const next = !prev;
      setMenuOpen(false);
      resetCloseConfirm();
      return next;
    });
  }, [resetCloseConfirm]);

  const handleTabVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      setLocalTabMuted(false);
      setLocalTabVol(val);
      onSetTabVolume?.(tab, browserId, val);
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
    const zone = seekZoneRef.current;
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

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDownload && tab.url) onDownload(tab.url);
  }, [onDownload, tab.url]);

  const handleReload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setReloadSpin(true);
    void onReload(tab, browserId);
    window.setTimeout(() => setReloadSpin(false), 520);
  }, [onReload, tab, browserId]);

  // ── Render Shared Menu Component Function ─────────────────────────────────

  const renderMenuInner = (isPinnedMode: boolean) => {
    return (
      <div
        className={
          isPinnedMode
            ? `pilpod-media-item__pinned-menu ${variant === "float" ? "pilpod-media-item__pinned-menu--float" : "pilpod-media-item__pinned-menu--inset"}`
            : `pilpod-media-item__body-menu${menuOpen ? " pilpod-media-item__body-menu--open" : ""}`
        }
        onMouseEnter={isPinnedMode ? undefined : handleBodyMenuEnter}
        onMouseLeave={isPinnedMode ? undefined : handleBodyMenuLeave}
      >
        {/* Absolute top center positioned pin controller switch */}
        <button
          type="button"
          className={`pilpod-media-item__menu-pin-btn${pinned ? " pilpod-media-item__menu-pin-btn--active" : ""}`}
          onClick={handleTogglePin}
          title={pinned ? "Unpin" : "Pin open"}
          aria-label={pinned ? "Unpin" : "Pin open"}
        >
          {pinned ? <IconPinOff className="pilpod-media-item__menu-pin-icon" /> : <IconPin className="pilpod-media-item__menu-pin-icon" />}
        </button>

        {/* Action Row */}
        <div className="pilpod-media-item__menu-acts">
          {onSkipAd ? (
            <button type="button" className="pilpod-media-item__menu-act pilpod-media-item__menu-act--skip-ad"
              onClick={(e) => { e.stopPropagation(); onSkipAd(tab, browserId); }}
              title="Skip Ad" aria-label="Skip Ad">
              <IconSkipAd />
            </button>
          ) : null}

          {onPip ? (
            <button type="button" className="pilpod-media-item__menu-act pilpod-media-item__menu-act--pip"
              onClick={(e) => { e.stopPropagation(); onPip(tab, browserId); }}
              title="Picture in Picture" aria-label="Picture in Picture">
              <IconPip />
            </button>
          ) : null}

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
              <span className="pilpod-media-item__dl-label">{downloadProgressLabel(activeDownload)}</span>
            </span>
          ) : onDownload && tab.url ? (
            <button type="button" className="pilpod-media-item__menu-act pilpod-media-item__menu-act--dl"
              onClick={handleDownload} title="Download" aria-label="Download">
              <IconDownload />
            </button>
          ) : null}

          <button type="button"
            className="pilpod-media-item__menu-act pilpod-media-item__menu-act--rl"
            onClick={handleReload} title="Reload" aria-label="Reload">
            <IconReload className={reloadSpin ? "pilpod-media-item__menu-act-icon--spin" : undefined} />
          </button>

          <button type="button"
            className={`pilpod-media-item__menu-act pilpod-media-item__menu-act--cl${closeConfirm ? " pilpod-media-item__menu-act--cl-confirm" : ""}`}
            onClick={handleClose} title={closeTitle} aria-label="Close tab">
            <IconX />
          </button>
        </div>
      </div>
    );
  };

  // ── CSS Class Combinations ────────────────────────────────────────────────

  const volFillClass = [
    "pilpod-media-item__vol-fill",
    volTone !== "normal" ? `pilpod-media-item__vol-fill--${volTone}` : "",
  ].filter(Boolean).join(" ");

  const volPctClass = [
    "pilpod-media-item__vol-pct",
    volTone !== "normal" ? `pilpod-media-item__vol-pct--${volTone}` : "",
  ].filter(Boolean).join(" ");

  const cardClass = [
    "pilpod-media-item",
    variant === "float" ? "pilpod-media-item--float" : "pilpod-media-item--inset",
    playing ? "pilpod-media-item--playing" : "",
    rootClassName,
  ].filter(Boolean).join(" ");

  const playBtnClass = [
    "pilpod-media-item__play-btn",
    playing ? "pilpod-media-item__play-btn--playing" : "",
  ].filter(Boolean).join(" ");

  const progressClass = [
    "pilpod-media-item__progress-fill",
    playing ? "pilpod-media-item__progress-fill--playing" : "",
  ].filter(Boolean).join(" ");

  const hasTabVol = tab.media != null && onSetTabVolume != null;

  return (
    <li
      className={[
        "pilpod-media-item-wrapper",
        pinned ? "pilpod-media-item-wrapper--pinned" : "",
        rootClassName || "",
      ].filter(Boolean).join(" ")}
      {...(flipId ? { "data-flip-id": flipId } : {})}
    >
      <div className={cardClass}>

        {/* ── THUMBNAIL ── */}
        <div
          className="pilpod-media-item__thumb-wrap"
          onMouseEnter={handleThumbEnter}
          onMouseLeave={handleThumbLeave}
        >
          {art ? (
            <img src={art} alt="" className="pilpod-media-item__thumb-img"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : fav ? (
            <img src={fav} alt="" className="pilpod-media-item__thumb-img pilpod-media-item__thumb-img--fav"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div className="pilpod-media-item__thumb-letter">{letter}</div>
          )}

          {/* Go To tab overlay button triggers only when not pinned */}
          <div className={`pilpod-media-item__thumb-overlay${(!pinned && menuOpen) ? " pilpod-media-item__thumb-overlay--visible" : ""}`}>
            <div
              className="pilpod-media-item__goto-area"
              onClick={(e) => { e.stopPropagation(); void onFocus(tab, browserId, browserDisplayName); }}
            >
              <div className="pilpod-media-item__thumb-goto">
                <IconOpenInTab className="pilpod-media-item__thumb-goto-icon" />
              </div>
            </div>
          </div>

          {durationLabel ? (
            <div className="pilpod-media-item__thumb-duration">{durationLabel}</div>
          ) : null}
        </div>

        {/* ── BODY ZONE ── */}
        <div className="pilpod-media-item__body">

          {/* Core metadata details section stays completely active during pin mode */}
          <div className={`pilpod-media-item__content${(!pinned && menuOpen) ? " pilpod-media-item__content--hidden" : ""}`}>
            <div className="pilpod-media-item__title-row">
              <div className="pilpod-media-item__meta">
                <p className="pilpod-media-item__title" title={tab.title?.trim() || undefined}>
                  {tab.title?.trim() || "Untitled"}
                </p>
                {artist ? <p className="pilpod-media-item__channel">{artist}</p> : null}
              </div>
              <div
                className={`pilpod-media-item__state-badge pilpod-media-item__state-badge--${playing ? "active" : badgeState}`}
                title={`Tab state: ${badgeLabel}`}
              >
                <div className="pilpod-media-item__state-dot" />
                <span>{badgeLabel}</span>
              </div>
            </div>

            {hasTabVol ? (
              <div className="pilpod-media-item__vol-row">
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
                <div className="pilpod-media-item__vol-track" ref={volTrackRef}>
                  <div className="pilpod-media-item__vol-rail" />
                  <div className={volFillClass} style={{ width: `${volLayout.fillPx}px` }} />
                  <div className="pilpod-media-item__vol-thumb" style={{ left: `${volLayout.thumbPx}px` }} />
                  <input
                    type="range"
                    className="pilpod-media-item__vol-input"
                    min="0" max={TAB_VOL_MAX} value={effectiveTabVol} step="5"
                    onChange={handleTabVolumeChange}
                    aria-label={`Tab volume: ${effectiveTabVol}%`}
                  />
                </div>
                <span className={volPctClass}>{effectiveTabVol}%</span>
              </div>
            ) : null}
          </div>

          {/* Mount as inline body overlay ONLY if unpinned */}
          {!pinned && renderMenuInner(false)}
        </div>

        {/* ── PLAY CONTROL ── */}
        {hasMediaControls ? (
          <button type="button" className={playBtnClass} disabled={busy}
            onClick={(e) => { e.stopPropagation(); onPlayPause(tab, browserId); }}
            title={playing ? "Pause" : "Play"} aria-label={playing ? "Pause" : "Play"}>
            {busy ? <Spinner /> : playing
              ? <IconPause className="pilpod-icon--sm" />
              : <IconPlay className="pilpod-icon--sm" />}
          </button>
        ) : null}

        {/* ── SEEKBAR FLANKS ROW ── */}
        <div className="pilpod-media-item__seek-row">
          {tab.media ? (
            <button type="button"
              className="pilpod-media-item__seek-flank pilpod-media-item__seek-flank--prev"
              onClick={handlePrevious} title="Previous" aria-label="Previous track">
              <IconSkipBack />
            </button>
          ) : null}

          <div
            ref={seekZoneRef}
            className={`pilpod-media-item__seek-zone${duration && onSeek ? " pilpod-media-item__seek-zone--active" : ""}`}
            onPointerDown={duration && onSeek ? handleSeekPointerDown : undefined}
            onPointerMove={duration && onSeek ? handleSeekPointerMove : undefined}
            onPointerUp={duration && onSeek ? handleSeekPointerUp : undefined}
            onPointerCancel={duration && onSeek ? handleSeekPointerUp : undefined}
          >
            <div className="pilpod-media-item__progress-bar">
              <div className={progressClass} style={{ width: `${displayProgress}%` }} />
            </div>
            {isSeeking && currentTimeLabel && durationLabel ? (
              <div className="pilpod-media-item__seek-tooltip" style={{ left: `${displayProgress}%` }}>
                {currentTimeLabel} / {durationLabel}
              </div>
            ) : null}
          </div>

          {tab.media ? (
            <button type="button"
              className="pilpod-media-item__seek-flank pilpod-media-item__seek-flank--next"
              onClick={handleNext} title="Next" aria-label="Next track">
              <IconSkipForward />
            </button>
          ) : null}
        </div>

      </div>{/* end card */}

      {/* Mount underneath as a styled layout container extension ONLY if pinned */}
      {pinned && renderMenuInner(true)}
    </li>
  );
}