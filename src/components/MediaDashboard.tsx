import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { GsmtcSnapshot, MediaSessionDto } from "../types/media";

const EVT = "gsmtc://update";

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

export function MediaDashboard() {
  const [snapshot, setSnapshot] = useState<GsmtcSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const sessions = snapshot?.sessions ?? [];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">OmniMedia</h1>
          <p className="text-sm text-zinc-400">
            Windows system media sessions (GSMTC)
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium hover:bg-zinc-700 active:bg-zinc-600"
        >
          Refresh
        </button>
      </header>

      <main className="p-6">
        {error ? (
          <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {sessions.length === 0 && !error ? (
          <p className="text-zinc-500 text-sm">
            No active media sessions. Start playback in Spotify, Chrome, Edge,
            etc.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sessions.map((s) => (
              <li
                key={s.sourceAppUserModelId}
                className="flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 shadow-sm"
              >
                <div className="flex gap-4 p-4">
                  <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
                    {thumbSrc(s) ? (
                      <img
                        src={thumbSrc(s)!}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
                        No art
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs uppercase tracking-wide text-zinc-500">
                      {s.sourceAppUserModelId}
                    </p>
                    <p className="truncate text-lg font-medium leading-snug">
                      {s.title || "Unknown title"}
                    </p>
                    <p className="truncate text-sm text-zinc-400">
                      {s.artist || "Unknown artist"}
                    </p>
                    {s.album ? (
                      <p className="truncate text-xs text-zinc-500">{s.album}</p>
                    ) : null}
                    <p className="mt-2 inline-flex rounded-full bg-zinc-800 px-2 py-0.5 text-xs capitalize text-zinc-300">
                      {s.playbackStatus}
                    </p>
                  </div>
                </div>

                <div className="border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">
                  {formatTicks(s.timeline.positionTicks)} /{" "}
                  {formatTicks(s.timeline.endTicks)}
                </div>

                <div className="flex gap-2 border-t border-zinc-800 p-3">
                  <button
                    type="button"
                    disabled={!s.controls.previousEnabled}
                    onClick={() =>
                      void invoke("gsmtc_skip_previous", {
                        aumid: s.sourceAppUserModelId,
                      })
                    }
                    className="flex-1 rounded-lg bg-zinc-800 py-2 text-sm font-medium enabled:hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={!s.controls.playPauseToggleEnabled}
                    onClick={() =>
                      void invoke("gsmtc_toggle_play_pause", {
                        aumid: s.sourceAppUserModelId,
                      })
                    }
                    className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white enabled:hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Play / Pause
                  </button>
                  <button
                    type="button"
                    disabled={!s.controls.nextEnabled}
                    onClick={() =>
                      void invoke("gsmtc_skip_next", {
                        aumid: s.sourceAppUserModelId,
                      })
                    }
                    className="flex-1 rounded-lg bg-zinc-800 py-2 text-sm font-medium enabled:hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
