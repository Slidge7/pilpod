import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { Spinner } from "../../../../shared/ui/icons";
import { useHitActions } from "../hooks/useHitActions";
import { useUniversalSearch } from "../hooks/useUniversalSearch";
import { COMMANDS, commandHit } from "../lib/providers";
import { SEARCH_SCOPES, type SearchScope } from "../lib/query";
import { GROUP_LABEL } from "../lib/rank";
import type { ResultGroup, ResultGroupId, SearchHit } from "../lib/types";
import { SearchRow } from "./SearchRow";

export type SearchPanelHandle = {
  /** The search box forwards its keys here; returns true when handled. */
  handleKey: (e: KeyboardEvent<HTMLInputElement>) => boolean;
};

type Props = {
  listboxId: string;
  value: string;
  scope: SearchScope;
  onScope: (scope: SearchScope) => void;
  /** Replace or extend the search text (recent searches, tips). */
  onInput: (value: string) => void;
  /** An action ran; the panel should close. */
  onDone: () => void;
  onActiveId: (id: string | undefined) => void;
  recent: string[];
  onRemember: (text: string) => void;
  onClearRecent: () => void;
};

const SCOPE_LABEL: Record<SearchScope, string> = {
  all: "All",
  tabs: "Tabs",
  playlists: "Playlists",
  bookmarks: "Bookmarks",
  history: "History",
};

const TIPS: ReadonlyArray<{ insert: string; hint: string }> = [
  { insert: "is:playing", hint: "what is playing now" },
  { insert: "site:youtube.com", hint: "one site only" },
  { insert: "in:history", hint: "only history" },
  { insert: '"exact phrase"', hint: "words in order" },
];

const START_GROUP: ResultGroup = {
  id: "commands",
  label: "Quick actions",
  hits: COMMANDS.map((c) => commandHit(c, 0)),
  total: COMMANDS.length,
};

