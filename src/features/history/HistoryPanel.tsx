import { useCallback, useMemo, useState, type ReactNode } from "react";
import "./History.css";
import type { DetectedBrowser } from "../../types/media";
import type { HistoryKind, MediaPlay, PageVisit } from "./types";
import { historyApi } from "./api";
import { useHistoryList } from "./hooks/useHistoryList";
import { useHistorySettings, type HistorySettingsApi } from "./hooks/useHistorySettings";
import { HistoryList } from "./components/HistoryList";
import { MediaPlayRow, PageVisitRow, type RowActions } from "./components/HistoryRows";
import { ConfirmButton } from "./components/ConfirmButton";
import { IconGlobe, IconMusicNote, IconSearch, IconSliders } from "../../shared/ui/icons";

/** Retention choices offered in the UI. `0` = keep forever. */
const RETENTION_OPTIONS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 7, label: "1 week" },
  { days: 30, label: "1 month" },
  { days: 90, label: "3 months" },
  { days: 365, label: "1 year" },
  { days: 0, label: "Forever" },
];

/**
 * The History view: pages visited and media played, as PilPod saw them in the
 * connected browsers. Data comes from the backend recorder (see
 * `src-tauri/src/history`); this panel only reads, opens and deletes.
 *
 * `browsers` is used for one thing — showing each entry's current browser
 * icon when that browser is still around.
 */
export function HistoryPanel({ browsers }: { browsers: DetectedBrowser[] }) {
  const [kind, setKind] = useState<HistoryKind>("pages");
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settings = useHistorySettings();

  const iconByOsId = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of browsers) {
      if (b.iconUrl && !map.has(b.osBrowserId)) map.set(b.osBrowserId, b.iconUrl);
    }
    return map;
  }, [browsers]);

  const iconFor = useCallback((osId: string) => iconByOsId.get(osId) ?? null, [iconByOsId]);

  if (settings.unavailable) {
    return (
      <section className="pilpod-history-panel" aria-label="History">
        <Empty
          title="History is unavailable"
          hint="PilPod could not open its history database this session. Restarting PilPod usually fixes this."
        />
      </section>
    );
  }

  return (
    <section className="pilpod-history-panel" aria-label="History">
      <div className="pilpod-history-toolbar">
        <div className="pilpod-history-tabs" role="tablist" aria-label="History lists">
          <KindTab kind="pages" current={kind} onSelect={setKind} icon={<IconGlobe className="pilpod-icon--sm" />}>
            Pages
          </KindTab>
          <KindTab kind="media" current={kind} onSelect={setKind} icon={<IconMusicNote className="pilpod-icon--sm" />}>
            Media
          </KindTab>
        </div>
        <button
          type="button"
          className={`pilpod-history-iconbtn${settingsOpen ? " pilpod-history-iconbtn--active" : ""}`}
          title="History settings"
          aria-label="History settings"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <IconSliders />
        </button>
      </div>

      {settingsOpen ? <SettingsCard api={settings} /> : null}

      {settings.settings && !settings.settings.recording ? (
        <div className="pilpod-history-paused" role="status">
          <span>Recording is paused — nothing new is being saved.</span>
          <button type="button" className="pilpod-history-textbtn" onClick={() => void settings.update({ recording: true })}>
            Resume
          </button>
        </div>
      ) : null}

      <label className="pilpod-history-search">
        <IconSearch className="pilpod-history-search__icon" />
        <input
          type="search"
          className="pilpod-history-search__input"
          placeholder={kind === "pages" ? "Search pages…" : "Search titles, artists…"}
          value={search}
          aria-label={kind === "pages" ? "Search page history" : "Search media history"}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>

      {/* Keyed by kind so switching lists never shows the other list's rows. */}
      {kind === "pages" ? (
        <PagesList key="pages" search={search} iconFor={iconFor} />
      ) : (
        <MediaList key="media" search={search} iconFor={iconFor} />
      )}
    </section>
  );
}

function openEntry(url: string) {
  historyApi.open(url).catch((err: unknown) => console.error("[history] open failed:", err));
}

function PagesList({ search, iconFor }: { search: string; iconFor: RowActions["iconFor"] }) {
  const list = useHistoryList("pages", search);
  const actions = useRowActions(list.remove, iconFor);
  return (
    <HistoryList<PageVisit>
      list={list}
      renderRow={(visit) => <PageVisitRow key={visit.id} visit={visit} actions={actions} />}
      empty={
        search.trim() ? (
          <Empty title="No matching pages" />
        ) : (
          <Empty
            title="No pages yet"
            hint="Pages you open in connected browsers will appear here as you browse."
          />
        )
      }
    />
  );
}

function MediaList({ search, iconFor }: { search: string; iconFor: RowActions["iconFor"] }) {
  const list = useHistoryList("media", search);
  const actions = useRowActions(list.remove, iconFor);
  return (
    <HistoryList<MediaPlay>
      list={list}
      renderRow={(play) => <MediaPlayRow key={play.id} play={play} actions={actions} />}
      empty={
        search.trim() ? (
          <Empty title="No matching media" />
        ) : (
          <Empty
            title="Nothing played yet"
            hint="Videos and music that play for at least 10 seconds will appear here."
          />
        )
      }
    />
  );
}

/** Stable per list, so memoized rows do not re-render on every refresh. */
function useRowActions(remove: (ids: number[]) => Promise<void>, iconFor: RowActions["iconFor"]): RowActions {
  return useMemo(
    () => ({
      onOpen: openEntry,
      onRemove: (id: number) => void remove([id]),
      iconFor,
    }),
    [remove, iconFor],
  );
}

function KindTab({
  kind,
  current,
  onSelect,
  icon,
  children,
}: {
  kind: HistoryKind;
  current: HistoryKind;
  onSelect: (kind: HistoryKind) => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  const active = kind === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`pilpod-history-tab${active ? " pilpod-history-tab--active" : ""}`}
      onClick={() => onSelect(kind)}
    >
      {icon} {children}
    </button>
  );
}

function SettingsCard({ api }: { api: HistorySettingsApi }) {
  const { settings } = api;
  if (!settings) return null;
  return (
    <div className="pilpod-history-settings">
      <label className="pilpod-history-settings__row">
        <span>Record history</span>
        <input
          type="checkbox"
          className="pilpod-history-switch"
          role="switch"
          checked={settings.recording}
          onChange={(e) => void api.update({ recording: e.target.checked })}
        />
      </label>
      <label className="pilpod-history-settings__row">
        <span>Keep history for</span>
        <select
          className="pilpod-history-select"
          value={settings.retentionDays}
          onChange={(e) => void api.update({ retentionDays: Number(e.target.value) })}
        >
          {withCurrent(settings.retentionDays).map((o) => (
            <option key={o.days} value={o.days}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="pilpod-history-settings__row">
        <span className="pilpod-history-settings__hint">Stored only on this PC.</span>
        <ConfirmButton
          className="pilpod-history-textbtn pilpod-history-textbtn--danger"
          confirmLabel="Clear everything?"
          onConfirm={() => void api.clearAll()}
        >
          Clear all history
        </ConfirmButton>
      </div>
    </div>
  );
}

/** Keep a stored value that is not one of the presets selectable. */
function withCurrent(days: number) {
  return RETENTION_OPTIONS.some((o) => o.days === days)
    ? RETENTION_OPTIONS
    : [...RETENTION_OPTIONS, { days, label: `${days} days` }];
}

function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="pilpod-history-empty">
      <p className="pilpod-history-empty__title">{title}</p>
      {hint ? <p className="pilpod-history-empty__hint">{hint}</p> : null}
    </div>
  );
}
