import { useState } from "react";
import type { DevLogEntry, DevLogKind } from "../lib/eventLog";

type Props = {
  log: DevLogEntry[];
  onClear: () => void;
};

const KIND_CLASS: Partial<Record<DevLogKind, string>> = {
  connected: "dl-log__row--ok",
  running: "dl-log__row--ok",
  disconnected: "dl-log__row--warn",
  reconnecting: "dl-log__row--warn",
  stopped: "dl-log__row--warn",
  "browser-removed": "dl-log__row--warn",
  error: "dl-log__row--err",
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false });
}

/** Live event log: payload diffs + user actions, newest first. */
export function LogPanel({ log, onClear }: Props) {
  const [filter, setFilter] = useState("");

  const shown = filter
    ? log.filter(
        (e) =>
          e.subject.toLowerCase().includes(filter.toLowerCase()) ||
          e.message.toLowerCase().includes(filter.toLowerCase()) ||
          e.kind.includes(filter.toLowerCase()),
      )
    : log;

  const copyJson = () => {
    void navigator.clipboard.writeText(JSON.stringify(shown, null, 2));
  };

  return (
    <section className="dl-panel">
      <header className="dl-panel__head">
        <h2>Event log</h2>
        <span className="dl-panel__count">{shown.length}</span>
        <input
          className="dl-input"
          placeholder="filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button type="button" className="dl-btn dl-btn--mini" onClick={copyJson}>
          Copy JSON
        </button>
        <button type="button" className="dl-btn dl-btn--mini" onClick={onClear}>
          Clear
        </button>
      </header>

      <div className="dl-panel__body dl-log">
        {shown.length === 0 ? (
          <p className="dl-empty">No events yet.</p>
        ) : (
          shown.map((e, i) => (
            <div
              key={`${e.ts}-${i}`}
              className={`dl-log__row ${KIND_CLASS[e.kind] ?? ""}`}
            >
              <span className="dl-log__time">{fmtTime(e.ts)}</span>
              <span className="dl-log__kind">{e.kind}</span>
              <span className="dl-log__subject">{e.subject}</span>
              <span className="dl-log__msg">{e.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
