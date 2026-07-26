import { useState } from "react";
import type { BookmarkCollection } from "../types";
import { UNFILED, type CollectionFilter } from "../lib/vaultSearch";
import { IconPlus, IconTrash } from "../../../shared/ui/icons";

/**
 * Collection filter + management strip above the bookmark list.
 *
 * Filtering and management share one control on purpose: the collection you are
 * looking at is the one you want to rename or delete, so those actions appear
 * on the active chip instead of in a separate settings surface.
 *
 * "All" and "Unfiled" are derived views, not stored rows — neither can be
 * renamed or deleted, which is why the default bookmark target can never go
 * missing.
 */
export function CollectionBar({
  collections,
  counts,
  total,
  active,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  collections: readonly BookmarkCollection[];
  counts: { byId: Map<string, number>; unfiled: number };
  total: number;
  active: CollectionFilter;
  onSelect: (filter: CollectionFilter) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const submitCreate = () => {
    const name = draft.trim();
    if (name) onCreate(name);
    setDraft("");
    setCreating(false);
  };

  return (
    <div className="pilpod-vault-collbar">
      <div className="pilpod-vault-collbar__chips">
        <Chip
          label="All"
          count={total}
          active={active == null}
          onClick={() => onSelect(null)}
        />
        <Chip
          label="Unfiled"
          count={counts.unfiled}
          active={active === UNFILED}
          onClick={() => onSelect(UNFILED)}
        />

        {collections.map((c) =>
          renamingId === c.id ? (
            <input
              key={c.id}
              className="pilpod-vault-input pilpod-vault-input--inline"
              defaultValue={c.name}
              autoFocus
              aria-label={`Rename ${c.name}`}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== c.name) onRename(c.id, next);
                setRenamingId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.currentTarget.value = c.name;
                  e.currentTarget.blur();
                }
              }}
            />
          ) : (
            <Chip
              key={c.id}
              label={`${c.emoji ? `${c.emoji} ` : ""}${c.name}`}
              count={counts.byId.get(c.id) ?? 0}
              active={active === c.id}
              onClick={() => onSelect(c.id)}
              onDoubleClick={() => setRenamingId(c.id)}
            />
          ),
        )}

        {creating ? (
          <input
            className="pilpod-vault-input pilpod-vault-input--inline"
            value={draft}
            placeholder="Collection name…"
            aria-label="New collection name"
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submitCreate}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
              if (e.key === "Escape") {
                setDraft("");
                setCreating(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="pilpod-vault-chip pilpod-vault-chip--btn"
            title="New collection"
            onClick={() => setCreating(true)}
          >
            <IconPlus className="pilpod-icon--sm" />
          </button>
        )}
      </div>

      {/* Destructive actions apply to the collection you are looking at, and
          only ever remove the label — the bookmarks stay in "Unfiled". */}
      {active != null && active !== UNFILED ? (
        <div className="pilpod-vault-collbar__actions">
          <button
            type="button"
            className="pilpod-vault-btn"
            onClick={() => setRenamingId(active)}
          >
            Rename
          </button>
          {confirmDeleteId === active ? (
            <>
              <button
                type="button"
                className="pilpod-vault-btn pilpod-vault-btn--danger"
                onClick={() => {
                  onDelete(active);
                  setConfirmDeleteId(null);
                }}
              >
                Delete — keep bookmarks
              </button>
              <button
                type="button"
                className="pilpod-vault-btn"
                onClick={() => setConfirmDeleteId(null)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="pilpod-vault-btn"
              title="Delete this collection (bookmarks are kept)"
              onClick={() => setConfirmDeleteId(active)}
            >
              <IconTrash className="pilpod-icon--sm" /> Delete
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Chip({
  label,
  count,
  active,
  onClick,
  onDoubleClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={[
        "pilpod-vault-chip",
        "pilpod-vault-chip--btn",
        active ? "pilpod-vault-chip--active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-pressed={active}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={onDoubleClick ? `${label} — double-click to rename` : label}
    >
      {label}
      <span className="pilpod-vault-chip__count">{count}</span>
    </button>
  );
}
