import { useMemo, useState } from "react";
import "../history/History.css";
import "./BlockedPanel.css";
import { ConfirmButton } from "../history/components/ConfirmButton";
import { IconBlock, IconSearch } from "../../shared/ui/icons";
import { useYoutubeBlock } from "./hooks/useYoutubeBlock";
import type { BlockEvent, BlockedVideo, ClearScope } from "./types";

type View = "blocked" | "mine" | "skipped";

const TABS: ReadonlyArray<{ view: View; label: string }> = [
  { view: "blocked", label: "Blocked" },
  { view: "mine", label: "Activity" },
  { view: "skipped", label: "Skipped" },
];

const CLEAR_SCOPE: Record<Exclude<View, "blocked">, ClearScope> = {
  mine: "mine",
  skipped: "skipped",
};

const KIND_LABEL: Record<BlockEvent["kind"], string> = {
  blocked: "Blocked",
  unblocked: "Unblocked",
  skipped: "Skipped",
};

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function matches(text: string, terms: readonly string[]): boolean {
  const hay = text.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

function detail(e: BlockEvent): string {
  if (e.kind !== "skipped") return e.url;
  const how = e.action === "close" ? "closed the tab" : "moved to the next video";
  return [e.browserName, how].filter(Boolean).join(" · ");
}

/**
 * Blocked videos, in the main window: what the user blocked, what they
 * unblocked, and what PilPod skipped. Same data as the Sky "Blocked" section;
 * the rules themselves run in Rust (`src-tauri/src/youtube_block`).
 */
export function BlockedPanel() {
  const api = useYoutubeBlock();
  const [view, setView] = useState<View>("blocked");
  const [search, setSearch] = useState("");
  const { blocked, history } = api.state;

  const terms = useMemo(() => search.toLowerCase().split(/\s+/).filter(Boolean), [search]);
  const mine = useMemo(() => history.filter((e) => e.kind !== "skipped"), [history]);
  const skipped = useMemo(() => history.filter((e) => e.kind === "skipped"), [history]);

  const counts: Record<View, number> = {
    blocked: blocked.length,
    mine: mine.length,
    skipped: skipped.length,
  };

  const shownBlocked = blocked.filter((b) => matches(`${b.title} ${b.url}`, terms));
  const events = (view === "mine" ? mine : skipped).filter((e) =>
    matches(`${e.title} ${e.url} ${e.browserName ?? ""}`, terms),
  );
  const filtering = search.trim().length > 0;

  return (
    <section className="pilpod-history-panel pilpod-blk-panel" aria-label="Blocked videos">
      <div className="pilpod-history-toolbar">
        <div className="pilpod-history-tabs" role="tablist" aria-label="Blocked lists">
          {TABS.map((t) => (
            <button
              key={t.view}
              type="button"
              role="tab"
              aria-selected={view === t.view}
              className={`pilpod-history-tab${view === t.view ? " pilpod-history-tab--active" : ""}`}
              onClick={() => setView(t.view)}
            >
              {t.label}
              <span className="pilpod-blk-count">{counts[t.view]}</span>
            </button>
          ))}
        </div>
        {view !== "blocked" && counts[view] > 0 ? (
          <ConfirmButton
            className="pilpod-history-textbtn pilpod-history-textbtn--danger"
            confirmLabel="Clear?"
            title="Clear this list"
            onConfirm={() => void api.clearHistory(CLEAR_SCOPE[view])}
          >
            Clear
          </ConfirmButton>
        ) : null}
      </div>

      <label className="pilpod-history-search">
        <IconSearch className="pilpod-history-search__icon" />
        <input
          type="search"
          className="pilpod-history-search__input"
          placeholder="Filter titles…"
          value={search}
          aria-label="Filter blocked videos"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>

      <p className="pilpod-blk-hint">
        A blocked video is skipped as soon as it plays in a tab you are not looking at.
      </p>

      {view === "blocked" ? (
        shownBlocked.length === 0 ? (
          <Empty
            title={filtering ? "No match" : "Nothing blocked yet"}
            hint={filtering ? undefined : "Use the block button on a playing YouTube video."}
          />
        ) : (
          <ul className="pilpod-blk-list">
            {shownBlocked.map((b) => (
              <BlockedRow key={b.videoId} video={b} onUnblock={() => void api.unblock(b.videoId)} />
            ))}
          </ul>
        )
      ) : events.length === 0 ? (
        <Empty
          title={filtering ? "No match" : view === "mine" ? "No activity yet" : "Nothing skipped yet"}
          hint={
            filtering
              ? undefined
              : view === "mine"
                ? "Videos you block or unblock are listed here."
                : "Each time PilPod skips a blocked video it is recorded here."
          }
        />
      ) : (
        <ul className="pilpod-blk-list">
          {events.map((e) => (
            <li key={e.id} className="pilpod-blk-row">
              <span className={`pilpod-blk-kind pilpod-blk-kind--${e.kind}`}>{KIND_LABEL[e.kind]}</span>
              <span className="pilpod-blk-main">
                <span className="pilpod-blk-title" title={e.title}>{e.title}</span>
                <span className="pilpod-blk-sub" title={e.url}>{detail(e)} · {when(e.atMs)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BlockedRow({ video, onUnblock }: { video: BlockedVideo; onUnblock: () => void }) {
  return (
    <li className="pilpod-blk-row">
      <IconBlock className="pilpod-blk-icon" />
      <span className="pilpod-blk-main">
        <span className="pilpod-blk-title" title={video.title}>{video.title}</span>
        <span className="pilpod-blk-sub" title={video.url}>Blocked {when(video.blockedAtMs)}</span>
      </span>
      <ConfirmButton
        className="pilpod-history-textbtn"
        confirmLabel="Unblock?"
        title="Stop skipping this video"
        onConfirm={onUnblock}
      >
        Unblock
      </ConfirmButton>
    </li>
  );
}

function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="pilpod-blk-empty">
      <strong>{title}</strong>
      {hint ? <span>{hint}</span> : null}
    </div>
  );
}
