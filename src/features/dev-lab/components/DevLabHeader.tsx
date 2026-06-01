import "./DevLabHeader.css";
import { IconClose } from "../../../shared/ui/icons";

type Props = {
  loadingBrowsers: boolean;
  onScanBrowsers: () => void;
  onClose: () => void;
};

export function DevLabHeader({
  loadingBrowsers,
  onScanBrowsers,
  onClose,
}: Props) {
  return (
    <header className="dev-lab-header" data-tauri-drag-region="deep">
      <div className="dev-lab-header__left" data-tauri-drag-region="deep">
        <img
          src="/pilpod-icon.png"
          alt=""
          width={22}
          height={22}
          className="dev-lab-header__logo"
          aria-hidden
        />
        <span className="dev-lab-header__title">PilPod Dev Lab</span>
      </div>
      <div className="dev-lab-header__scan-actions">
        <button
          type="button"
          className="dev-lab-header__scan-btn"
          onClick={() => void onScanBrowsers()}
          disabled={loadingBrowsers}
        >
          {loadingBrowsers ? "Scanning…" : "Scan PC browsers"}
        </button>
      </div>
      <div className="dev-lab-header__actions">
        <button
          type="button"
          onClick={onClose}
          className="dev-lab-header__btn dev-lab-header__btn--close"
          title="Close"
          aria-label="Close"
        >
          <IconClose />
        </button>
      </div>
    </header>
  );
}
