/**
 * Legacy non-media tab row — superseded by UnifiedTabRow.
 * Kept for reference; no longer rendered by BrowserSessionsPanel.
 */
import "./AllTabRow.css";
import type { BrowserTab } from "../../../types/media";
import { abbreviatedUrl, faviconFromUrl, tabStateBadge } from "../lib/browserMedia";

type Props = {
  tab: BrowserTab;
  browserId: string;
  busy: boolean;
  browserWindowHint: string;
  onFocus: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onReload: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onClose: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onReactivate: (tab: BrowserTab, browserId: string) => void | Promise<void>;
};

export function AllTabRow({ tab, browserId, busy, onFocus, onReload, onClose, onReactivate }: Props) {
  const ts = tab.tabState?.toLowerCase() ?? "";
  const badge = tabStateBadge(tab.tabState);
  const showReactivate = ts === "sleeping" || ts === "crashed";
  const fav = tab.favIconUrl?.trim() || faviconFromUrl(tab.url ?? "") || null;
  const urlShort = abbreviatedUrl(tab.url ?? "");

  const rowClass = ["pilpod-all-tab-row", ts === "inactive" ? "pilpod-all-tab-row--inactive" : ""].filter(Boolean).join(" ");

  return (
    <li className={rowClass}>
      <div className="pilpod-all-tab-row__fav-wrap">
        {fav ? (
          <img src={fav} alt="" className="pilpod-all-tab-row__fav" width={16} height={16} loading="lazy" decoding="async" />
        ) : (
          <span className="pilpod-all-tab-row__fav-fallback" aria-hidden />
        )}
      </div>
      <div className="pilpod-all-tab-row__body">
        <p className="pilpod-all-tab-row__title-row" title={tab.title?.trim() || undefined}>
          <span className="pilpod-all-tab-row__title">{tab.title?.trim() || "Untitled"}</span>
          {badge ? <span className="pilpod-all-tab-row__badge" title={`Tab state: ${tab.tabState ?? "unknown"}`} aria-hidden>{badge}</span> : null}
        </p>
        <p className="pilpod-all-tab-row__url" title={tab.url}>{urlShort}</p>
      </div>
      <div className="pilpod-all-tab-row__actions">
        {showReactivate ? (
          <button type="button" className="pilpod-all-tab-row__btn" disabled={busy} title="Wake discarded or crashed tab" onClick={() => void onReactivate(tab, browserId)}>Wake</button>
        ) : null}
        <button type="button" className="pilpod-all-tab-row__btn" disabled={busy} title="Focus this tab in the browser" onClick={() => void onFocus(tab, browserId)}>Focus</button>
        <button type="button" className="pilpod-all-tab-row__btn" disabled={busy} title="Reload tab" onClick={() => void onReload(tab, browserId)}>Reload</button>
        <button type="button" className="pilpod-all-tab-row__btn pilpod-all-tab-row__btn--danger" disabled={busy} title="Close tab" onClick={() => void onClose(tab, browserId)}>Close</button>
      </div>
    </li>
  );
}
