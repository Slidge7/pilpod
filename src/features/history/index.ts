export { HistoryPanel } from "./HistoryPanel";
export { historyApi } from "./api";
export * from "./types";

// ── Shared with other surfaces ──────────────────────────────────────────────
// Sky renders its own History section from the same hooks and rules.
export { useHistoryList, type HistoryListApi } from "./hooks/useHistoryList";
export { useHistorySettings, type HistorySettingsApi } from "./hooks/useHistorySettings";
export { groupByDay, type DayGroup } from "./lib/days";
export { formatClock, formatDuration } from "./lib/format";
