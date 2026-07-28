import { useCallback, useState } from "react";
import "./ExtensionSetup.css";
import { BrowserSetupCard } from "./components/BrowserSetupCard";
import { SetupGuide } from "./components/SetupGuide";
import type { ExtensionSetupApi } from "./hooks/useExtensionSetup";

/**
 * The permanent "Browser Setup" section.
 *
 * Two views behind one component: the browser list, and the guide for one
 * browser. `OnboardingGate` renders this exact component on first run, so the
 * onboarding copy and the settings copy can never drift apart.
 */
export function ExtensionSetupPanel({
  api,
  /** Rendered under the list — the gate uses it for "Skip for now". */
  footer,
}: {
  api: ExtensionSetupApi;
  footer?: React.ReactNode;
}) {
  const { overview, loading, error } = api;
  const [openBrowserId, setOpenBrowserId] = useState<string | null>(null);

  const open = api.browserById(openBrowserId ?? "");

  const activate = useCallback(
    (id: string) => {
      setOpenBrowserId(id);
      void api.openListing(id);
    },
    [api],
  );

  const skip = useCallback(
    (id: string) => {
      void api.skip(id);
    },
    [api],
  );

  // Leaving the guide open on success would make the user close it themselves
  // for no reason; the list already shows "Connected".
  const handleDone = useCallback(() => {
    const t = setTimeout(() => setOpenBrowserId(null), 1600);
    return () => clearTimeout(t);
  }, []);

  if (open) {
    return (
      <div className="xs-panel">
        <SetupGuide
          browser={open}
          storeUrl={overview.storeUrl}
          onOpenListing={(id) => void api.openListing(id)}
          onOpenExtensionsPage={(id) => void api.openExtensionsPage(id)}
          onCopyStoreUrl={api.copyStoreUrl}
          onDone={handleDone}
          onBack={() => {
            if (open.activationState === "setupPending") void api.cancel(open.id);
            setOpenBrowserId(null);
          }}
        />
        {error && <p className="xs-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="xs-panel">
      <header className="xs-panel__head">
        <h2 className="xs-panel__title">Browser setup</h2>
        <p className="xs-panel__sub">
          PilPod uses a small companion extension to see tabs and control playback.
          Set it up in each browser you want to use.
        </p>
      </header>

      {loading && overview.browsers.length === 0 ? (
        <p className="xs-empty">Looking for browsers…</p>
      ) : overview.browsers.length === 0 ? (
        <p className="xs-empty">No browsers detected on this machine.</p>
      ) : (
        <div className="xs-list">
          {overview.browsers.map((b) => (
            <BrowserSetupCard key={b.id} browser={b} onActivate={activate} onSkip={skip} />
          ))}
        </div>
      )}

      {error && <p className="xs-error">{error}</p>}
      {footer}
    </div>
  );
}
