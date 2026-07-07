import { IconBookmark, IconBookmarkFilled } from "../../../shared/ui/icons";

/**
 * Bookmark toggle for a tab row. Filled when the tab's URL is already in the
 * vault. Purely presentational — the parent owns the saved state and toggle.
 */
export function SaveTabButton({
  saved,
  onToggle,
  busy,
}: {
  saved: boolean;
  onToggle: () => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      className={[
        "pilpod-vault-save-btn",
        saved ? "pilpod-vault-save-btn--saved" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={busy}
      title={saved ? "Remove from vault" : "Save to vault"}
      aria-label={saved ? "Remove from vault" : "Save to vault"}
      aria-pressed={saved}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {saved ? (
        <IconBookmarkFilled className="pilpod-icon--sm" />
      ) : (
        <IconBookmark className="pilpod-icon--sm" />
      )}
    </button>
  );
}
