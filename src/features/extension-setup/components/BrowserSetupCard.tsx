import { canSkip, diagnosisHint, primaryActionLabel } from "../lib/status";
import type { BrowserSetupInfo } from "../types";
import { StatusBadge } from "./StatusBadge";

/**
 * One browser row: icon, name, state, and the single most useful next action.
 *
 * Presentational only — every wording decision comes from `lib/status`, so the
 * copy is unit-tested and this file has no branches worth testing.
 */
export function BrowserSetupCard({
  browser,
  onActivate,
  onSkip,
}: {
  browser: BrowserSetupInfo;
  onActivate: (id: string) => void;
  onSkip: (id: string) => void;
}) {
  const action = primaryActionLabel(browser);
  const hint = diagnosisHint(browser);
  const unsupported = browser.storeSupport === "unsupported";

  return (
    <div
      className={`xs-card${unsupported ? " xs-card--muted" : ""}`}
      data-state={browser.activationState}
    >
      <div className="xs-card__main">
        {browser.iconUrl ? (
          <img className="xs-card__icon" src={browser.iconUrl} alt="" />
        ) : (
          <span className="xs-card__icon xs-card__icon--blank" aria-hidden="true" />
        )}

        <div className="xs-card__text">
          <div className="xs-card__name">{browser.displayName}</div>
          <StatusBadge browser={browser} />
        </div>

        <div className="xs-card__actions">
          {canSkip(browser) && (
            <button
              type="button"
              className="xs-btn xs-btn--ghost"
              onClick={() => onSkip(browser.id)}
            >
              Skip for now
            </button>
          )}
          {action && (
            <button
              type="button"
              className={`xs-btn${
                browser.activationState === "active" ? " xs-btn--ghost" : " xs-btn--primary"
              }`}
              onClick={() => onActivate(browser.id)}
            >
              {action}
            </button>
          )}
        </div>
      </div>

      {hint && <p className="xs-card__hint">{hint}</p>}
    </div>
  );
}
