import { useState } from "react";
import { IconPlus } from "../../../shared/ui/icons";

/**
 * "+ New …" that turns into a name field in place. `onCreate` resolves to
 * false when the name was refused (taken, or the backend failed), and the
 * field stays open with the reason.
 */
export function InlineCreate({
  label,
  placeholder,
  onCreate,
  refusal = "Could not create it — that name may already be taken.",
}: {
  label: string;
  placeholder: string;
  onCreate: (name: string) => Promise<boolean>;
  refusal?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <button type="button" className="sky-subnav__add" onClick={() => setEditing(true)}>
        <IconPlus /> {label}
      </button>
    );
  }

  const submit = async () => {
    const value = name.trim();
    if (!value) return;
    if (await onCreate(value)) {
      setName("");
      setEditing(false);
      setError(null);
    } else {
      setError(refusal);
    }
  };

  return (
    <form
      className="sky-newpl"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        autoFocus
        className="sky-input"
        value={name}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            setEditing(false);
          }
        }}
      />
      <div className="sky-newpl__row">
        <button type="submit" className="sky-btn sky-btn--primary" disabled={!name.trim()}>
          Create
        </button>
        <button type="button" className="sky-textbtn" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      {error ? <p className="sky-inline-error">{error}</p> : null}
    </form>
  );
}

/**
 * A title that can be renamed in place: shows the name, and on "Rename" an
 * input that saves on Enter / blur and cancels on Escape.
 */
export function useRename(current: string, save: (name: string) => Promise<boolean>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);

  const start = () => {
    setDraft(current);
    setEditing(true);
  };
  const commit = async () => {
    const value = draft.trim();
    setEditing(false);
    if (value && value !== current) await save(value);
  };

  const input = editing ? (
    <input
      autoFocus
      className="sky-rename"
      value={draft}
      aria-label="New name"
      maxLength={80}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") void commit();
        if (e.key === "Escape") {
          e.stopPropagation();
          setEditing(false);
        }
      }}
    />
  ) : null;

  return { editing, start, input };
}
