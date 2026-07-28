import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./shared/ui/glass-float-shell.css";
import "./shared/ui/glass-appearance.css";
import { applyAppearance, readStoredAppearance } from "./theme/appearance";
import {
  applyGlassStrength,
  readStoredGlassStrength,
} from "./theme/glassAppearance";

// Tells the injected stage agent that this document is PilPod's own, so it
// keeps its cinema layout and pointer lock off our pages. Module scripts run
// before `DOMContentLoaded`, i.e. before the agent acts on anything.
(window as unknown as { __PILPOD_STAGE_APP?: boolean }).__PILPOD_STAGE_APP = true;

applyAppearance(readStoredAppearance());
applyGlassStrength(readStoredGlassStrength());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
