import { useState } from "react";
import { groupTabsByWindow } from "../../../shared/groupTabsByWindow";
import type { BrowserTab } from "../../../types/media";
import type { DevSlotRow } from "../types";

type Props = {
  slots: DevSlotRow[];
  onKillWs: (browserId: string, subject: string) => void;
  onMediaControl: (
    browserId: string,
    tabId: number,
    action: string,
    subject: string,
    value?: number,
  ) => void;
};

function slotSubject(slot: DevSlotRow): string {
  return `${slot.reportedName} ${slot.browserId.slice(0, 8)}`;
}

function TabRow({
  tab,
  slot,
  onMediaControl,
}: {
  tab: BrowserTab;
  slot: DevSlotRow;
  onMediaControl: Props["onMediaControl"];
}) {
  const subject = slotSubject(slot);
  return (
    <div className={`dl-tab ${tab.active ? "dl-tab--active" : ""}`}>
      <span className="dl-tab__title" title={tab.url}>
        {tab.title || tab.url || `tab ${tab.tabId}`}
      </span>
      <span className="dl-tab__flags">
        {tab.active ? <span className="dl-flag">active</span> : null}
        {tab.audible ? <span className="dl-flag dl-flag--on">♪</span> : null}
        {tab.muted ? <span className="dl-flag">muted</span> : null}
        {tab.pinned ? <span className="dl-flag">pinned</span> : null}
        {tab.media ? (
          <span className="dl-flag dl-flag--on">{tab.media.playbackState}</span>
        ) : null}
      </span>
      <span className="dl-tab__actions">
        <button
          type="button"
          className="dl-btn dl-btn--mini"
          title="Focus tab"
          onClick={() =>
            onMediaControl(slot.browserId, Number(tab.tabId), "focusTab", subject)
          }
        >
          ⊙
        </button>
        <button
          type="button"
          className="dl-btn dl-btn--mini"
          title="Play/pause"
          onClick={() =>
            onMediaControl(slot.browserId, Number(tab.tabId), "playPause", subject)
          }
        >
          ⏯
        </button>
        <button
          type="button"
          className="dl-btn dl-btn--mini"
          title={tab.muted ? "Unmute tab" : "Mute tab"}
          onClick={() =>
            onMediaControl(slot.browserId, Number(tab.tabId), "muteTab", subject)
          }
        >
          {tab.muted ? "🔈" : "🔇"}
        </button>
        <button
          type="button"
          className="dl-btn dl-btn--mini dl-btn--danger"
          title="Close tab"
          onClick={() =>
            onMediaControl(slot.browserId, Number(tab.tabId), "closeTab", subject)
          }
        >
          ✕
        </button>
      </span>
    </div>
  );
}

function SlotCard({
  slot,
  onKillWs,
  onMediaControl,
}: {
  slot: DevSlotRow;
  onKillWs: Props["onKillWs"];
  onMediaControl: Props["onMediaControl"];
}) {
  const [open, setOpen] = useState(false);
  const groups = open ? groupTabsByWindow(slot.tabs) : [];

  return (
    <article className="dl-row">
      <div className="dl-row__main">
        <div className="dl-row__title">
          <strong>
            {slot.reportedName}
            <span className="dl-muted"> → {slot.osBrowserId}</span>
          </strong>
          <code className="dl-muted">{slot.browserId}</code>
        </div>
        <span
          className={`dl-badge ${slot.wsConnected ? "dl-badge--ok" : slot.heartbeatFresh ? "dl-badge--idle" : "dl-badge--off"}`}
        >
          {slot.wsConnected
            ? "WS live"
            : slot.heartbeatFresh
              ? "heartbeat"
              : `stale ${slot.lastSeenSecs}s`}
        </span>
      </div>

      <div className="dl-row__badges">
        <span
          className={`dl-badge ${
            slot.bindingConflict
              ? "dl-badge--warn"
              : slot.binding === "pidVerified"
                ? "dl-badge--ok"
                : "dl-badge--idle"
          }`}
          title={
            slot.bindingConflict
              ? `self-report maps to "${slot.selfReportOsId}" but socket owner is "${slot.osBrowserId}"`
              : undefined
          }
        >
          {slot.binding === "pidVerified" ? "pid-verified" : "self-report"}
          {slot.bindingConflict ? ` ≠ ${slot.selfReportOsId}` : ""}
        </span>
        {slot.reconnecting ? (
          <span className="dl-badge dl-badge--warn">reconnecting</span>
        ) : null}
        <span
          className={`dl-badge ${slot.extInstalledPersisted ? "dl-badge--ok" : "dl-badge--off"}`}
        >
          persisted: {slot.extInstalledPersisted ? "yes" : "no"}
        </span>
        <span className="dl-badge">
          {slot.tabCount} tabs · {slot.windowCount} win · {slot.audibleCount} ♪
        </span>
        <span className="dl-badge dl-muted" title="content hash">
          #{slot.contentHash.slice(0, 8)}
        </span>
      </div>

      <div className="dl-row__actions">
        <button
          type="button"
          className="dl-btn"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide tabs" : "Show tabs"}
        </button>
        <button
          type="button"
          className="dl-btn dl-btn--danger"
          disabled={!slot.wsConnected}
          onClick={() => onKillWs(slot.browserId, slotSubject(slot))}
        >
          Kill WS
        </button>
      </div>

      {open ? (
        <div className="dl-windows">
          {groups.map((g) => (
            <div key={g.windowId} className="dl-window">
              <div className="dl-window__head">
                window {g.windowId}
                {g.focused ? <span className="dl-flag dl-flag--on">focused</span> : null}
                <span className="dl-muted">{g.tabs.length} tabs</span>
                <button
                  type="button"
                  className="dl-btn dl-btn--mini"
                  title="Focus this window"
                  onClick={() =>
                    onMediaControl(
                      slot.browserId,
                      0,
                      "focusWindow",
                      slotSubject(slot),
                      g.windowId,
                    )
                  }
                >
                  Focus
                </button>
              </div>
              {g.tabs.map((t) => (
                <TabRow
                  key={String(t.tabId)}
                  tab={t}
                  slot={slot}
                  onMediaControl={onMediaControl}
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

/** Extension slots (per profile), pre-merge — the raw bridge truth. */
export function SlotsPanel({ slots, onKillWs, onMediaControl }: Props) {
  return (
    <section className="dl-panel">
      <header className="dl-panel__head">
        <h2>Extension slots</h2>
        <span className="dl-panel__count">{slots.length}</span>
      </header>
      <div className="dl-panel__body">
        {slots.length === 0 ? (
          <p className="dl-empty">No extension has connected yet.</p>
        ) : (
          slots.map((s) => (
            <SlotCard
              key={s.browserId}
              slot={s}
              onKillWs={onKillWs}
              onMediaControl={onMediaControl}
            />
          ))
        )}
      </div>
    </section>
  );
}