function optionId(listboxId: string, key: string): string {
  return `${listboxId}-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/**
 * The results surface under the search box: scope chips, grouped results and
 * the keyboard model. Mounted only while open — that is what keeps a closed
 * search free.
 */
export const SearchPanel = forwardRef<SearchPanelHandle, Props>(function SearchPanel(
  { listboxId, value, scope, onScope, onInput, onDone, onActiveId, recent, onRemember, onClearRecent },
  ref,
) {
  const search = useUniversalSearch(value, scope);
  const actions = useHitActions();

  const groups = search.empty ? [START_GROUP] : search.groups;
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);

  const [chosen, setChosen] = useState<string | null>(null);
  // A new query selects its top result; a ticking result list keeps the row
  // the user moved to, as long as it is still there.
  useEffect(() => setChosen(null), [search.query]);
  const activeKey = (chosen && flat.some((h) => h.key === chosen) ? chosen : flat[0]?.key) ?? null;
  const activeIndex = activeKey ? flat.findIndex((h) => h.key === activeKey) : -1;

  const activeId = activeKey ? optionId(listboxId, activeKey) : undefined;
  useEffect(() => {
    onActiveId(activeId);
    if (!activeId) return;
    document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId, onActiveId]);
  useEffect(() => () => onActiveId(undefined), [onActiveId]);

  const run = useCallback(
    (hit: SearchHit, reveal: boolean) => {
      if (hit.target.type !== "command") onRemember(value);
      if (reveal) actions.reveal(hit, search.query.text);
      else actions.primary(hit);
      onDone();
    },
    [actions, onDone, onRemember, search.query.text, value],
  );

  const seeAll = useCallback(
    (group: ResultGroupId) => {
      onRemember(value);
      actions.seeAll(group, search.query.text);
      onDone();
    },
    [actions, onDone, onRemember, search.query.text, value],
  );

  useImperativeHandle(
    ref,
    () => ({
      handleKey(e) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          if (flat.length === 0) return true;
          const step = e.key === "ArrowDown" ? 1 : -1;
          const next = (activeIndex + step + flat.length) % flat.length;
          setChosen(flat[next].key);
          return true;
        }
        if (e.key === "Enter") {
          const hit = flat[activeIndex];
          if (hit) run(hit, e.ctrlKey || e.metaKey || e.altKey);
          return true;
        }
        return false;
      },
    }),
    [activeIndex, flat, run],
  );

  const pickHit = useCallback((hit: SearchHit) => run(hit, false), [run]);
  const terms = search.query.terms;
  const showScopes = !search.empty;
  const noResults = !search.empty && flat.length === 0;

  return (
    <div className="gm-results" role="dialog" aria-label="Search results">
      {showScopes ? (
        <div className="gm-results__scopes" role="toolbar" aria-label="Search in">
          {SEARCH_SCOPES.map((s) => {
            const count = s === "all" ? undefined : search.counts[s];
            const pending = s === "history" && search.historyPending;
            return (
              <button
                key={s}
                type="button"
                className={`gm-scope${count === 0 && !pending ? " gm-scope--none" : ""}`}
                aria-pressed={search.scope === s}
                disabled={search.query.flags.size > 0 && s !== "tabs"}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onScope(s)}
              >
                {SCOPE_LABEL[s]}
                {pending ? (
                  <Spinner />
                ) : count !== undefined ? (
                  <span className="gm-scope__count">{count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="gm-results__body">
        {search.empty ? (
          <StartExtras
            recent={recent}
            onInput={onInput}
            onClearRecent={onClearRecent}
            value={value}
          />
        ) : null}

        {noResults ? (
          <div className="gm-results__none">
            {search.historyPending ? (
              <p>Searching history…</p>
            ) : (
              <>
                <p className="gm-results__none-title">Nothing matches “{value.trim()}”</p>
                <p>
                  Every word has to match. Try fewer words
                  {search.scope !== "all" ? ", or search everything" : ""}.
                </p>
                {search.scope !== "all" ? (
                  <button
                    type="button"
                    className="gm-btn gm-btn--ghost"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onScope("all")}
                  >
                    Search everything
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <div id={listboxId} role="listbox" aria-label="Results" className="gm-results__list">
            {groups.map((group) => (
              <section key={group.id} className="gm-group" role="group" aria-label={group.label}>
                <header className="gm-group__head">
                  <h3>{search.empty ? group.label : GROUP_LABEL[group.id]}</h3>
                  {group.id === "history" && search.historyPending ? <Spinner /> : null}
                  {!search.empty && group.id !== "commands" && group.total > group.hits.length ? (
                    <button
                      type="button"
                      className="gm-group__more"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => seeAll(group.id)}
                    >
                      See all {group.total}
                    </button>
                  ) : null}
                </header>
                <ul className="gm-group__rows" role="presentation">
                  {group.hits.map((hit) => (
                    <SearchRow
                      key={hit.key}
                      id={optionId(listboxId, hit.key)}
                      hit={hit}
                      active={hit.key === activeKey}
                      terms={terms}
                      actions={actions}
                      onPick={pickHit}
                      onHover={setChosen}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <footer className="gm-results__foot" aria-hidden="true">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> move
        </span>
        <span>
          <kbd>↵</kbd> open
        </span>
        <span>
          <kbd>Ctrl</kbd>
          <kbd>↵</kbd> show in God Mode
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
      </footer>
    </div>
  );
});

function StartExtras({
  recent,
  value,
  onInput,
  onClearRecent,
}: {
  recent: string[];
  value: string;
  onInput: (value: string) => void;
  onClearRecent: () => void;
}) {
  const append = (insert: string) => {
    const base = value.trim();
    onInput(base ? `${base} ${insert}` : `${insert} `);
  };
  return (
    <div className="gm-start">
      {recent.length > 0 ? (
        <section className="gm-start__block" aria-label="Recent searches">
          <header className="gm-group__head">
            <h3>Recent</h3>
            <button
              type="button"
              className="gm-group__more"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onClearRecent}
            >
              Clear
            </button>
          </header>
          <div className="gm-chips">
            {recent.map((r) => (
              <button
                key={r}
                type="button"
                className="gm-chip"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onInput(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <section className="gm-start__block" aria-label="Search tips">
        <header className="gm-group__head">
          <h3>Narrow it down</h3>
        </header>
        <div className="gm-chips">
          {TIPS.map((tip) => (
            <button
              key={tip.insert}
              type="button"
              className="gm-chip gm-chip--tip"
              title={tip.hint}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => append(tip.insert)}
            >
              <code>{tip.insert}</code>
              <span>{tip.hint}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
