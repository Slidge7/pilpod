import "./ExtensionSetup.css";
import { ExtensionSetupPanel } from "./ExtensionSetupPanel";
import type { ExtensionSetupApi } from "./hooks/useExtensionSetup";

/**
 * First-run setup prompt.
 *
 * Renders `ExtensionSetupPanel` — the same component as the permanent section —
 * inside an overlay shell. One component, two shells: the onboarding copy and
 * the settings copy cannot drift apart, because there is only one of each.
 *
 * Soft by policy: "Not now" is always available and is remembered in Rust, so
 * the app is never a dead end for someone whose browser can't install the
 * extension. Locked dashboard rows keep the invitation visible afterwards.
 */
export function OnboardingGate({
  api,
  show,
  children,
}: {
  api: ExtensionSetupApi;
  /**
   * Decided by the caller from `useExtensionGate`, not from `api.overview`.
   *
   * The gate is live for the whole session, so it must not be the reason the
   * expensive overview command runs; it asks the cheap `gateState` command
   * instead. The caller then switches `api` on for exactly as long as this is
   * true, which is what gives the panel below its data.
   */
  show: boolean;
  children: React.ReactNode;
}) {

  // The dashboard stays mounted underneath rather than being swapped out:
  // dismissing the gate then reveals a live app instead of remounting one, and
  // the browser list the gate is describing keeps updating behind it.
  return (
    <>
      {children}
      {show && !api.loading && (
        <div className="xs-gate" role="dialog" aria-modal="false" aria-label="Set up PilPod">
          <div className="xs-gate__inner">
            <ExtensionSetupPanel
              api={api}
              footer={
                <button
                  type="button"
                  className="xs-btn xs-btn--ghost xs-gate__dismiss"
                  onClick={() => void api.setDismissed(true)}
                >
                  Not now
                </button>
              }
            />
          </div>
        </div>
      )}
    </>
  );
}
