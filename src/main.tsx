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

applyAppearance(readStoredAppearance());
applyGlassStrength(readStoredGlassStrength());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
