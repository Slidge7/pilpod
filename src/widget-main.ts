import { getCurrentWindow } from "@tauri-apps/api/window";
import { mountChip } from "./features/widget/chip/mountChip";
import "./features/widget/chip/chip.css";
import { watchWidgetState, widgetApi } from "./features/widget/ipc";
import { applyAppearance, readStoredAppearance } from "./theme/appearance";
import type { WidgetState } from "./features/widget/types";

/**
 * Entry point for the widget window.
 *
 * ## What this file is not
 *
 * It is not `main.tsx`, and it is not React. The widget is a small surface
 * that stays on screen for hours, so its resident cost is the thing to
 * optimise. Collapsed, this entire window is: one `<div>` with a `clip-path`,
 * a pointer handler, and one event subscription. No component tree, no
 * reconciler, no virtual DOM.
 *
 * React arrives only when the user opens the panel, through a dynamic import
 * that Rollup emits as its own chunk, and is unmounted again on collapse. A
 * widget that is never expanded never pays for it.
 *
 * ## Ordering
 *
 * The chip is mounted synchronously before the first state arrives so the
 * window has something to paint immediately; `update()` then fills in the
 * corner and accent. The window is created hidden and revealed by Rust only
 * after placement lands, so there is no flash of an unstyled triangle.
 */

applyAppearance(readStoredAppearance());

const chipHost = document.getElementById("chip") as HTMLElement;
const panelHost = document.getElementById("panel") as HTMLElement;

const chip = mountChip(chipHost);

/**
 * Panel lifecycle.
 *
 * `panelModule` is memoised because the dynamic import resolves from disk in a
 * packaged app — fast, but not free, and re-importing on every expand would
 * add a frame of blank panel each time. `panelMounted` guards against React
 * being told to render into a host it is already rendering into.
 */
type PanelModule = typeof import("./features/widget/panel/mountPanel");
let panelModule: Promise<PanelModule> | null = null;
let panelMounted = false;

async function showPanel(): Promise<void> {
  panelModule ??= import("./features/widget/panel/mountPanel");
  const mod = await panelModule;
  // The user may have collapsed it again while the chunk was loading.
  if (!panelMounted) return;
  mod.mountPanel(panelHost);
}

function hidePanel(): void {
  // Nothing to tear down if the chunk never finished loading.
  void panelModule?.then((mod) => {
    if (!panelMounted) mod.unmountPanel();
  });
}

let expanded = false;

function applyState(state: WidgetState): void {
  chip.update(state);

  // `hidden` rather than a class: it removes the subtree from the a11y tree
  // and from hit-testing without a stylesheet lookup.
  chipHost.hidden = state.expanded;
  panelHost.hidden = !state.expanded;

  if (state.expanded && !expanded) blurGraceUntil = Date.now() + BLUR_GRACE_MS;
  expanded = state.expanded;

  if (state.expanded === panelMounted) return;
  panelMounted = state.expanded;
  if (state.expanded) void showPanel();
  else hidePanel();
}

/**
 * Dismissal.
 *
 * An open panel behaves like a menu: it closes when it loses focus or on
 * Escape. The grace period covers the resize that expanding triggers, which
 * churns focus on Windows and would otherwise close the panel in the same
 * frame it opened.
 *
 * Both listeners are bound once for the window's lifetime rather than around
 * the expanded state — rebinding on every toggle drops events during the swap,
 * and two idle listeners cost nothing.
 */
const BLUR_GRACE_MS = 280;
let blurGraceUntil = 0;

void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
  if (focused || !expanded) return;
  if (Date.now() < blurGraceUntil) return;
  void widgetApi.setExpanded(false);
});

window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !expanded) return;
  void widgetApi.setExpanded(false);
});

watchWidgetState(applyState);
