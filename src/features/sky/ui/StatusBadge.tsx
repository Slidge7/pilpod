import type { BrowserConnectionStatus } from "../../media-dashboard";

const STATUS_LABEL: Record<BrowserConnectionStatus, string> = {
  connected: "Connected",
  reconnecting: "Reconnecting",
  offline: "Not responding",
  "no-ext": "Needs setup",
  closed: "Closed",
};

export function statusLabel(status: BrowserConnectionStatus): string {
  return STATUS_LABEL[status];
}

/** Coloured dot + label for a browser's connection status. */
export function StatusBadge({
  status,
  compact = false,
}: {
  status: BrowserConnectionStatus;
  /** Dot only; the label moves to the tooltip. */
  compact?: boolean;
}) {
  const label = STATUS_LABEL[status];
  return (
    <span
      className={`sky-status sky-status--${status}`}
      title={compact ? label : undefined}
    >
      <span className="sky-status__dot" aria-hidden="true" />
      <span className={compact ? "sky-visually-hidden" : "sky-status__label"}>
        {label}
      </span>
    </span>
  );
}

/** The browser's icon, or a lettered placeholder when it has none. */
export function BrowserIcon({
  iconUrl,
  label,
}: {
  iconUrl: string | null;
  label: string;
}) {
  return iconUrl ? (
    <img className="sky-browser-icon" src={iconUrl} alt="" draggable={false} />
  ) : (
    <span className="sky-browser-icon sky-browser-icon--blank" aria-hidden="true">
      {label.charAt(0).toUpperCase()}
    </span>
  );
}
