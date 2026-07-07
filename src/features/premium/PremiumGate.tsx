import type { ReactNode } from "react";
import { usePremium } from "./usePremium";
import { isEntitled } from "./entitlement";
import { UpsellPanel } from "./UpsellPanel";

interface Props {
  /** Feature flag name as it appears in the license `features` array. */
  feature: string;
  featureTitle: string;
  featureBlurb: string;
  children: ReactNode;
}

/**
 * Renders children only when the user is entitled to `feature`.
 * COSMETIC gate: the Rust backend independently enforces `require_premium()`
 * on every premium command, so bypassing this component gains nothing.
 */
export function PremiumGate({ feature, featureTitle, featureBlurb, children }: Props) {
  const { status, activating, activationError, activate } = usePremium();

  // Initial hydrate in flight — render nothing to avoid an upsell flash.
  if (status === null) return null;

  if (isEntitled(status, feature)) return <>{children}</>;

  return (
    <UpsellPanel
      status={status}
      featureTitle={featureTitle}
      featureBlurb={featureBlurb}
      activating={activating}
      activationError={activationError}
      onActivate={activate}
    />
  );
}
