import { statusBadge } from "../lib/status";
import type { BrowserSetupInfo } from "../types";

/** State pill for a browser row. All wording comes from `lib/status`. */
export function StatusBadge({ browser }: { browser: BrowserSetupInfo }) {
  const { label, tone } = statusBadge(browser);
  return (
    <span className={`xs-badge xs-badge--${tone}`}>
      <span className="xs-badge__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
