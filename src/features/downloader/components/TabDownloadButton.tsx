import type { TabDownloadStatus } from "../lib";
import {
  IconDownloadTray,
  IconCheck,
  IconAlertCircle,
  Spinner,
} from "../../../shared/ui/icons";

type Props = {
  status: TabDownloadStatus;
  onClick: () => void;
};

const TITLES: Record<TabDownloadStatus, string> = {
  idle: "Download",
  active: "Downloading…",
  done: "Downloaded",
  error: "Download failed — retry",
};

export function TabDownloadButton({ status, onClick }: Props) {
  const icon =
    status === "active" ? (
      <Spinner />
    ) : status === "done" ? (
      <IconCheck />
    ) : status === "error" ? (
      <IconAlertCircle />
    ) : (
      <IconDownloadTray />
    );

  return (
    <button
      type="button"
      className={`pilpod-tab-dl-btn pilpod-tab-dl-btn--${status}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={TITLES[status]}
      aria-label={TITLES[status]}
    >
      {icon}
    </button>
  );
}
