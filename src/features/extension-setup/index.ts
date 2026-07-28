/**
 * Extension Setup — public surface.
 *
 * Everything else in this folder is internal. Keeping the export list short is
 * what makes the module safe to change: the dashboard only ever sees the panel,
 * the hook, and the types.
 */

export { ExtensionSetupPanel } from "./ExtensionSetupPanel";
export { OnboardingGate } from "./OnboardingGate";
export { useExtensionSetup } from "./hooks/useExtensionSetup";
export type { ExtensionSetupApi } from "./hooks/useExtensionSetup";
export { isUnlocked, browsersNeedingAttention } from "./lib/status";
export { isBrowserLocked, setupBadgeCount, shouldShowGate } from "./lib/gate";
export type {
  ActivationState,
  BrowserSetupInfo,
  EngineFamily,
  SetupOverview,
  StoreSupport,
} from "./types";
