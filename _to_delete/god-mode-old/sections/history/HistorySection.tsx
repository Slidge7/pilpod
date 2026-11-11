import { useCallback, useMemo, useState } from "react";
import "./History.css";
import {
  historyApi,
  useHistoryList,
  useHistorySettings,
  type HistoryKind,
  type HistorySettingsApi,
  type MediaPlay,
  type PageVisit,
} from "../../../history";
import { IconGlobe, IconMusicNote } from "../../../../shared/ui/icons";
import { useBrowserIcons } from "../../data/GodModeData";
import { useSectionIntent } from "../../navigation/Navigation";
import { SectionSidebar } from "../../navigation/SidebarSlot";
import { parseQuery } from "../../search/lib/query";
import { ConfirmButton } from "../../ui/ConfirmButton";
import { EmptyState } from "../../ui/EmptyState";
import { FilterInput } from "../../ui/FilterInput";
import { SectionLayout } from "../../ui/SectionLayout";
import { HistoryTimeline } from "./components/HistoryTimeline";
import { PageRow, PlayRow, type HistoryRowActions } from "./components/HistoryRows";

const RETENTION_OPTIONS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 7, label: "1 week" },
  { days: 30, label: "1 month" },
  { days: 90, label: "3 months" },
  { days: 365, label: "1 year" },
  { days: 0, label: "Forever" },
];

const KINDS: ReadonlyArray<{ kind: HistoryKind; label: string; hint: string }> = [
  { kind: "pages", label: "Pages", hint: "Every page you opened" },
  { kind: "media", label: "Media", hint: "What played for 10 s or more" },
];

function openEntry(url: string) {
  historyApi.open(url).catch((err: unknown) => console.error("[god-mode] open history entry:", err));
}

/**
 * History — pages visited and media played in connected browsers, as PilPod
 * recorded them (see `src-tauri/src/history`). Reads, opens and deletes; the
 * recorder itself runs in Rust whether or not this window is open.
 */
export default function HistorySection() {
  const [kind, setKind] = useState<HistoryKind>("pages");
  const [search, setSearch] = useState("");
  const settings = useHistorySettings();

  useSectionIntent("history", (intent) => {
    if (intent.historyKind) setKind(intent.historyKind);
    if (intent.search !== undefined) setSearch(intent.search);
  });

  const terms = useMemo(() => parseQuery(search).terms, [search]);

  return (
    <>
      <SectionSidebar>
        <nav className="gm-subnav" aria-label="History lists">
          <h2 className="gm-sidebar__heading">Lists</h2>
          <ul>
            {KINDS.map((k) => (
              <li key={k.kind}>
                <button
                  type="button"
                  className="gm-subnav__item"
                  aria-current={kind === k.kind ? "true" : undefined}
                  onClick={() => setKind(k.kind)}
                >
                  {k.kind === "pages" ? <IconGlobe className="gm-subnav__icon" /> : <IconMusicNote className="gm-subnav__icon" />}
                  <span className="gm-subnav__text">
                    <span className="gm-subnav__label">{k.label}</span>
                    <span className="gm-subnav__sub">{k.hint}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <RecordingCard api={settings} />
      </SectionSidebar>

      <SectionLayout
        label="History"
        title="History"
        meta={
          settings.settings && !settings.settings.recording
            ? "Recording is paused — nothing new is saved"
            : kind === "pages"
              ? "Pages you opened in connected browsers"
              : "Videos and music that played in connected browsers"
        }
        actions={
          <FilterInput
            value={search}
            onChange={setSearch}
            placeholder={kind === "pages" ? "Filter pages" : "Filter titles, artists"}
            label={kind === "pages" ? "Filter page history" : "Filter media history"}
          />
        }
      >
        {settings.unavailable ? (
          <EmptyState title="History is unavailable">
            PilPod could not open its history database this session. Restarting PilPod usually fixes it.
          </EmptyState>
        ) : kind === "pages" ? (
          <PagesTimeline key="pages" search={search} terms={terms} />
        ) : (
          <MediaTimeline key="media" search={search} terms={terms} />
        )}
      </SectionLayout>
    </>
  );
}

function useRowActions(remove: (ids: number[]) => Promise<void>): HistoryRowActions {
  const icons = useBrowserIcons();
  const iconFor = useCallback((id: string) => icons.get(id) ?? null, [icons]);
  return useMemo(
    () => ({ open: openEntry, remove: (id: number) => void remove([id]), iconFor }),
    [remove, iconFor],
  );
}

function PagesTimeline({ search, terms }: { search: string; terms: readonly string[] }) {
  const list = useHistoryList("pages", search);
  const actions = useRowActions(list.remove);
  return (
    <HistoryTimeline<PageVisit>
      list={list}
      noun="page"
      renderRow={(visit) => <PageRow key={visit.id} visit={visit} terms={terms} actions={actions} />}
      empty={
        search.trim() ? (
          <EmptyState title="No page matches">Nothing you visited has “{search.trim()}” in its title or address.</EmptyState>
        ) : (
          <EmptyState title="No pages yet">Pages you open in connected browsers appear here as you browse.</EmptyState>
        )
      }
    />
  );
}

function MediaTimeline({ search, terms }: { search: string; terms: readonly string[] }) {
  const list = useHistoryList("media", search);
  const actions = useRowActions(list.remove);
  return (
    <HistoryTimeline<MediaPlay>
      list={list}
      noun="play"
      renderRow={(play) => <PlayRow key={play.id} play={play} terms={terms} actions={actions} />}
      empty={
        search.trim() ? (
          <EmptyState title="No media matches">Nothing that played matches “{search.trim()}”.</EmptyState>
        ) : (
          <EmptyState title="Nothing played yet">Videos and music that play for at least 10 seconds appear here.</EmptyState>
        )
      }
    />
  );
}

function RecordingCard({ api }: { api: HistorySettingsApi }) {
  const { settings } = api;
  if (!settings) return null;
  const options = RETENTION_OPTIONS.some((o) => o.days === settings.retentionDays)
    ? RETENTION_OPTIONS
    : [...RETENTION_OPTIONS, { days: settings.retentionDays, label: `${settings.retentionDays} days` }];

  return (
    <section className="gm-card-panel" aria-label="Recording">
      <h2 className="gm-sidebar__heading">Recording</h2>
      <label className="gm-setting">
        <span>Record history</span>
        <input
          type="checkbox"
          role="switch"
          className="gm-switch"
          checked={settings.recording}
          onChange={(e) => void api.update({ recording: e.target.checked })}
        />
      </label>
      <label className="gm-setting">
        <span>Keep for</span>
        <select
          className="gm-select"
          value={settings.retentionDays}
          onChange={(e) => void api.update({ retentionDays: Number(e.target.value) })}
        >
          {options.map((o) => (
            <option key={o.days} value={o.days}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="gm-setting__hint">Stored only on this PC.</p>
      <ConfirmButton
        className="gm-textbtn gm-textbtn--danger"
        confirmLabel="Clear everything?"
        onConfirm={() => void api.clearAll()}
      >
        Clear all history
      </ConfirmButton>
    </section>
  );
}
