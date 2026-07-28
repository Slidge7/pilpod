import { useEffect, useMemo, useRef, useState } from "react";
import { guideFor, resolveGuide, varsFor } from "../guides";
import type { GuideStep } from "../guides/types";
import { diagnosisHint } from "../lib/status";
import type { BrowserSetupInfo } from "../types";
import { StepDiagram } from "./diagrams";

/** How long to wait before offering troubleshooting on the live step. */
const STUCK_AFTER_MS = 60_000;

export function SetupGuide({
  browser,
  storeUrl,
  onOpenListing,
  onOpenExtensionsPage,
  onCopyStoreUrl,
  onDone,
  onBack,
}: {
  browser: BrowserSetupInfo;
  storeUrl: string;
  onOpenListing: (id: string) => void;
  onOpenExtensionsPage: (id: string) => void;
  onCopyStoreUrl: () => Promise<boolean>;
  /** Fired once, when this browser becomes verified while the guide is open. */
  onDone: (id: string) => void;
  onBack: () => void;
}) {
  const guide = useMemo(
    () => resolveGuide(guideFor(browser), varsFor(browser, storeUrl)),
    [browser, storeUrl],
  );

  const isActive = browser.activationState === "active";

  // Fire `onDone` exactly once per guide session. Without the ref, every
  // `browsers://update` tick after activation would re-fire it — and the bridge
  // emits that event roughly once a second while a browser is connected.
  const doneFired = useRef(false);
  useEffect(() => {
    doneFired.current = false;
  }, [browser.id]);

  useEffect(() => {
    if (isActive && !doneFired.current) {
      doneFired.current = true;
      onDone(browser.id);
    }
  }, [isActive, browser.id, onDone]);

  return (
    <div className="xs-guide">
      <div className="xs-guide__head">
        <button type="button" className="xs-btn xs-btn--ghost" onClick={onBack}>
          ← All browsers
        </button>
        {browser.iconUrl && <img className="xs-guide__icon" src={browser.iconUrl} alt="" />}
        <h2 className="xs-guide__title">{browser.displayName}</h2>
      </div>

      <p className="xs-guide__intro">{guide.intro}</p>

      <ol className="xs-guide__steps">
        {guide.steps.map((step, i) => (
          <li key={step.id} className="xs-step">
            <span className="xs-step__num" aria-hidden="true">
              {i + 1}
            </span>
            <div className="xs-step__body">
              <h3 className="xs-step__title">{step.title}</h3>
              <p className="xs-step__text">{step.body}</p>
              <StepDiagram id={step.diagram} />
              {step.live ? (
                <LiveStatus browser={browser} onOpenExtensionsPage={onOpenExtensionsPage} />
              ) : (
                <StepButton
                  step={step}
                  browser={browser}
                  onOpenListing={onOpenListing}
                  onOpenExtensionsPage={onOpenExtensionsPage}
                  onCopyStoreUrl={onCopyStoreUrl}
                />
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepButton({
  step,
  browser,
  onOpenListing,
  onOpenExtensionsPage,
  onCopyStoreUrl,
}: {
  step: GuideStep;
  browser: BrowserSetupInfo;
  onOpenListing: (id: string) => void;
  onOpenExtensionsPage: (id: string) => void;
  onCopyStoreUrl: () => Promise<boolean>;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  switch (step.action.kind) {
    case "openStore":
      return (
        <button
          type="button"
          className="xs-btn xs-btn--primary"
          disabled={!browser.launchable}
          title={
            browser.launchable
              ? undefined
              : "PilPod can't find this browser's program file"
          }
          onClick={() => onOpenListing(browser.id)}
        >
          {step.action.label ?? "Open the listing"}
        </button>
      );

    case "openExtensionsPage":
      if (!browser.extensionsPage) return null;
      return (
        <button
          type="button"
          className="xs-btn xs-btn--ghost"
          onClick={() => onOpenExtensionsPage(browser.id)}
        >
          {step.action.label ?? "Open extensions page"}
        </button>
      );

    case "copyStoreUrl":
      return (
        <button
          type="button"
          className="xs-btn xs-btn--ghost"
          onClick={() => {
            void onCopyStoreUrl().then(setCopied);
          }}
        >
          {copied ? "Copied" : (step.action.label ?? "Copy link")}
        </button>
      );

    case "none":
    default:
      return null;
  }
}

/**
 * The self-completing step. Reflects live activation state rather than asking
 * the user to confirm — the bridge already knows the answer.
 */
function LiveStatus({
  browser,
  onOpenExtensionsPage,
}: {
  browser: BrowserSetupInfo;
  onOpenExtensionsPage: (id: string) => void;
}) {
  const isActive = browser.activationState === "active";
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    if (isActive) {
      setStuck(false);
      return;
    }
    const t = setTimeout(() => setStuck(true), STUCK_AFTER_MS);
    return () => clearTimeout(t);
  }, [isActive, browser.id]);

  if (isActive) {
    return (
      <p className="xs-live xs-live--ok" role="status">
        <span className="xs-live__mark" aria-hidden="true">
          ✓
        </span>
        Connected — {browser.displayName} is ready to use.
      </p>
    );
  }

  const hint = diagnosisHint(browser);

  return (
    <div className="xs-live" role="status" aria-live="polite">
      <p className="xs-live__waiting">
        <span className="xs-live__spinner" aria-hidden="true" />
        Waiting for {browser.displayName}…
      </p>
      {stuck && (
        <div className="xs-live__stuck">
          <p>{hint ?? "Still nothing. Check the extension was added without errors."}</p>
          {browser.extensionsPage && (
            <button
              type="button"
              className="xs-btn xs-btn--ghost"
              onClick={() => onOpenExtensionsPage(browser.id)}
            >
              Open {browser.extensionsPage}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
