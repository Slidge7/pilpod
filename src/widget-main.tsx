import React from "react";
import ReactDOM from "react-dom/client";
import { WidgetApp } from "./features/widget";
import "./index.css";
import { applyAppearance, readStoredAppearance } from "./theme/appearance";

/**
 * Entry point for the widget window.
 *
 * Deliberately *not* `main.tsx`. The widget is a 50×50 surface that may stay
 * open for hours, so it gets its own Vite entry and mounts `WidgetApp`
 * directly — the dashboard, the vault, the downloader and the wallpaper
 * pipeline are never parsed in this window. Sharing `main.tsx` would have cost
 * the widget the entire app bundle for a chip and an icon.
 *
 * Theme is read from the same `localStorage` key the dashboard writes (both
 * windows share an origin), so the widget matches the app's appearance without
 * an IPC round-trip on startup.
 */
applyAppearance(readStoredAppearance());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WidgetApp />
  </React.StrictMode>,
);
