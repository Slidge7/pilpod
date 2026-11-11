import { getCurrentWebview } from "@tauri-apps/api/webview";
import { DevLabApp } from "./features/dev-lab";
import { SKY_LABEL, SkyApp } from "./features/sky";
import { MediaDashboard } from "./features/media-dashboard";
import {
  PlayerWindow,
  StageView,
  PLAYER_STAGE_LABEL,
  PLAYER_UI_LABEL,
} from "./features/player-window";

// The *webview* label, not the window label: the in-app player window hosts two
// webviews (the video stage, and the playlist UI), so the window label alone
// cannot tell them apart.
const label = getCurrentWebview().label;

export default function App() {
  if (label === PLAYER_UI_LABEL) return <PlayerWindow />;
  if (label === PLAYER_STAGE_LABEL) return <StageView />;
  if (label === SKY_LABEL) return <SkyApp />;
  return label === "dev-lab" ? <DevLabApp /> : <MediaDashboard />;
}
