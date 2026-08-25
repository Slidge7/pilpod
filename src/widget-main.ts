import { mountChip } from "./features/widget/chip/mountChip";
import "./features/widget/chip/chip.css";
import { watchWidgetState } from "./features/widget/ipc";
import { applyAppearance, readStoredAppearance } from "./theme/appearance";

/**
 * Entry point for the widget window.
 *
 * ## What this file is not
 *
 * It is not `main.tsx`, and it is not React. The widget stays on screen for
 * hours, so its resident cost is the thing to optimise. This entire window is:
 * one `<div>` with a `clip-path`, a pointer handler, and one event
 * subscription. No component tree, no reconciler, no virtual DOM.
 *
 * It also used to be more than that. The chip could expand into a media panel,
 * which meant this file dynamically imported React, mounted it into a second
 * host, and ran a menu-style dismissal protocol (focus loss, Escape, a grace
 * period around the resize that expanding triggered). All of that is gone: the
 * chip opens the real dashboard instead. One media UI, in the window built for
 * it, rather than a second smaller one to keep in step.
 *
 * ## Ordering
 *
 * The chip is mounted synchronously, before the first state arrives, so the
 * window has something to paint immediately; `applyState` then fills in the
 * corner and accent. The window is created hidden and revealed by Rust only
 * once placement lands, so there is no flash of an unstyled triangle.
 */

applyAppearance(readStoredAppearance());

const chip = mountChip(document.getElementById("chip") as HTMLElement);

watchWidgetState((state) => chip.update(state));
