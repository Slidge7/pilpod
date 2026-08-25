import { createRoot, type Root } from "react-dom/client";
import { WidgetPanel } from "./WidgetPanel";
import "../../../index.css";
import "./WidgetPanel.css";

/**
 * The React entry point for the widget's expanded panel.
 *
 * This module — and everything it pulls in, including React itself — is
 * reachable only through a dynamic `import()` from `widget-main.ts`. The
 * collapsed widget never touches it, so a widget that is left on but never
 * opened costs a few hundred bytes of chunk and no UI runtime at all.
 *
 * `unmount()` is called on every collapse rather than hiding the tree. The
 * module stays cached (the browser cannot unload it), but the fiber tree, the
 * DOM, the media rows and — the part that actually matters — the
 * `browsers://update` subscription and its retained snapshot all go away.
 */

let root: Root | null = null;

export function mountPanel(host: HTMLElement): void {
  root ??= createRoot(host);
  root.render(<WidgetPanel />);
}

export function unmountPanel(): void {
  root?.unmount();
  root = null;
}
