import { useMemo, useState } from "react";
import "./Blocked.css";
import {
  useYoutubeBlock,
  type BlockEvent,
  type BlockedVideo,
  type ClearScope,
} from "../../../youtube-block";
import { IconBlock } from "../../../../shared/ui/icons";
import { SectionSidebar } from "../../navigation/SidebarSlot";
import { ConfirmButton } from "../../ui/ConfirmButton";
import { EmptyState } from "../../ui/EmptyState";
import { FilterInput } from "../../ui/FilterInput";
import { SectionLayout } from "../../ui/SectionLayout";

type View = "blocked" | "mine" | "skipped";

const VIEWS: ReadonlyArray<{ view: View; label: string; hint: string }> = [
  { view: "blocked", label: "Blocked videos", hint: "Skipped whenever they play out of focus" },
  { view: "mine", label: "Your activity", hint: "Videos you blocked or unblocked" },
  { view: "skipped", label: "Skipped", hint: "Blocked videos PilPod skipped for you" },
];

const CLEAR_SCOPE: Record<Exclude<View, "blocked">, ClearScope> = {
  mine: "mine",
  skipped: "skipped",
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

/**
 * Blocked — YouTube videos the user blocked, what they did, and what PilPod
 * skipped automatically. The rules live in Rust (`src-tauri/src/youtube_block`)
 * and run whether or not this window is open.
 */
export default function BlockedSection() {
  const api = useYoutubeBlock();
  const [view, setView] = useState<View>("blocked");
  const [search, setSearch] = useState("");
  const { blocked, history } = api.state;

  const terms = useMemo(
    () => search.toLowerCase().split(/\s+/).filter(Boolean),
    [search],
  );

  const mine = useMemo(() => history.filter((e) => e.kind !== "skipped"), [history]);
  const skipped = useMemo(() => history.filter((e) => e.kind === "skipped"), [history]);

  const counts: Record<View, number> = {
    blocked: blocked.length,
    mine: mine.length,
    skipped: skipped.length,
  };

  const shownBlocked = blocked.filter((b) => matches(`${b.title} ${b.url}`, terms));
  const shownMine = mine.filter((e) => matches(`${e.title} ${e.url}`, terms));
  const shownSkipped = skipped.filter((e) => matches(`${e.title} ${e.url} ${e.browserName ?? ""}`, terms));

  const current = VIEWS.find((v) => v.view === view)!;

  return (
    <>
      <SectionSidebar>
        <nav className="sky-subnav" aria-label="Blocked lists">
          <h2 className="sky-sidebar__heading">Lists</h2>
          <ul>
            {VIEWS.map((v) => (
              <li key={v.view}>
                <button
                  type="button"
                  className="sky-subnav__item"
                  aria-current={view === v.view ? "true" : undefined}
                  onClick={() => setView(v.view)}
                >
                  <IconBlock className="sky-subnav__icon" />
                  <span className="sky-subnav__text">
                    <span className="sky-subnav__label">{v.label}</span>
                    <span className="sky-subnav__sub">{v.hint}</span>
                  </span>
                  <span className="sky-nav__count">{counts[v.view]}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <section className="sky-card-panel" aria-label="How blocking works">
          <h2 className="sky-sidebar__heading">How it works</h2>
          <p className="sky-setting__hint">
            A blocked video is skipped the moment it plays in a tab you are not looking at. The tab
            you are watching is never touched.
          </p>
        </section>
      </SectionSidebar>

      <SectionLayout
        label="Blocked videos"
        title={current.label}
        meta={current.hint}
        actions={
          <>
            <FilterInput
              value={search}
              onChange={setSearch}
              placeholder="Filter titles"
              label="Filter blocked videos"
            />
            {view !== "blocked" && counts[view] > 0 ? (
              <ConfirmButton
                className="sky-textbtn sky-textbtn--danger"
                confirmLabel="Clear list?"
                onConfirm={() => void api.clearHistory(CLEAR_SCOPE[view])}
              >
                Clear list
              </ConfirmButton>
            ) : null}
          </>
        }
      >
        {view === "blocked" ? (
          shownBlocked.length === 0 ? (
            <EmptyState title={search.trim() ? "No match" : "Nothing blocked yet"}>
              {search.trim()
                ? `No blocked video has “${search.trim()}” in its title.`
                : "Use the block button on a YouTube tab in Live to block that video."}
            </EmptyState>
          ) : (
            <ul className="sky-blk">
              {shownBlocked.map((b) => (
                <BlockedRow key={b.videoId} video={b} onUnblock={() => void api.unblock(b.videoId)} />
              ))}
            </ul>
          )
        ) : (
          <EventList
            events={view === "mine" ? shownMine : shownSkipped}
            empty={
              search.trim() ? (
                <EmptyState title="No match">Nothing in this list matches “{search.trim()}”.</EmptyState>
              ) : view === "mine" ? (
                <EmptyState title="No activity yet">Videos you block or unblock are listed here.</EmptyState>
              ) : (
                <EmptyState title="Nothing skipped yet">
                  Each time PilPod skips a blocked video it is recorded here.
                </EmptyState>
              )
            }
          />
        )}
      </SectionLayout>
    </>
  );
}

function BlockedRow({ video, onUnblock }: { video: BlockedVideo; onUnblock: () => void }) {
  return (
    <li className="sky-blk__row">
      <span className="sky-blk__main">
        <span className="sky-blk__title" title={video.title}>
          {video.title}
        </span>
        <span className="sky-blk__sub" title={video.url}>
          {video.url}
        </span>
      </span>
      <span className="sky-blk__time">Blocked {when(video.blockedAtMs)}</span>
      <ConfirmButton
        className="sky-textbtn"
        confirmLabel="Unblock?"
        title="Stop skipping this video"
        onConfirm={onUnblock}
      >
        Unblock
      </ConfirmButton>
    </li>
  );
}

const KIND_LABEL: Record<BlockEvent["kind"], string> = {
  blocked: "Blocked",
  unblocked: "Unblocked",
  skipped: "Skipped",
};

function detail(e: BlockEvent): string {
  if (e.kind !== "skipped") return e.url;
  const how = e.action === "close" ? "closed the tab" : "moved to the next video";
  return [e.browserName, how].filter(Boolean).join(" · ");
}

function EventList({ events, empty }: { events: BlockEvent[]; empty: React.ReactNode }) {
  if (events.length === 0) return <>{empty}</>;
  return (
    <ul className="sky-blk">
      {events.map((e) => (
        <li key={e.id} className="sky-blk__row">
          <span className={`sky-blk__kind sky-blk__kind--${e.kind}`}>{KIND_LABEL[e.kind]}</span>
          <span className="sky-blk__main">
            <span className="sky-blk__title" title={e.title}>
              {e.title}
            </span>
            <span className="sky-blk__sub" title={e.url}>
              {detail(e)}
            </span>
          </span>
          <span className="sky-blk__time">{when(e.atMs)}</span>
        </li>
      ))}
    </ul>
  );
}
