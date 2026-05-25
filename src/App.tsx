import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { DevLabApp } from "./features/dev-lab";
import { MediaDashboard } from "./features/media-dashboard";

const windowLabel = getCurrentWebviewWindow().label;

export default function App() {
  return windowLabel === "dev-lab" ? <DevLabApp /> : <MediaDashboard />;
}
