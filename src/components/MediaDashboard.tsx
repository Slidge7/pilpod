import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  BrowserTabMediaDto,
  GsmtcSnapshot,
  MediaSessionDto,
} from "../types/media";

const EVT = "gsmtc://update";
const ALWAYS_ON_TOP_STORAGE_KEY = "omnimedia-always-on-top";
const WIDGET_TRANSITION_MS = 230;

function thumbSrc(s: MediaSessionDto): string | null {
  if (!s.thumbnailBase64) return null;
  const mime = s.thumbnailMime || "image/jpeg";
  return `data:${mime};base64,${s.thumbnailBase64}`;
}

function formatTicks(ticks: number): string {
  const sec = Math.max(0, ticks / 10_000_000);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function sessionDurationLabel(s: MediaSessionDto): string | null {
  if (s.timeline.endTicks <= 0) return null;
  return formatTicks(s.timeline.endTicks);
}

function channelBrowser(t: BrowserTabMediaDto): string | null {
  const a = t.artist?.trim();
  return a || null;
}

function channelSession(s: MediaSessionDto): string | null {
  const a = s.artist?.trim();
  if (a) return a;
  const sub = s.subtitle?.trim();
  return sub || null;
}

function isBrowserPlaying(t: BrowserTabMediaDto): boolean {
  return t.playbackState === "playing";
}

function isSessionPlaying(s: MediaSessionDto): boolean {
  const st = (s.playbackStatus || "").toLowerCase();
  return st === "playing";
}

function groupBrowserTabsByProfile(
  tabs: BrowserTabMediaDto[],
): [string, BrowserTabMediaDto[]][] {
  const map = new Map<string, BrowserTabMediaDto[]>();
  const order: string[] = [];
  for (const t of tabs) {
    if (!map.has(t.browserId)) {
      order.push(t.browserId);
      map.set(t.browserId, []);
    }
    map.get(t.browserId)!.push(t);
  }
  return order.map((id) => [id, map.get(id)!]);
}

function browserRowKey(t: BrowserTabMediaDto): string {
  return `b:${t.browserId}:${t.tabId}`;
}

function winRowKey(s: MediaSessionDto): string {
  return `w:${s.sessionIndex}`;
}

function IconPlay({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

function IconPause({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-5 w-5 rounded-full border-2 border-zinc-400 border-t-zinc-900 animate-spin"
      aria-hidden
    />
  );
}

function IconStayOnTop() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.78l-1.28.64A2 2 0 0 0 5 15.16V17h14v-1.84a2 2 0 0 0-1.61-1.98l-1.28-.64A2 2 0 0 1 15 10.76V7a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v3.76z" />
      <path d="M8 2h8v4H8z" />
    </svg>
  );
}

function IconWidgetMinimize({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M7 3h6a4 4 0 0 1 4 4v6" />
    </svg>
  );
}

function IconClose({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function IconMusicGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

export function MediaDashboard() {
  const [snapshot, setSnapshot] = useState<GsmtcSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<"browser" | "windows">("browser");
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(() => new Set());
  const [alwaysOnTop, setAlwaysOnTop] = useState(() => {
    try {
      return localStorage.getItem(ALWAYS_ON_TOP_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [isWidget, setIsWidget] = useState(false);
  const [dimmingToWidget, setDimmingToWidget] = useState(false);
  const [fullEnterActive, setFullEnterActive] = useState(false);
  const [fullEnterVisible, setFullEnterVisible] = useState(false);
  const windowTransitionLock = useRef(false);

  const markPending = useCallback((key: string) => {
    setPendingKeys((prev) => new Set(prev).add(key));
  }, []);

  const clearPending = useCallback((key: string) => {
    setPendingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const refresh = useCallback(async (retries = 12) => {
    try {
      setError(null);
      const snap = await invoke<GsmtcSnapshot>("gsmtc_refresh");
      setSnapshot(snap);
    } catch (e) {
      if (retries > 0) {
        await new Promise((r) => setTimeout(r, 120));
        return refresh(retries - 1);
      }
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (isWidget) return;
    void getCurrentWindow()
      .setAlwaysOnTop(alwaysOnTop)
      .catch(() => {
        /* e.g. Vite dev in a normal browser */
      });
  }, [alwaysOnTop, isWidget]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen<GsmtcSnapshot>(EVT, (ev) => {
      setSnapshot(ev.payload);
      setError(null);
    }).then((u) => {
      unlisten = u;
    });
    void refresh();
    return () => {
      void unlisten?.();
    };
  }, [refresh]);

  const toggleBrowser = useCallback(
    async (t: BrowserTabMediaDto) => {
      const key = browserRowKey(t);
      markPending(key);
      setError(null);
      try {
        await invoke("browser_media_control", {
          browserId: t.browserId,
          tabId: t.tabId,
          action: "playPause",
        });
      } catch (e) {
        setError(String(e));
      } finally {
        clearPending(key);
      }
    },
    [clearPending, markPending],
  );

  const toggleAlwaysOnTop = useCallback(() => {
    setAlwaysOnTop((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ALWAYS_ON_TOP_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const minimizeToWidgetMode = useCallback(async () => {
    if (windowTransitionLock.current || isWidget) return;
    windowTransitionLock.current = true;
    setDimmingToWidget(true);
    window.setTimeout(async () => {
      try {
        await invoke("toggle_widget_mode", { isMini: true });
        setIsWidget(true);
      } catch (e) {
        setError(String(e));
      } finally {
        setDimmingToWidget(false);
        windowTransitionLock.current = false;
      }
    }, WIDGET_TRANSITION_MS);
  }, [isWidget]);

  const restoreFromWidget = useCallback(async () => {
    if (windowTransitionLock.current || !isWidget) return;
    windowTransitionLock.current = true;
    try {
      await invoke("toggle_widget_mode", { isMini: false });
      setIsWidget(false);
      void getCurrentWindow()
        .setAlwaysOnTop(alwaysOnTop)
        .catch(() => {
          /* browser dev */
        });
      setFullEnterActive(true);
      setFullEnterVisible(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setFullEnterVisible(true);
          window.setTimeout(() => {
            setFullEnterActive(false);
            setFullEnterVisible(false);
            windowTransitionLock.current = false;
          }, WIDGET_TRANSITION_MS + 40);
        });
      });
    } catch (e) {
      setError(String(e));
      windowTransitionLock.current = false;
    }
  }, [alwaysOnTop, isWidget]);

  const closeApp = useCallback(() => {
    void getCurrentWindow().close().catch(() => {
      /* browser dev */
    });
  }, []);

  const toggleWinSession = useCallback(
    async (s: MediaSessionDto) => {
      const key = winRowKey(s);
      markPending(key);
      setError(null);
      try {
        await invoke("gsmtc_toggle_play_pause", {
          sessionIndex: s.sessionIndex,
        });
      } catch (e) {
        setError(String(e));
      } finally {
        clearPending(key);
      }
    },
    [clearPending, markPending],
  );

  const sessions = snapshot?.sessions ?? [];
  const browserTabs = snapshot?.browserTabs ?? [];
  const browserProfileGroups = useMemo(
    () => groupBrowserTabsByProfile(browserTabs),
    [browserTabs],
  );

  if (isWidget) {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-transparent"
        data-tauri-drag-region="deep"
      >
        <button
          type="button"
          onClick={() => void restoreFromWidget()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-zinc-800/95 text-amber-400 ring-1 ring-zinc-600/80 shadow-lg shadow-black/40 hover:bg-zinc-700"
          title="Restore OmniMedia (tap)"
          aria-label="Restore OmniMedia window"
        >
          <IconMusicGlyph className="h-[18px] w-[18px]" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`omni-shell-dim flex h-screen min-h-0 flex-col bg-transparent text-zinc-100 ${
        dimmingToWidget ? "is-dimming" : ""
      } ${fullEnterActive ? "is-entering" : ""} ${
        fullEnterVisible ? "is-entered" : ""
      }`}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-950">
        <header
          className="flex min-h-8 shrink-0 items-stretch border-b border-zinc-800/90 bg-zinc-950/95"
          data-tauri-drag-region="deep"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
            <span className="truncate text-[11px] font-medium tracking-tight text-zinc-300">
              OmniMedia
            </span>
            <span className="truncate text-[10px] text-zinc-600">
              {browserTabs.length} br · {sessions.length} win
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-px pr-1">
            <button
              type="button"
              onClick={toggleAlwaysOnTop}
              className={`flex h-8 min-w-8 items-center justify-center rounded-md transition-colors ${
                alwaysOnTop
                  ? "bg-amber-950/70 text-amber-400 ring-1 ring-amber-700/50"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
              title={
                alwaysOnTop ? "Disable always on top" : "Keep window on top"
              }
              aria-pressed={alwaysOnTop}
            >
              <IconStayOnTop />
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              className="flex h-8 min-w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title="Refresh"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 3h5v5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => void minimizeToWidgetMode()}
              className="flex h-8 min-w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title="Minimize to floating widget"
            >
              <IconWidgetMinimize />
            </button>
            <button
              type="button"
              onClick={closeApp}
              className="flex h-8 min-w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-red-950/60 hover:text-red-300"
              title="Close"
            >
              <IconClose />
            </button>
          </div>
        </header>

      <div
        className="flex shrink-0 gap-1 border-b border-zinc-800/80 bg-zinc-900/40 p-1.5"
        data-tauri-drag-region="deep"
        role="tablist"
        aria-label="Media source"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === "browser"}
          id="tab-browser"
          aria-controls="panel-browser"
          onClick={() => setMainTab("browser")}
          className={`flex-1 rounded-lg py-2 px-2 text-xs font-medium transition-colors ${
            mainTab === "browser"
              ? "bg-zinc-800 text-zinc-100 shadow-sm"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Browsers ({browserTabs.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === "windows"}
          id="tab-windows"
          aria-controls="panel-windows"
          onClick={() => setMainTab("windows")}
          className={`flex-1 rounded-lg py-2 px-2 text-xs font-medium transition-colors ${
            mainTab === "windows"
              ? "bg-zinc-800 text-zinc-100 shadow-sm"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Windows ({sessions.length})
        </button>
      </div>

      <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3">
        {error ? (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-2.5 py-2 text-[11px] text-red-200 mb-3">
            {error}
          </div>
        ) : null}

        {mainTab === "browser" ? (
          <section
            className="space-y-3"
            role="tabpanel"
            id="panel-browser"
            aria-labelledby="tab-browser"
          >
            {browserTabs.length === 0 ? (
              <p className="text-xs text-zinc-500 py-6 text-center leading-relaxed">
                No browser tabs yet. Load the companion extension and open media
                in Chromium.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {browserProfileGroups.map(([browserId, tabs]) => (
                  <div key={browserId} className="flex flex-col gap-2">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 px-0.5">
                      Browser · {browserId.slice(0, 8)}…
                    </p>
                    <ul className="flex flex-col gap-2">
                      {tabs.map((t) => {
                        const rk = browserRowKey(t);
                        const busy = pendingKeys.has(rk);
                        const playing = isBrowserPlaying(t);
                        const ch = channelBrowser(t);

                        return (
                          <li
                            key={rk}
                            className="flex items-center gap-2.5 rounded-xl border border-zinc-800/90 bg-zinc-900/35 px-2.5 py-2"
                          >
                            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-zinc-800 flex items-center justify-center">
                              <span className="text-sm font-medium text-zinc-500">
                                {(t.title?.trim() || "?").slice(0, 1).toUpperCase()}
                              </span>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium leading-snug line-clamp-2 text-zinc-100">
                                {t.title?.trim() || "Untitled"}
                              </p>
                              <div className="mt-0.5 flex flex-wrap gap-x-1.5 text-[11px] text-zinc-500">
                                {ch ? (
                                  <span className="truncate">{ch}</span>
                                ) : null}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={busy}
                              title={playing ? "Pause" : "Play"}
                              aria-label={playing ? "Pause" : "Play"}
                              onClick={() => void toggleBrowser(t)}
                              className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 enabled:hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              {busy ? (
                                <Spinner />
                              ) : playing ? (
                                <IconPause />
                              ) : (
                                <IconPlay />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section
            className="flex flex-col gap-2"
            role="tabpanel"
            id="panel-windows"
            aria-labelledby="tab-windows"
          >
            {sessions.length === 0 ? (
              <p className="text-xs text-zinc-500 py-6 text-center">
                No Windows media sessions.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {sessions.map((s) => {
                  const rk = winRowKey(s);
                  const busy = pendingKeys.has(rk);
                  const playing = isSessionPlaying(s);
                  const ch = channelSession(s);
                  const dur = sessionDurationLabel(s);
                  const winDisabled =
                    busy || !s.controls.playPauseToggleEnabled;

                  return (
                    <li
                      key={rk}
                      className="flex items-center gap-2.5 rounded-xl border border-zinc-800/90 bg-zinc-900/35 px-2.5 py-2"
                    >
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-zinc-800">
                        {thumbSrc(s) ? (
                          <img
                            src={thumbSrc(s)!}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">
                            —
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug line-clamp-2 text-zinc-100">
                          {s.title?.trim() || "Unknown title"}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-zinc-500">
                          {ch ? (
                            <span className="truncate max-w-full">{ch}</span>
                          ) : null}
                          {ch && dur ? (
                            <span className="text-zinc-600" aria-hidden>
                              ·
                            </span>
                          ) : null}
                          {dur ? <span>{dur}</span> : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={winDisabled}
                        title={playing ? "Pause" : "Play"}
                        aria-label={playing ? "Pause" : "Play"}
                        onClick={() => void toggleWinSession(s)}
                        className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 enabled:hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {busy ? (
                          <Spinner />
                        ) : playing ? (
                          <IconPause />
                        ) : (
                          <IconPlay />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </main>
      </div>
    </div>
  );
}
